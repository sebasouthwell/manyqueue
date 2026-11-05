import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { bannedTracks, guests, queueItems, rooms } from "./schema.js";
import { addQueueItem } from "./queue.js";
import { recordReaction } from "./reactions.js";
import { insertNickname, setNicknameStatus } from "./ai-nicknames.js";
import { saveEarnedLabel } from "./label-stats.js";
import { buildRecap } from "./recap.js";
import { recapKey, recapKeyValid } from "../recap-access.js";
import type { DB } from "./client.js";

function guest(db: DB, id: string, nickname: string) {
  db.insert(guests).values({ id, roomId: "room-1", nickname, emoji: "🐸", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
}
function song(db: DB, uri: string, by: string, name = uri) {
  return addQueueItem({ roomId: "room-1", trackUri: `spotify:track:${uri}`, trackName: name, artistName: "Artist", albumArtUrl: null, durationMs: 1000, addedBy: by }, db);
}
const play = (db: DB, id: string, at: number) =>
  db.update(queueItems).set({ status: "played", startedAt: new Date(at) }).where(eq(queueItems.id, id)).run();

describe("buildRecap", () => {
  it("summarises the night", () => {
    const db = createTestDb();
    seedRoomWithGuest(db); // guest-1 Maya
    guest(db, "g2", "Sam");
    const start = new Date("2026-09-26T20:00:00Z");
    db.update(rooms).set({ createdAt: start, endedAt: new Date("2026-09-26T23:20:00Z"), status: "ended" }).where(eq(rooms.id, "room-1")).run();

    const a = song(db, "a", "guest-1", "Levitating");
    const b = song(db, "b", "g2", "Espresso");
    const again = song(db, "a", "guest-1", "Levitating");
    play(db, a.id, 1); play(db, b.id, 2); play(db, again.id, 3);
    for (let i = 0; i < 6; i++) recordReaction(b.id, "guest-1", "🔥", db);
    recordReaction(a.id, "g2", "💀", db);
    db.insert(bannedTracks).values({ roomId: "room-1", trackUri: "spotify:track:a", createdAt: new Date() }).run();
    saveEarnedLabel("room-1", "g2", { key: "hitmaker", emoji: "🎯", name: "Hitmaker", how: "", value: 8, target: 8 }, new Date(), db);
    const nick = insertNickname({ roomId: "room-1", guestId: "g2", nickname: "Espresso Martyr ☕", why: "One big pick.", status: "pending", atFinished: 3 }, db);
    setNicknameStatus(nick.id, "shown", db);

    const r = buildRecap("room-1", new Date(), db)!;
    expect(r.room.durationMs).toBe(3 * 3_600_000 + 20 * 60_000);
    expect(r.totals).toEqual({ songs: 3, guests: 2, reactions: 7 });
    expect(r.songOfTheNight).toMatchObject({ title: "Espresso", fire: 6, by: { name: "Sam" } });
    expect(r.mostReplayed).toMatchObject({ title: "Levitating", plays: 2 });
    expect(r.banned).toEqual([{ title: "Levitating", artist: "Artist" }]);
    const sam = r.guests.find((g) => g.name === "Sam")!;
    expect(sam.labels).toEqual([{ emoji: "🎯", name: "Hitmaker" }]);
    expect(sam.nickname?.nickname).toBe("Espresso Martyr ☕");
    expect(r.guests[0]!.name).toBe("Maya"); // most songs first
  });

  it("names nobody behind a mystery pick that was never revealed", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const m = song(db, "m", "guest-1", "Secret Song");
    db.update(queueItems).set({ status: "played", startedAt: new Date(1), anonymous: true }).where(eq(queueItems.id, m.id)).run();
    for (let i = 0; i < 5; i++) recordReaction(m.id, "guest-1", "🔥", db);
    const r = buildRecap("room-1", new Date(), db)!;
    expect(r.songOfTheNight).toMatchObject({ title: "Secret Song", by: null });
    expect(r.guests[0]).toMatchObject({ name: "Maya", songs: 0, reactionsGot: 0 });
  });

  it("has no song of the night or replay without reactions or repeats", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = song(db, "a", "guest-1");
    play(db, a.id, 1);
    const r = buildRecap("room-1", new Date(), db)!;
    expect(r.songOfTheNight).toBeNull();
    expect(r.mostReplayed).toBeNull();
    expect(r.banned).toEqual([]);
  });
});

describe("recap key", () => {
  it("is stable per room, differs between rooms, and rejects anything else", () => {
    process.env.COOKIE_SECRET = "test-secret";
    const a = { id: "room-a", code: "AAAA" };
    const b = { id: "room-b", code: "BBBB" };
    expect(recapKey(a)).toBe(recapKey(a));
    expect(recapKey(a)).not.toBe(recapKey(b));
    expect(recapKeyValid(a, recapKey(a))).toBe(true);
    expect(recapKeyValid(a, recapKey(b))).toBe(false);
    expect(recapKeyValid(a, "short")).toBe(false);
    expect(recapKeyValid(a, undefined)).toBe(false);
  });
});
