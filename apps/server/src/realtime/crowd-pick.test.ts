import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests, queueItems } from "../db/schema.js";
import { addQueueItem, getOnDeckItems, getQueueItemById } from "../db/queue.js";
import { updateRoomSettings } from "../db/settings.js";
import { apply, balance } from "../db/tokens.js";
import { ensureRotationState, getRotationRoster } from "../db/rotation.js";
import { getRoomById } from "../db/rooms.js";
import { refillOnDeck, forecastUpcoming } from "./rotation-loop.js";
import {
  crowdTick,
  castVote,
  getMyVote,
  pullFromBallot,
  settleBallot,
  buildBallotView,
  buildHostBallotView,
  getOpenBallot,
} from "./crowd-pick.js";
import type { DB } from "../db/client.js";

function addGuest(db: DB, id: string) {
  db.insert(guests)
    .values({ id, roomId: "room-1", nickname: id, emoji: "🦋", role: "guest", lastSeenAt: new Date(), createdAt: new Date() })
    .run();
}

function addMineSong(db: DB, guestId: string, uri: string, minePosition: number) {
  const item = addQueueItem(
    { roomId: "room-1", trackUri: uri, trackName: uri, artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: guestId },
    db,
  );
  db.update(queueItems).set({ status: "mine", minePosition }).where(eq(queueItems.id, item.id)).run();
  return item;
}

/** 3 guests with 3 songs each, Crowd pick on, and one song playing (guest-1's first). */
function setUp(db: DB, tokens = 20) {
  seedRoomWithGuest(db); // guest-1
  addGuest(db, "guest-2");
  addGuest(db, "guest-3");
  updateRoomSettings("room-1", { mode: "rotation", nextSongMethod: "crowd", draftingStyle: "automatic", tokenCap: 20, tokenMode: tokens > 0 }, db);
  for (const guestId of ["guest-1", "guest-2", "guest-3"]) {
    ensureRotationState("room-1", guestId, db);
    if (tokens) apply({ roomId: "room-1", guestId, delta: tokens, reason: "start", cap: 20 }, db);
    for (let i = 0; i < 3; i++) addMineSong(db, guestId, `${guestId}-song-${i}`, i);
  }
  const room = getRoomById("room-1", db)!;
  refillOnDeck(room, db); // nothing playing: rotation order drafts the first song straight away
  const [first] = getOnDeckItems("room-1", db);
  db.update(queueItems).set({ status: "playing" }).where(eq(queueItems.id, first.id)).run();
  return { room, playing: first };
}

const midSong = (playingItemId: string) => ({ playingItemId, durationMs: 180_000, remainingMs: 120_000, isPlaying: true });
const voteOver = (playingItemId: string) => ({ playingItemId, durationMs: 180_000, remainingMs: 19_000, isPlaying: true });

describe("Crowd pick", () => {
  it("opens a ballot of each guest's top song as a song plays, without owners in the guest view", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    expect(crowdTick(room, midSong(playing.id), db)).toBe(true);
    const view = buildBallotView(room, db)!;
    expect(view.entries.map((e) => e.trackName).sort()).toEqual(["guest-1-song-1", "guest-2-song-0", "guest-3-song-0"]);
    expect(JSON.stringify(view)).not.toMatch(/guest-\d"/); // no owner ids anywhere
    // and no rotation forecast in this mode: the ballot is what's coming up
    expect(forecastUpcoming(room, db)).toEqual([]);
    // a second tick doesn't open another
    expect(crowdTick(room, midSong(playing.id), db)).toBe(false);
  });

  it("the winner goes on deck when the vote closes: drafted by the crowd, charged, credit and lost rounds move", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    crowdTick(room, midSong(playing.id), db);
    const view = buildBallotView(room, db)!;
    const g3song = view.entries.find((e) => e.trackName === "guest-3-song-0")!;
    expect(castVote(room, "guest-1", g3song.itemId, db)).toBe("ok");
    expect(castVote(room, "guest-3", g3song.itemId, db)).toBe("ok"); // your own song counts (D8)
    expect(getMyVote("room-1", "guest-1", db)?.itemId).toBe(g3song.itemId);
    const before = balance("guest-3", db);

    crowdTick(room, voteOver(playing.id), db);
    expect(getOpenBallot("room-1", db)).toBeUndefined();
    const won = getQueueItemById(g3song.itemId, db)!;
    expect(won.status).toBe("on_deck");
    expect(won.draftedBy).toBe("crowd");
    expect(balance("guest-3", db)).toBeLessThan(before);

    const roster = new Map(getRotationRoster("room-1", db).map((r) => [r.guestId, r]));
    expect(roster.get("guest-3")!.lostRounds).toBe(0);
    expect(roster.get("guest-2")!.lostRounds).toBe(1);
    expect(roster.get("guest-1")!.lostRounds).toBe(1);

    // the handoff's refill finds the next song already there and drafts nothing else
    expect(refillOnDeck(room, db, { nextDue: true })).toBe(false);
  });

  it("a winner who can't afford it plays on the house", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db, 0);
    updateRoomSettings("room-1", { tokenMode: true }, db);
    crowdTick(room, midSong(playing.id), db);
    const e = buildBallotView(room, db)!.entries[0];
    castVote(room, "guest-2", e.itemId, db);
    settleBallot(room, db);
    expect(getQueueItemById(e.itemId, db)!.status).toBe("on_deck");
    expect(getQueueItemById(e.itemId, db)!.paid).toBe(0);
  });

  it("no votes: rotation order decides (the ballot's first song)", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    crowdTick(room, midSong(playing.id), db);
    const first = buildBallotView(room, db)!.entries[0];
    expect(settleBallot(room, db)).toBe(first.itemId);
  });

  it("a pulled or removed song leaves the ballot and can't be voted for", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    crowdTick(room, midSong(playing.id), db);
    const [a, b] = buildBallotView(room, db)!.entries;
    expect(pullFromBallot(room, a.itemId, db)).toBe(true);
    db.delete(queueItems).where(eq(queueItems.id, b.itemId)).run();
    const left = buildBallotView(room, db)!.entries.map((e) => e.itemId);
    expect(left).not.toContain(a.itemId);
    expect(left).not.toContain(b.itemId);
    expect(castVote(room, "guest-1", a.itemId, db)).toBe("not_on_ballot");
    // the pulled song is still at the top of its owner's queue
    expect(getQueueItemById(a.itemId, db)!.status).toBe("mine");
  });

  it("no ballot with only one guest who has songs, or a song too short to vote on: rotation order drafts", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    expect(crowdTick(room, { ...midSong(playing.id), remainingMs: 30_000 }, db)).toBe(false);
    db.delete(queueItems).where(eq(queueItems.addedBy, "guest-2")).run();
    db.delete(queueItems).where(eq(queueItems.addedBy, "guest-3")).run();
    expect(crowdTick(room, midSong(playing.id), db)).toBe(false);
    expect(refillOnDeck(room, db, { nextDue: true })).toBe(true);
  });

  it("a host Draft now while the vote is open: nothing closes, the vote carries over to the next song", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    crowdTick(room, midSong(playing.id), db);
    const hostPick = addMineSong(db, "guest-2", "host-pick", 9);
    db.update(queueItems).set({ status: "on_deck", position: 99 }).where(eq(queueItems.id, hostPick.id)).run();
    crowdTick(room, voteOver(playing.id), db);
    expect(getOpenBallot("room-1", db)).toBeDefined();
  });

  it("the host sees owners (never for a mystery song); leaving Crowd pick cancels the vote", () => {
    const db = createTestDb();
    const { room, playing } = setUp(db);
    const pooled = addMineSong(db, "guest-2", "secret", 9);
    db.update(queueItems).set({ status: "pool", minePosition: null, anonymous: true }).where(eq(queueItems.id, pooled.id)).run();
    crowdTick(room, midSong(playing.id), db);
    const host = buildHostBallotView(room, db)!;
    expect(host.entries.find((e) => e.trackName === "guest-2-song-0")!.owner?.guestId).toBe("guest-2");
    const mystery = host.entries.find((e) => e.itemId === pooled.id)!;
    expect(mystery.isMystery).toBe(true);
    expect(mystery.owner).toBeNull();

    updateRoomSettings("room-1", { nextSongMethod: "rotation" }, db);
    expect(crowdTick(room, midSong(playing.id), db)).toBe(true);
    expect(getOpenBallot("room-1", db)).toBeUndefined();
  });
});
