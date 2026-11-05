import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  openBallot,
  closeBallot,
  priceFor,
  HANDOFF_WINDOW_MS,
  type BallotCandidate,
  type BallotView,
  type CrowdPickGuest,
  type HostBallotView,
} from "@manyqueue/shared";
import { db, type DB } from "../db/client.js";
import { ballots, ballotEntries, ballotVotes, queueItems, rotationState } from "../db/schema.js";
import { getRoomSettings } from "../db/settings.js";
import { getOnDeckItems } from "../db/queue.js";
import { getRotationRoster } from "../db/rotation.js";
import { getGuestsForRoom } from "../db/guests.js";
import { apply, balance } from "../db/tokens.js";
import type { Room } from "../db/rooms.js";
import { draftInputs } from "./rotation-loop.js";

/**
 * Crowd pick (the Rotation-mode design §6): the other way Rotation mode chooses the next song. While a song
 * plays, guests vote on a ballot of everyone's top song (no names). The vote closes about 20s before the
 * end and the winner goes on deck, just ahead of the handoff, which then plays it as usual.
 *
 * Rotation order stays the fallback for everything a vote can't cover: a song too short to vote on, a
 * room with only one guest who has songs, a skip (the vote closes early with the votes so far), and no
 * votes at all (the ballot's own order is rotation order). The player loop drafts by rotation at the
 * handoff whenever no winner is on deck by then.
 */

/** The vote must close before the player loop drafts at the handoff (HANDOFF_WINDOW_MS + its 2s lead). */
const CLOSE_FLOOR_MS = HANDOFF_WINDOW_MS + 3_000;
/** Don't open a ballot nobody would have time to vote on. */
const MIN_VOTE_MS = 15_000;

type OpenBallot = typeof ballots.$inferSelect;

/** When each room's open vote is expected to close, from the player loop's estimate (for the countdown). */
const closesAtByRoom = new Map<string, number | null>();
const lastSentClosesAt = new Map<string, number | null>();

export function isCrowdPick(roomId: string, database: DB = db): boolean {
  const s = getRoomSettings(roomId, database);
  return s.mode === "rotation" && s.nextSongMethod === "crowd" && s.draftingStyle !== "dj";
}

function closeLeadMs(roomId: string, database: DB): number {
  return Math.max(getRoomSettings(roomId, database).ballotClosesSec * 1000, CLOSE_FLOOR_MS);
}

export function getOpenBallot(roomId: string, database: DB = db): OpenBallot | undefined {
  return database
    .select()
    .from(ballots)
    .where(and(eq(ballots.roomId, roomId), eq(ballots.status, "open")))
    .get();
}

/** Crowd-pick guests: rotation's own inputs plus each guest's lost-round count. */
function crowdGuests(room: Room, database: DB): CrowdPickGuest[] {
  const roster = getRotationRoster(room.id, database);
  const lost = new Map(roster.map((r) => [r.guestId, r.lostRounds]));
  return draftInputs(room, roster, database).rotationGuests.map((g) => ({ ...g, lostRounds: lost.get(g.id) ?? 0 }));
}

/** Entries still worth voting on: not pulled, and the song is still waiting in its owner's queue or the
 * pool (not removed, not drafted by the host in the meantime), and its owner hasn't been kicked. */
function liveEntries(room: Room, ballotId: string, database: DB) {
  const entries = database.select().from(ballotEntries).where(eq(ballotEntries.ballotId, ballotId)).orderBy(ballotEntries.seq).all();
  if (entries.length === 0) return [];
  const items = database
    .select()
    .from(queueItems)
    .where(inArray(queueItems.id, entries.map((e) => e.queueItemId)))
    .all();
  const byId = new Map(items.map((i) => [i.id, i]));
  const liveGuests = new Set(getGuestsForRoom(room.id, database).filter((g) => !g.kickedAt).map((g) => g.id));
  return entries
    .filter((e) => !e.pulled)
    .map((e) => ({ entry: e, item: byId.get(e.queueItemId) }))
    .filter(
      (x): x is { entry: typeof x.entry; item: NonNullable<typeof x.item> } =>
        !!x.item &&
        x.item.roomId === room.id &&
        (x.entry.isMystery ? x.item.status === "pool" : x.item.status === "mine") &&
        (!x.entry.ownerId || liveGuests.has(x.entry.ownerId)),
    );
}

function tryOpenBallot(room: Room, database: DB): boolean {
  const settings = getRoomSettings(room.id, database);
  const guests = crowdGuests(room, database);
  const { ballot } = openBallot(guests, settings.ballotSize, settings.wildcardAfter);
  const candidates: BallotCandidate[] = [...ballot];

  // At most one mystery-pool song (§6), the one that's waited longest; its owner is never shown.
  if (settings.mysteryEvery > 0 && candidates.length < settings.ballotSize) {
    const live = new Set(guests.map((g) => g.id));
    const pooled = database
      .select()
      .from(queueItems)
      .where(and(eq(queueItems.roomId, room.id), eq(queueItems.status, "pool")))
      .orderBy(queueItems.addedAt)
      .all()
      .find((p) => p.addedBy && live.has(p.addedBy));
    if (pooled) {
      candidates.push({
        itemId: pooled.id,
        ownerId: pooled.addedBy!,
        isMystery: true,
        waitingSince: pooled.addedAt.getTime(),
        isWildcard: false,
        lostRounds: 0,
      });
    }
  }

  // One song isn't a choice: rotation order drafts it at the handoff, as §16 says.
  if (candidates.length < 2) return false;

  const id = crypto.randomUUID();
  database.transaction((tx) => {
    tx.insert(ballots).values({ id, roomId: room.id, status: "open", openedAt: new Date(), closedAt: null, winnerItemId: null }).run();
    candidates.forEach((c, seq) =>
      tx
        .insert(ballotEntries)
        .values({
          ballotId: id,
          queueItemId: c.itemId,
          ownerId: c.ownerId,
          seq,
          isMystery: c.isMystery,
          isWildcard: c.isWildcard,
          lostRounds: c.lostRounds,
          waitingSince: c.waitingSince,
          pulled: false,
        })
        .run(),
    );
  });
  return true;
}

/**
 * Closes the open vote now and puts the winner on deck. Called when the vote's time is up, and on a skip
 * (the votes so far decide). Returns the winning item id, or null when there was nothing to close or no
 * song left on the ballot (rotation order then drafts at the handoff as usual).
 */
export function settleBallot(room: Room, database: DB = db, now = Date.now()): string | null {
  const open = getOpenBallot(room.id, database);
  if (!open) return null;
  const settings = getRoomSettings(room.id, database);
  const live = liveEntries(room, open.id, database);
  const finish = (winnerItemId: string | null) =>
    database
      .update(ballots)
      .set({ status: "closed", closedAt: new Date(now), winnerItemId })
      .where(eq(ballots.id, open.id))
      .run();

  if (live.length === 0) {
    finish(null);
    closesAtByRoom.delete(room.id);
    return null;
  }

  const candidates: BallotCandidate[] = live.map(({ entry }) => ({
    itemId: entry.queueItemId,
    ownerId: entry.ownerId ?? "",
    isMystery: entry.isMystery,
    waitingSince: entry.waitingSince,
    isWildcard: entry.isWildcard,
    lostRounds: entry.lostRounds,
  }));
  const liveIds = new Set(candidates.map((c) => c.itemId));
  const votes: Record<string, string> = {};
  for (const v of database.select().from(ballotVotes).where(eq(ballotVotes.ballotId, open.id)).all()) {
    if (liveIds.has(v.queueItemId)) votes[v.guestId] = v.queueItemId;
  }

  const guests = crowdGuests(room, database);
  const result = closeBallot(candidates, votes, guests, now);
  const winner = live.find((x) => x.entry.queueItemId === result.winnerItemId)!;

  database.transaction((tx) => {
    const t = tx as unknown as DB;
    // Pay when drafted (D2), at the vote's close. A winner who can't afford it plays on the house (§6).
    const item = winner.item;
    const price = !settings.tokenMode
      ? 0
      : priceFor(item.playsTonight, settings.replaySurcharge) + (winner.entry.isMystery ? 1 : item.dedication ? 1 : 0);
    const owner = winner.entry.ownerId;
    const charged = owner && price > 0 && balance(owner, t) >= price ? price : 0;

    const onDeck = getOnDeckItems(room.id, t);
    const position = onDeck.length ? Math.max(...onDeck.map((o) => o.position)) + 1 : 1;
    tx.update(queueItems)
      .set({
        status: "on_deck",
        draftedAt: new Date(now),
        draftedBy: winner.entry.isMystery ? "mystery" : "crowd",
        minePosition: null,
        position,
        paid: charged,
      })
      .where(eq(queueItems.id, item.id))
      .run();
    if (charged > 0 && owner) {
      apply({ roomId: room.id, guestId: owner, delta: -charged, reason: "queue_add", refId: item.id, cap: settings.tokenCap }, t);
    }

    for (const g of result.guests) {
      const before = guests.find((x) => x.id === g.id);
      if (!before || (before.credit === g.credit && before.lostRounds === g.lostRounds && before.lastTurnAt === g.lastTurnAt)) continue;
      tx.update(rotationState)
        .set({ credit: g.credit, lostRounds: g.lostRounds, lastTurnAt: g.lastTurnAt ? new Date(g.lastTurnAt) : null })
        .where(and(eq(rotationState.roomId, room.id), eq(rotationState.guestId, g.id)))
        .run();
    }
    tx.update(ballots)
      .set({ status: "closed", closedAt: new Date(now), winnerItemId: item.id })
      .where(eq(ballots.id, open.id))
      .run();
  });
  closesAtByRoom.delete(room.id);
  return result.winnerItemId;
}

/** Ends an open vote with no winner — the room left Crowd pick, or the night ended. */
export function cancelBallot(roomId: string, database: DB = db): boolean {
  const open = getOpenBallot(roomId, database);
  closesAtByRoom.delete(roomId);
  if (!open) return false;
  database.update(ballots).set({ status: "cancelled", closedAt: new Date() }).where(eq(ballots.id, open.id)).run();
  return true;
}

export interface CrowdTickInput {
  playingItemId: string | null;
  durationMs: number;
  remainingMs: number;
  isPlaying: boolean;
}

/**
 * One player-loop tick of Crowd pick. Opens a ballot as a song starts, closes it when time's up, keeps
 * the countdown current. Returns true when anything guests can see changed (the caller broadcasts).
 *
 * A host "Draft now" while a vote is open puts that song next; the vote then simply carries over to the
 * following song (§6), because nothing closes while the next song is already on deck.
 */
export function crowdTick(room: Room, input: CrowdTickInput, database: DB = db): boolean {
  const open = getOpenBallot(room.id, database);
  if (!isCrowdPick(room.id, database)) return open ? cancelBallot(room.id, database) : false;

  const lead = closeLeadMs(room.id, database);
  const known = !!input.playingItemId && input.durationMs > 0;
  const closesAt = known && input.isPlaying ? Math.round(Date.now() + input.remainingMs - lead) : null;
  closesAtByRoom.set(room.id, closesAt);
  const nextOnDeck = getOnDeckItems(room.id, database).some((o) => o.status !== "playing");

  if (!open) {
    if (!known || nextOnDeck || input.remainingMs <= lead + MIN_VOTE_MS) return false;
    const opened = tryOpenBallot(room, database);
    if (opened) lastSentClosesAt.set(room.id, closesAt);
    return opened;
  }

  if (known && input.remainingMs <= lead && !nextOnDeck) {
    settleBallot(room, database);
    return true;
  }

  // The countdown moved noticeably (a seek, a pause, or the vote carried over to a new song).
  const sent = lastSentClosesAt.get(room.id) ?? null;
  if ((sent === null) !== (closesAt === null) || (sent !== null && closesAt !== null && Math.abs(sent - closesAt) > 3_000)) {
    lastSentClosesAt.set(room.id, closesAt);
    return true;
  }
  return false;
}

export type VoteResult = "ok" | "no_ballot" | "not_on_ballot";

export function castVote(room: Room, guestId: string, itemId: string, database: DB = db): VoteResult {
  const open = getOpenBallot(room.id, database);
  if (!open) return "no_ballot";
  if (!liveEntries(room, open.id, database).some((x) => x.entry.queueItemId === itemId)) return "not_on_ballot";
  database
    .insert(ballotVotes)
    .values({ ballotId: open.id, guestId, queueItemId: itemId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [ballotVotes.ballotId, ballotVotes.guestId], set: { queueItemId: itemId, updatedAt: new Date() } })
    .run();
  return "ok";
}

export function getMyVote(roomId: string, guestId: string, database: DB = db): { ballotId: string; itemId: string } | null {
  const open = getOpenBallot(roomId, database);
  if (!open) return null;
  const v = database
    .select()
    .from(ballotVotes)
    .where(and(eq(ballotVotes.ballotId, open.id), eq(ballotVotes.guestId, guestId)))
    .get();
  return v ? { ballotId: open.id, itemId: v.queueItemId } : null;
}

/** Host takes a song off the ballot (§6); it stays at the top of its owner's queue. */
export function pullFromBallot(room: Room, itemId: string, database: DB = db): boolean {
  const open = getOpenBallot(room.id, database);
  if (!open) return false;
  return (
    database
      .update(ballotEntries)
      .set({ pulled: true })
      .where(and(eq(ballotEntries.ballotId, open.id), eq(ballotEntries.queueItemId, itemId), eq(ballotEntries.pulled, false)))
      .run().changes > 0
  );
}

function ballotCore(room: Room, database: DB) {
  const open = getOpenBallot(room.id, database);
  if (!open) return null;
  const showWait = getRoomSettings(room.id, database).ballotShowsWait;
  const live = liveEntries(room, open.id, database);
  const liveIds = new Set(live.map((x) => x.entry.queueItemId));
  const tally = new Map<string, number>();
  let totalVotes = 0;
  for (const v of database.select().from(ballotVotes).where(eq(ballotVotes.ballotId, open.id)).all()) {
    if (!liveIds.has(v.queueItemId)) continue;
    tally.set(v.queueItemId, (tally.get(v.queueItemId) ?? 0) + 1);
    totalVotes++;
  }
  return { open, live, tally, totalVotes, showWait, closesAt: closesAtByRoom.get(room.id) ?? null };
}

/** Everyone's view: titles and vote counts, never owners (D11). */
export function buildBallotView(room: Room, database: DB = db): BallotView | null {
  const core = ballotCore(room, database);
  if (!core) return null;
  return {
    id: core.open.id,
    closesAt: core.closesAt,
    totalVotes: core.totalVotes,
    entries: core.live.map(({ entry, item }) => ({
      itemId: item.id,
      trackName: item.trackName,
      artistName: item.artistName,
      albumArtUrl: item.albumArtUrl,
      isMystery: entry.isMystery,
      isWildcard: entry.isWildcard,
      lostRounds: core.showWait ? entry.lostRounds : null,
      votes: core.tally.get(item.id) ?? 0,
    })),
  };
}

/** The host's view: the same plus owners, except for mystery songs. */
export function buildHostBallotView(room: Room, database: DB = db): HostBallotView | null {
  const core = ballotCore(room, database);
  if (!core) return null;
  const guestById = new Map(getGuestsForRoom(room.id, database).map((g) => [g.id, g]));
  return {
    id: core.open.id,
    closesAt: core.closesAt,
    totalVotes: core.totalVotes,
    entries: core.live.map(({ entry, item }) => {
      const g = !entry.isMystery && entry.ownerId ? guestById.get(entry.ownerId) : undefined;
      return {
        itemId: item.id,
        trackName: item.trackName,
        artistName: item.artistName,
        albumArtUrl: item.albumArtUrl,
        isMystery: entry.isMystery,
        isWildcard: entry.isWildcard,
        lostRounds: entry.lostRounds,
        votes: core.tally.get(item.id) ?? 0,
        owner: g ? { guestId: g.id, nickname: g.nickname, emoji: g.emoji } : null,
      };
    }),
  };
}
