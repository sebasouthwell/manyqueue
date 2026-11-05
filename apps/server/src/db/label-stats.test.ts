import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { computeLabels } from "@manyqueue/shared";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { guests, queueItems } from "./schema.js";
import { addQueueItem, countPlaysTonight, countSongsFinished } from "./queue.js";
import { recordReaction } from "./reactions.js";
import { buildLabelStats, listEarnedLabels, saveEarnedLabel } from "./label-stats.js";
import type { DB } from "./client.js";

function guest(db: DB, id: string, nickname: string) {
  db.insert(guests).values({ id, roomId: "room-1", nickname, emoji: "🐸", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
}
function song(db: DB, n: string, addedBy: string, artist = "A") {
  return addQueueItem({ roomId: "room-1", trackUri: `spotify:track:${n}`, trackName: `Song ${n}`, artistName: artist, albumArtUrl: null, durationMs: 1000, addedBy }, db);
}

describe("label stats", () => {
  it("counts songs, skips, reactions and genres per guest", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    guest(db, "g2", "Sam");
    const a = song(db, "a", "guest-1", "Celia Cruz");
    const b = song(db, "b", "guest-1", "Celia Cruz");
    const c = song(db, "c", "guest-1", "Celia Cruz");
    for (let i = 0; i < 9; i++) recordReaction(a.id, "g2", "🔥", db);
    db.update(queueItems).set({ status: "played", startedAt: new Date() }).where(eq(queueItems.id, a.id)).run();
    db.update(queueItems).set({ status: "skipped", startedAt: new Date() }).where(eq(queueItems.id, b.id)).run();
    void c;

    const s = buildLabelStats("room-1", new Map([["celia cruz", ["salsa"]]]), db).get("guest-1")!;
    expect(s).toMatchObject({ songsAdded: 3, finished: 2, skipped: 1, reactionsReceived: 9, fireReactions: 9, bestSongReactions: 9 });
    expect(s.genreSongs).toEqual({ salsa: 3 });
    const earned = computeLabels(s).earned.map((l) => l.name);
    expect(earned).toContain("Salsa Pro");
    expect(earned).toContain("Hitmaker");
  });

  it("does not count a song removed before it started as finished or skipped", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = song(db, "a", "guest-1");
    const removed = song(db, "b", "guest-1");
    db.update(queueItems).set({ status: "played", startedAt: new Date() }).where(eq(queueItems.id, a.id)).run();
    db.update(queueItems).set({ status: "skipped" }).where(eq(queueItems.id, removed.id)).run(); // what removing/rejecting stores
    const s = buildLabelStats("room-1", new Map(), db).get("guest-1")!;
    expect(s).toMatchObject({ songsAdded: 1, finished: 1, skipped: 0 });
    expect(countSongsFinished("room-1", db)).toBe(1);
    expect(countPlaysTonight("room-1", "spotify:track:b", db)).toBe(0);
  });

  it("still counts a near-end skip as finished, but not as a skip", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const early = song(db, "a", "guest-1");
    const late = song(db, "b", "guest-1");
    db.update(queueItems).set({ status: "skipped", startedAt: new Date(), nearEndSkip: false }).where(eq(queueItems.id, early.id)).run();
    db.update(queueItems).set({ status: "skipped", startedAt: new Date(), nearEndSkip: true }).where(eq(queueItems.id, late.id)).run();

    const s = buildLabelStats("room-1", new Map(), db).get("guest-1")!;
    expect(s).toMatchObject({ songsAdded: 2, finished: 2, skipped: 1 }); // only the early one counts against them
  });

  it("never counts a hidden mystery pick, so a label can't point at its owner", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    for (const n of ["a", "b", "c"]) {
      const it = song(db, n, "guest-1", "Celia Cruz");
      db.update(queueItems).set({ anonymous: true }).where(eq(queueItems.id, it.id)).run();
      for (let i = 0; i < 9; i++) recordReaction(it.id, "guest-1", "🔥", db);
    }
    expect(buildLabelStats("room-1", new Map([["celia cruz", ["salsa"]]]), db).size).toBe(0);
  });

  it("records an earned label once, and keeps it", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const label = { key: "hitmaker", emoji: "🎯", name: "Hitmaker", how: "", value: 8, target: 8 };
    expect(saveEarnedLabel("room-1", "guest-1", label, new Date(), db)).toBe(true);
    expect(saveEarnedLabel("room-1", "guest-1", label, new Date(), db)).toBe(false);
    expect(listEarnedLabels("room-1", db).map((l) => l.name)).toEqual(["Hitmaker"]);
  });
});
