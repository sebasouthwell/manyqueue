import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  draft,
  songRuleViolation,
  SOCKET_EVENTS,
  type DraftRoomState,
  type RotationGuest,
  type MysteryPoolEntry,
  type DraftedSong,
  type UpcomingSlot,
  projectUpcoming,
} from "@manyqueue/shared";
import { db, type DB } from "../db/client.js";
import { queueItems, guests as guestsTable } from "../db/schema.js";
import { getRoomSettings } from "../db/settings.js";
import { getOnDeckItems, getAllTrackUrisForRoom } from "../db/queue.js";
import { getRotationRoster, getMineQueue, getPoolItems, getHouseItems, getPinnedHostItems, advancePinnedHostItems, setRotationCredit } from "../db/rotation.js";
import { balance, apply } from "../db/tokens.js";
import { setMysteryCounter, type Room } from "../db/rooms.js";
import { listBannedUris } from "../db/bans.js";
import { pickRandomUnplayedFallbackTrack } from "../fallback-playlist.js";
import { getIO } from "./io-instance.js";
import { emitToGuest } from "./socket-server.js";
import { POOL_KEY, skippedForSlot } from "./draft-veto.js";

/** Inserts a real fallback-playlist track straight onto on deck (there's no earlier "mine" stage for a
 * house pick to come from) and hands `draft()` back the descriptor it needs to place it. */
function buildHousePick(room: Room, database: DB): () => DraftedSong {
  return () => {
    // The host's own songs come first: a song the host added takes the next house pick.
    const hostSong = getHouseItems(room.id, database)[0];
    if (hostSong) {
      database
        .update(queueItems)
        .set({ status: "on_deck", draftedAt: new Date(), draftedBy: "house", position: 0 })
        .where(eq(queueItems.id, hostSong.id))
        .run();
      return { itemId: hostSong.id, ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0 };
    }
    if (!room.fallbackPlaylistUri) {
      throw new Error(`room ${room.code}: Rotation mode needs a fallback playlist before it can run out of guest songs`);
    }
    const playlistId = room.fallbackPlaylistUri.replace("spotify:playlist:", "");
    const excluded = new Set([...getAllTrackUrisForRoom(room.id), ...listBannedUris(room.id)]);
    const rules = getRoomSettings(room.id, database);
    const track = pickRandomUnplayedFallbackTrack(playlistId, excluded, (t) => songRuleViolation(t, rules) === null);
    if (!track) throw new Error(`room ${room.code}: fallback playlist has nothing left for a house pick`);

    const id = crypto.randomUUID();
    database
      .insert(queueItems)
      .values({
        id,
        roomId: room.id,
        trackUri: track.uri,
        trackName: track.name,
        artistName: track.artistName,
        albumArtUrl: track.albumArtUrl,
        albumName: track.albumName,
        durationMs: track.durationMs,
        addedBy: null,
        source: "fallback",
        status: "on_deck",
        paid: 1,
        playsTonight: 0,
        pinnedPosition: null,
        position: 0, // corrected once the real slot order is known, right after draft() returns
        addedAt: new Date(),
        lockedAt: null,
        startedAt: null,
        endedAt: null,
        approvalLockAt: null,
        approvedBy: null,
        dedication: null,
        dedicationHidden: false,
        anonymous: false,
        revealed: false,
        nearEndSkip: false,
        minePosition: null,
        draftedAt: new Date(),
        draftedBy: "rotation",
      })
      .run();
    return { itemId: id, ownerId: null, isMystery: false, isHousePick: true, chargedTokens: 0 };
  };
}

/** A house slot on deck: a fallback-playlist track, or a host's song that took the house pick. Either
 * can give way to a guest whose turn comes up. */
function isHouseSlot(o: { source: string; draftedBy: string | null }): boolean {
  return o.source === "fallback" || o.draftedBy === "house";
}

/** Everyone draft() can pick from, as they stand right now: shared by the real refill and the
 * main queue forecast so the two can never disagree about turn order or who can pay. */
export function draftInputs(room: Room, roster: ReturnType<typeof getRotationRoster>, database: DB) {
  // A kicked guest's rotation row can linger (R2 only creates fresh ones for guests still active at the
  // switch) — exclude them here too, so a kick mid-Rotation-mode party takes effect immediately.
  const liveGuestIds = new Set(
    database
      .select({ id: guestsTable.id })
      .from(guestsTable)
      .where(and(eq(guestsTable.roomId, room.id), isNull(guestsTable.kickedAt)))
      .all()
      .map((g) => g.id),
  );

  // Auto + veto: whoever the host skipped for this slot sits it out, keeping their credit (their turn).
  const skipped = skippedForSlot(room.id);
  const rotationGuests: RotationGuest[] = roster
    .filter((r) => liveGuestIds.has(r.guestId) && !skipped.has(r.guestId))
    .map((r) => {
      const mine = getMineQueue(room.id, r.guestId, database);
      return {
        id: r.guestId,
        weight: r.weight,
        credit: r.credit,
        lastTurnAt: r.lastTurnAt ? r.lastTurnAt.getTime() : null,
        joinedAt: r.joinedAt.getTime(),
        active: r.active,
        queue: mine.map((m) => ({ id: m.id, ownerId: r.guestId, playsTonight: m.playsTonight, hasDedication: !!m.dedication })),
        tokenBalance: balance(r.guestId, database),
      };
    });

  const pool: MysteryPoolEntry[] = (skipped.has(POOL_KEY) ? [] : getPoolItems(room.id, database)).map((p) => ({
    id: p.id,
    ownerId: p.addedBy ?? "",
    playsTonight: p.playsTonight,
    waitingSince: p.addedAt.getTime(),
  }));

  return { rotationGuests, pool };
}

/**
 * In Crowd pick the vote's winner is already on deck by the handoff (crowd-pick.ts), so this only drafts
 * when there was no vote: a short song, a single guest with songs, or nothing playing.
 *
 * Tops up Rotation mode's on-deck list — the player loop's Rotation-mode equivalent of
 * `ensureFallbackFilled` (the Rotation-mode design §5.4, R3). A no-op outside Rotation mode, and a no-op when
 * on deck is already at its target size, so it's cheap to call on every tick.
 */
export function refillOnDeck(room: Room, database: DB = db, opts: { nextDue?: boolean } = {}): boolean {
  const settings = getRoomSettings(room.id, database);
  if (settings.mode !== "rotation") return false;

  const roster = getRotationRoster(room.id, database);
  const onDeckBefore = getOnDeckItems(room.id, database);
  // Drafted at the last moment: on deck is the song playing plus, only once it's due (the handoff, about
  // 15s before the end, or straight away when nothing plays), the next one. Until then every song stays
  // in its owner's queue, reorderable, and "Coming up" shows the live forecast.
  const nextDue = opts.nextDue ?? true;
  const playingCount = onDeckBefore.filter((o) => o.status === "playing").length;
  const targetSize = playingCount + (nextDue ? 1 : 0);
  // A house pick that hasn't started may give its slot to a guest (see draft()). Never the one playing,
  // one already handed to Spotify for the handoff ("locked"), or, while nothing plays, the first in
  // line: the player loop may already have sent that one to start.
  const nothingPlaying = !onDeckBefore.some((o) => o.status === "playing" || o.status === "locked");
  const yieldable = (o: (typeof onDeckBefore)[number], i: number) =>
    isHouseSlot(o) && o.status === "on_deck" && !(nothingPlaying && i === 0);
  // A host song pinned to this slot in Coming up takes it before the rotation drafts anyone.
  if (onDeckBefore.length < targetSize) {
    const due = getPinnedHostItems(room.id, database).find((p) => (p.pinnedPosition ?? 0) <= 0);
    if (due) {
      const position = onDeckBefore.length ? Math.max(...onDeckBefore.map((o) => o.position)) + 1 : 1;
      database
        .update(queueItems)
        .set({ status: "on_deck", draftedAt: new Date(), draftedBy: "host", pinnedPosition: null, position, paid: 0 })
        .where(eq(queueItems.id, due.id))
        .run();
      advancePinnedHostItems(room.id, 1, database);
      return true;
    }
  }
  if (onDeckBefore.length >= targetSize && !onDeckBefore.some(yieldable)) return false;

  const { rotationGuests, pool } = draftInputs(room, roster, database);

  const onDeckState: DraftedSong[] = onDeckBefore.map((o, i) => ({
    itemId: o.id,
    ownerId: o.addedBy,
    isMystery: o.anonymous,
    isHousePick: isHouseSlot(o),
    chargedTokens: 0,
    canYield: yieldable(o, i),
  }));

  // DJ mode (§9): no automatic drafting at all, of any kind — everything comes from the host's own
  // Draft now, or a house pick when a slot would otherwise sit empty. Emptying the inputs draft() would
  // otherwise draw from is simpler and safer than teaching the pure function a third mode to skip.
  const djMode = settings.draftingStyle === "dj";

  const state: DraftRoomState = {
    onDeckSize: targetSize,
    onDeck: onDeckState,
    guests: djMode ? [] : rotationGuests,
    pool: djMode ? [] : pool,
    tokenMode: settings.tokenMode,
    replaySurcharge: settings.replaySurcharge,
    mysteryEvery: djMode ? 0 : settings.mysteryEvery,
    mysteryCounter: room.mysteryCounter,
    onHouseDefault: false,
    housePick: buildHousePick(room, database),
    boostedTurns: settings.boostedTurns,
  };

  const result = draft(state);
  if (result.yieldedHousePicks.length === 0 && result.onDeck.length === onDeckBefore.length) return false;

  // Never played, nobody owns them: deleting returns the tracks to the fallback's unplayed pool.
  // One that someone already hearted or reacted to is still referenced, so the delete fails: it then
  // simply stays on deck (one song over the target, which play-through corrects).
  const yielded = result.yieldedHousePicks.filter((id) => {
    // A host's song giving way goes back to the front of the host's waiting list, never away.
    const hostSong = onDeckBefore.find((o) => o.id === id && o.draftedBy === "house");
    if (hostSong) {
      database.update(queueItems).set({ status: "house", draftedAt: null, draftedBy: null, position: -1 }).where(eq(queueItems.id, id)).run();
      return true;
    }
    try {
      return database.delete(queueItems).where(and(eq(queueItems.id, id), eq(queueItems.status, "on_deck"))).run().changes > 0;
    } catch (err) {
      console.error(`[rotation:${room.code}] house pick ${id} couldn't give way:`, err);
      return false;
    }
  });
  const existingOnDeck = onDeckBefore.filter((o) => !yielded.includes(o.id));

  let nextPosition = existingOnDeck.length ? Math.max(...existingOnDeck.map((o) => o.position)) + 1 : 1;
  const before = new Set(onDeckBefore.map((o) => o.id));
  for (const drafted of result.onDeck.filter((d) => !before.has(d.itemId))) {
    if (drafted.isHousePick) {
      database.update(queueItems).set({ position: nextPosition }).where(eq(queueItems.id, drafted.itemId)).run();
    } else {
      database
        .update(queueItems)
        .set({
          status: "on_deck",
          draftedAt: new Date(),
          draftedBy: drafted.isMystery ? "mystery" : "rotation",
          minePosition: null,
          position: nextPosition,
          // The actual amount charged, same convention Shared mode uses (0 for a free/on-the-house
          // draft) — refundQueueItem() and anything else reading `paid` depends on this being real.
          paid: drafted.chargedTokens,
        })
        .where(eq(queueItems.id, drafted.itemId))
        .run();
      if (drafted.chargedTokens > 0 && drafted.ownerId) {
        apply(
          {
            roomId: room.id,
            guestId: drafted.ownerId,
            delta: -drafted.chargedTokens,
            reason: "queue_add",
            refId: drafted.itemId,
            cap: settings.tokenCap,
          },
          database,
        );
      }
    }
    nextPosition++;
  }

  // Every song now on deck brings each pinned host song a slot closer.
  advancePinnedHostItems(room.id, result.onDeck.filter((d) => !before.has(d.itemId)).length, database);

  for (const g of result.guests) {
    setRotationCredit(room.id, g.id, g.credit, g.lastTurnAt ? new Date(g.lastTurnAt) : null, database);
  }

  setMysteryCounter(room.id, result.mysteryCounter, database);

  if (result.notifications.length > 0) {
    const io = getIO();
    for (const n of result.notifications) {
      emitToGuest(io, room.code, n.guestId, SOCKET_EVENTS.TOAST, {
        id: crypto.randomUUID(),
        message: `Your turn was skipped — you need ${n.tokensNeeded} more 🪙`,
        guestVisible: true,
      });
    }
  }

  return true;
}

/** How far past on deck the main queue forecasts. */
export const UPCOMING_FORECAST = 10;

/**
 * The live main queue past on deck (see projectUpcoming()). Empty outside Rotation mode and in DJ mode,
 * where nothing is drafted automatically, so there is nothing to forecast.
 */
export function forecastUpcoming(room: Room, database: DB = db, count = UPCOMING_FORECAST): UpcomingSlot[] {
  const settings = getRoomSettings(room.id, database);
  // Crowd pick has no fixed order to forecast: the ballot is what's coming up.
  if (settings.mode !== "rotation" || settings.draftingStyle === "dj" || settings.nextSongMethod === "crowd") return [];
  const roster = getRotationRoster(room.id, database);
  const { rotationGuests, pool } = draftInputs(room, roster, database);
  const onDeck: DraftedSong[] = getOnDeckItems(room.id, database).map((o) => ({
    itemId: o.id,
    ownerId: o.addedBy,
    isMystery: o.anonymous,
    isHousePick: isHouseSlot(o),
    chargedTokens: 0,
  }));
  const projected = projectUpcoming(
    {
      onDeckSize: onDeck.length,
      onDeck,
      guests: rotationGuests,
      pool,
      tokenMode: settings.tokenMode,
      replaySurcharge: settings.replaySurcharge,
      mysteryEvery: settings.mysteryEvery,
      mysteryCounter: room.mysteryCounter,
      onHouseDefault: false,
      boostedTurns: settings.boostedTurns,
      housePick: () => {
        throw new Error("unused: projectUpcoming supplies its own");
      },
    },
    count,
  );
  // The host's pinned songs sit at their slots; guests' songs flow around them. Never past the point
  // where house music takes over (nobody has a song), so a pin there just waits at the end.
  for (const p of getPinnedHostItems(room.id, database)) {
    const houseAt = projected.findIndex((s) => s.kind === "house");
    const limit = houseAt >= 0 ? houseAt : projected.length;
    projected.splice(Math.min(p.pinnedPosition ?? 0, limit), 0, { kind: "host", itemId: p.id, ownerId: null });
  }
  return projected.slice(0, count);
}
