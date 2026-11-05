import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { guests, queueItems } from "./schema.js";
import { addQueueItem } from "./queue.js";
import { recordReaction } from "./reactions.js";
import { mostActiveGuest, reactionSummaries, reactionsReceivedBy } from "./reaction-stats.js";
import type { DB } from "./client.js";

function guest(db: DB, id: string, nickname: string) {
  db.insert(guests).values({ id, roomId: "room-1", nickname, emoji: "🐸", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
}
function song(db: DB, n: string, addedBy: string) {
  return addQueueItem({ roomId: "room-1", trackUri: `spotify:track:${n}`, trackName: `Song ${n}`, artistName: "A", albumArtUrl: null, durationMs: 1000, addedBy }, db);
}

describe("reaction summaries", () => {
  it("counts per emoji, most first, with the top reactor", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    guest(db, "g2", "Sam");
    guest(db, "g3", "Jo");
    const a = song(db, "a", "guest-1");
    for (let i = 0; i < 5; i++) recordReaction(a.id, "g2", "🔥", db);
    for (let i = 0; i < 2; i++) recordReaction(a.id, "g3", "💀", db);
    recordReaction(a.id, "g3", "🔥", db);

    const s = reactionSummaries([a.id], db).get(a.id)!;
    expect(s.reactions).toEqual([{ emoji: "🔥", count: 6 }, { emoji: "💀", count: 2 }]);
    expect(s.topReactor).toMatchObject({ nickname: "Sam", count: 5 });
    expect(reactionSummaries([], db).size).toBe(0);
  });

  it("a song nobody reacted to has no entry", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = song(db, "a", "guest-1");
    expect(reactionSummaries([a.id], db).get(a.id)).toBeUndefined();
  });
});

describe("reactionsReceivedBy", () => {
  it("adds up everything on the guest's songs and finds their top emoji", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    guest(db, "g2", "Sam");
    const a = song(db, "a", "guest-1");
    const b = song(db, "b", "guest-1");
    const other = song(db, "c", "g2");
    for (let i = 0; i < 3; i++) recordReaction(a.id, "g2", "🔥", db);
    recordReaction(b.id, "g2", "💃", db);
    recordReaction(b.id, "g2", "🔥", db);
    for (let i = 0; i < 9; i++) recordReaction(other.id, "guest-1", "😭", db);

    expect(reactionsReceivedBy("room-1", "guest-1", db)).toEqual({ total: 5, topEmoji: "🔥" });
    expect(reactionsReceivedBy("room-1", "g2", db)).toEqual({ total: 9, topEmoji: "😭" });
    expect(reactionsReceivedBy("room-1", "nobody", db)).toEqual({ total: 0, topEmoji: null });
  });
});

describe("mostActiveGuest", () => {
  it("needs at least two songs, and picks the guest with the most", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    guest(db, "g2", "Sam");
    song(db, "a", "guest-1");
    expect(mostActiveGuest("room-1", db)).toBeNull();
    song(db, "b", "g2");
    song(db, "c", "g2");
    song(db, "d", "g2");
    expect(mostActiveGuest("room-1", db)).toMatchObject({ nickname: "Sam", songs: 3 });
  });

  it("doesn't count unrevealed mystery picks, so it can't hint at an adder", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    guest(db, "g2", "Sam");
    song(db, "a", "guest-1");
    song(db, "b", "guest-1");
    const m1 = song(db, "m1", "g2");
    const m2 = song(db, "m2", "g2");
    const m3 = song(db, "m3", "g2");
    for (const m of [m1, m2, m3]) db.update(queueItems).set({ anonymous: true }).where(eq(queueItems.id, m.id)).run();
    expect(mostActiveGuest("room-1", db)).toMatchObject({ nickname: "Maya", songs: 2 });

    db.update(queueItems).set({ revealed: true }).where(eq(queueItems.id, m1.id)).run();
    db.update(queueItems).set({ revealed: true }).where(eq(queueItems.id, m2.id)).run();
    db.update(queueItems).set({ revealed: true }).where(eq(queueItems.id, m3.id)).run();
    expect(mostActiveGuest("room-1", db)).toMatchObject({ nickname: "Sam", songs: 3 });
  });

  it("ignores songs removed before they played", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = song(db, "a", "guest-1");
    const b = song(db, "b", "guest-1");
    db.update(queueItems).set({ status: "skipped" }).where(eq(queueItems.id, b.id)).run();
    void a;
    expect(mostActiveGuest("room-1", db)).toBeNull();
  });
});
