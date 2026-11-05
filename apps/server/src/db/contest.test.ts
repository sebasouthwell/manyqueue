import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { apply, balance, history, InsufficientTokensError } from "./tokens.js";
import { guests, queueItems } from "./schema.js";
import { addQueueItem, applyFairOrder, getActiveQueueItems, getQueueItemById } from "./queue.js";
import {
  AlreadyInPoolError,
  enterContestPool,
  getPoolEntry,
  isTrackInPool,
  listPoolEntries,
  removePoolEntry,
  settleContest,
} from "./contest.js";
import type { DB } from "./client.js";

function guest(db: DB, id: string, nickname: string) {
  db.insert(guests).values({ id, roomId: "room-1", nickname, emoji: "🐸", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
  apply({ roomId: "room-1", guestId: id, delta: 3, reason: "start", cap: 5 }, db);
}

function enter(db: DB, guestId: string, n: string) {
  return enterContestPool(
    { roomId: "room-1", guestId, trackUri: `spotify:track:${n}`, trackName: `Song ${n}`, artistName: "A", albumArtUrl: null, durationMs: 180_000, cost: 1, tokenCap: 5 },
    db,
  );
}

function setup() {
  const db = createTestDb();
  seedRoomWithGuest(db);
  apply({ roomId: "room-1", guestId: "guest-1", delta: 3, reason: "start", cap: 5 }, db);
  guest(db, "guest-2", "Sam");
  guest(db, "guest-3", "Jo");
  return db;
}

describe("enterContestPool", () => {
  it("charges the entry token and keeps the song out of the queue", () => {
    const db = setup();
    const { item } = enter(db, "guest-1", "a");
    expect(balance("guest-1", db)).toBe(2);
    expect(history("guest-1", db).find((e) => e.reason === "contest_entry")?.delta).toBe(-1);
    expect(item.status).toBe("contest");
    expect(getActiveQueueItems("room-1", db)).toHaveLength(0);
    expect(isTrackInPool("room-1", "spotify:track:a", db)).toBe(true);
  });

  it("one entry per guest, and a refused one charges nothing", () => {
    const db = setup();
    enter(db, "guest-1", "a");
    expect(() => enter(db, "guest-1", "b")).toThrow(AlreadyInPoolError);
    expect(balance("guest-1", db)).toBe(2);
    expect(listPoolEntries("room-1", db)).toHaveLength(1);
  });

  it("can't enter without a token, and writes nothing", () => {
    const db = createTestDb();
    seedRoomWithGuest(db); // no start grant: balance 0
    expect(() => enter(db, "guest-1", "a")).toThrow(InsufficientTokensError);
    expect(listPoolEntries("room-1", db)).toHaveLength(0);
    expect(db.select().from(queueItems).all()).toHaveLength(0);
  });
});

describe("settleContest", () => {
  it("the winner is refunded and jumps the queue, ahead of fair order", () => {
    const db = setup();
    // Jo already has a song waiting; fair order would play it first.
    const jo = addQueueItem({ roomId: "room-1", trackUri: "spotify:track:jo", trackName: "Jo's song", artistName: "A", albumArtUrl: null, durationMs: 1000, addedBy: "guest-3" }, db);
    const a = enter(db, "guest-1", "a");
    const b = enter(db, "guest-2", "b");

    const r = settleContest({ winnerEntryId: a.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    applyFairOrder("room-1", db);

    expect(balance("guest-1", db)).toBe(3); // entry token back
    expect(r.winnerBalance).toBe(3);
    const queue = getActiveQueueItems("room-1", db).filter((i) => i.status === "queued");
    expect(queue.map((i) => i.trackName)).toEqual(["Song a", "Jo's song"]);
    expect(getQueueItemById(a.item.id, db)).toMatchObject({ status: "queued", paid: 0, pinnedPosition: 1 });
    expect(getQueueItemById(jo.id, db)?.status).toBe("queued");
    expect(getPoolEntry(a.entry.id, db)).toBeUndefined();
  });

  it("the loser goes back to the pool once, then joins the queue on a second loss", () => {
    const db = setup();
    const a = enter(db, "guest-1", "a");
    const b = enter(db, "guest-2", "b");
    const c = enter(db, "guest-3", "c");

    const first = settleContest({ winnerEntryId: a.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    expect(first.loserJoinedQueue).toBe(false);
    expect(getPoolEntry(b.entry.id, db)?.losses).toBe(1);
    expect(getQueueItemById(b.item.id, db)?.status).toBe("contest");
    expect(balance("guest-2", db)).toBe(2); // still paid in

    const second = settleContest({ winnerEntryId: c.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    expect(second.loserJoinedQueue).toBe(true);
    expect(getPoolEntry(b.entry.id, db)).toBeUndefined();
    expect(getQueueItemById(b.item.id, db)).toMatchObject({ status: "queued", paid: 1 }); // a normal paid add now
    expect(balance("guest-2", db)).toBe(2);
  });

  it("a second winner goes in front of the first, which slides to slot 2", () => {
    const db = setup();
    const a = enter(db, "guest-1", "a");
    const b = enter(db, "guest-2", "b");
    settleContest({ winnerEntryId: a.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    const c = enter(db, "guest-3", "c");
    settleContest({ winnerEntryId: c.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    applyFairOrder("room-1", db);

    const queued = getActiveQueueItems("room-1", db).filter((i) => i.status === "queued");
    expect(queued.map((i) => i.trackName)).toEqual(["Song c", "Song a", "Song b"]);
    expect(getQueueItemById(a.item.id, db)?.pinnedPosition).toBe(2);
    expect(getQueueItemById(c.item.id, db)?.pinnedPosition).toBe(1);
  });

  it("removing the winner later can't refund it a second time", () => {
    const db = setup();
    const a = enter(db, "guest-1", "a");
    const b = enter(db, "guest-2", "b");
    settleContest({ winnerEntryId: a.entry.id, loserEntryId: b.entry.id, tokenCap: 5 }, db);
    expect(getQueueItemById(a.item.id, db)?.paid).toBe(0);
  });
});

describe("removePoolEntry", () => {
  it("refunds the entry and drops the song", () => {
    const db = setup();
    const a = enter(db, "guest-1", "a");
    const out = removePoolEntry(a.entry.id, "refund_reject", 5, db);
    expect(out?.balance).toBe(3);
    expect(balance("guest-1", db)).toBe(3);
    expect(listPoolEntries("room-1", db)).toHaveLength(0);
    expect(getQueueItemById(a.item.id, db)?.status).toBe("skipped");
    expect(removePoolEntry(a.entry.id, "refund_reject", 5, db)).toBeNull();
  });
});
