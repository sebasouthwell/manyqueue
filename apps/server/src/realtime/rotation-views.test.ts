import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests, queueItems } from "../db/schema.js";
import { addQueueItem } from "../db/queue.js";
import { updateRoomSettings } from "../db/settings.js";
import { ensureRotationState } from "../db/rotation.js";
import { getRoomById } from "../db/rooms.js";
import { apply } from "../db/tokens.js";
import { buildMineView, buildRotationRoomView, buildHostRotationBoard } from "./rotation-views.js";
import type { DB } from "../db/client.js";

function addMineSong(db: DB, guestId: string, uri: string, minePosition: number, dedication: string | null = null) {
  const item = addQueueItem(
    { roomId: "room-1", trackUri: uri, trackName: uri, artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: guestId, dedication },
    db,
  );
  db.update(queueItems).set({ status: "mine", minePosition, dedication }).where(eq(queueItems.id, item.id)).run();
  return item;
}

describe("buildMineView", () => {
  it("returns only this guest's own queue, in minePosition order", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    db.insert(guests).values({ id: "guest-2", roomId: "room-1", nickname: "Sam", emoji: "🌙", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
    addMineSong(db, "guest-1", "b", 1);
    addMineSong(db, "guest-1", "a", 0);
    addMineSong(db, "guest-2", "x", 0);

    const mine = buildMineView("room-1", "guest-1", db);
    expect(mine.map((m) => m.trackUri)).toEqual(["a", "b"]);
  });
});

describe("buildRotationRoomView", () => {
  it("counts personal queues, marks empty ones, and never leaks titles across guests", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    db.insert(guests).values({ id: "guest-2", roomId: "room-1", nickname: "Sam", emoji: "🌙", role: "guest", lastSeenAt: new Date(), createdAt: new Date() }).run();
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    ensureRotationState("room-1", "guest-1", db);
    ensureRotationState("room-1", "guest-2", db);
    addMineSong(db, "guest-1", "a", 0);
    addMineSong(db, "guest-1", "b", 1);

    const room = getRoomById("room-1", db)!;
    const view = buildRotationRoomView(room, db);
    const g1 = view.rotation.find((r) => r.guestId === "guest-1")!;
    const g2 = view.rotation.find((r) => r.guestId === "guest-2")!;
    expect(g1.count).toBe(2);
    expect(g1.empty).toBe(false);
    expect(g2.count).toBe(0);
    expect(g2.empty).toBe(true);
    // the view type has no field for song titles at all — nothing to assert away, which is the point
  });

  it("hides the owner of a mystery (anonymous) on-deck item", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    const item = addQueueItem(
      { roomId: "room-1", trackUri: "a", trackName: "a", artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: "guest-1" },
      db,
    );
    db.update(queueItems).set({ status: "on_deck", anonymous: true }).where(eq(queueItems.id, item.id)).run();

    const room = getRoomById("room-1", db)!;
    const view = buildRotationRoomView(room, db);
    expect(view.onDeck[0].isMystery).toBe(true);
    expect(view.onDeck[0].addedBy).toBeNull();
  });
});

describe("buildHostRotationBoard", () => {
  it("shows real song titles per guest (the host-only privilege) and affordability", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 5 }, db);
    ensureRotationState("room-1", "guest-1", db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);
    const item = addQueueItem(
      { roomId: "room-1", trackUri: "a", trackName: "Song A", artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: "guest-1" },
      db,
    );
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    const room = getRoomById("room-1", db)!;
    const board = buildHostRotationBoard(room, db);
    const g1 = board.guests.find((g) => g.guestId === "guest-1")!;
    expect(g1.songs).toHaveLength(1);
    expect(g1.songs[0].trackName).toBe("Song A"); // the general rotation:update view never carries this
    expect(g1.canAfford).toBe(true);
    expect(g1.tokenBalance).toBe(5);
  });

  it("never shows a mystery pool song's owner, even to the host", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    const item = addQueueItem(
      { roomId: "room-1", trackUri: "a", trackName: "Secret Song", artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: "guest-1" },
      db,
    );
    db.update(queueItems).set({ status: "pool", anonymous: true }).where(eq(queueItems.id, item.id)).run();

    const room = getRoomById("room-1", db)!;
    const board = buildHostRotationBoard(room, db);
    expect(board.pool).toHaveLength(1);
    expect(board.pool[0].trackName).toBe("Secret Song");
    expect(board.pool[0]).not.toHaveProperty("addedBy");
  });
});

describe("Coming up shows the songs (showUpcomingSongs)", () => {
  it("includes titles by default, and only whose pick when the host turns it off", async () => {
    const { createTestDb, seedRoomWithGuest } = await import("../db/test-helpers.js");
    const { addQueueItem } = await import("../db/queue.js");
    const { updateRoomSettings } = await import("../db/settings.js");
    const { ensureRotationState } = await import("../db/rotation.js");
    const { getRoomById } = await import("../db/rooms.js");
    const { queueItems } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const { buildRotationRoomView } = await import("./rotation-views.js");
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", tokenMode: false }, db);
    ensureRotationState("room-1", "guest-1", db);
    const item = addQueueItem(
      { roomId: "room-1", trackUri: "t1", trackName: "Song One", artistName: "Band", albumArtUrl: null, durationMs: 1000, addedBy: "guest-1" },
      db,
    );
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();
    const room = getRoomById("room-1", db)!;
    expect(buildRotationRoomView(room, db).upcoming[0]?.trackName).toBe("Song One");
    updateRoomSettings("room-1", { showUpcomingSongs: false }, db);
    expect(buildRotationRoomView(room, db).upcoming[0]?.trackName).toBeUndefined();
  });
});
