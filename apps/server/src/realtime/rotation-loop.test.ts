import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "../db/test-helpers.js";
import { guests, queueItems } from "../db/schema.js";
import { addQueueItem, getOnDeckItems, getQueueItemById } from "../db/queue.js";
import { updateRoomSettings } from "../db/settings.js";
import { apply, balance } from "../db/tokens.js";
import { ensureRotationState, getRotationRoster, setHostPickSlot } from "../db/rotation.js";
import { getRoomById } from "../db/rooms.js";
import { refillOnDeck, forecastUpcoming } from "./rotation-loop.js";
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

/** 3 guests, 5 songs each, plenty of tokens, in Rotation mode. */
function setUpThreePhonesFiveSongs(db: DB) {
  seedRoomWithGuest(db); // guest-1
  addGuest(db, "guest-2");
  addGuest(db, "guest-3");
  updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
  for (const guestId of ["guest-1", "guest-2", "guest-3"]) {
    ensureRotationState("room-1", guestId, db);
    apply({ roomId: "room-1", guestId, delta: 20, reason: "start", cap: 20 }, db);
    for (let i = 0; i < 5; i++) addMineSong(db, guestId, `${guestId}-song-${i}`, i);
  }
}

describe("refillOnDeck", () => {
  it("is a no-op outside Rotation mode", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const room = getRoomById("room-1", db)!;
    expect(refillOnDeck(room, db)).toBe(false);
    expect(getOnDeckItems("room-1", db)).toHaveLength(0);
  });

  it("3 phones x 5 songs: fills on deck to the target size and stops", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;

    // Nothing playing: the next song is due, and only that one is drafted (just in time).
    const changed = refillOnDeck(room, db);
    expect(changed).toBe(true);
    expect(getOnDeckItems("room-1", db)).toHaveLength(1);

    // calling again with on deck already full is a no-op
    expect(refillOnDeck(room, db)).toBe(false);
    expect(getOnDeckItems("room-1", db)).toHaveLength(1);
  });

  it("a locked (or playing) slot still counts toward the target — doesn't over-fill on deck", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;
    refillOnDeck(room, db); // the one due song

    const [first] = getOnDeckItems("room-1", db);
    db.update(queueItems).set({ status: "locked" }).where(eq(queueItems.id, first.id)).run();

    // the locked (handed-off) song is the next one — refilling must not add another on top of it
    expect(refillOnDeck(room, db)).toBe(false);
    expect(getOnDeckItems("room-1", db)).toHaveLength(1);
  });

  it("tokens only drop for songs actually drafted onto on deck, not the rest of the personal queue", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;

    refillOnDeck(room, db);
    const onDeck = getOnDeckItems("room-1", db);
    expect(onDeck).toHaveLength(1);

    for (const guestId of ["guest-1", "guest-2", "guest-3"]) {
      const drafted = onDeck.filter((o) => o.addedBy === guestId).length;
      expect(balance(guestId, db)).toBe(20 - drafted); // base price 1 per drafted song, nothing else charged
    }

    // the 3 undrafted personal queues are untouched — still "mine", still 4 or 5 songs each
    const stillMine = db.select().from(queueItems).where(eq(queueItems.status, "mine")).all();
    expect(stillMine).toHaveLength(15 - 1);
  });

  it("drafted items move from mine to on_deck and are marked paid, drafted by rotation", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;

    refillOnDeck(room, db);
    const onDeck = getOnDeckItems("room-1", db);
    for (const item of onDeck) {
      expect(item.status).toBe("on_deck");
      expect(item.paid).toBe(1);
      expect(item.draftedBy).toBe("rotation");
      expect(item.draftedAt).not.toBeNull();
    }
  });

  it("credit and turn history persist back to rotation_state across refills", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;

    refillOnDeck(room, db);
    const roster = getRotationRoster("room-1", db);
    // the first refill opens round 1 (one turn each at ×1): the drafted guests have used theirs and are
    // stamped with it, the one still waiting has theirs left — and all of it made it to the db
    const drafted = roster.filter((r) => r.lastTurnAt !== null);
    expect(drafted.length).toBeGreaterThan(0);
    expect(drafted.every((r) => r.credit === 0)).toBe(true);
    expect(roster.filter((r) => r.lastTurnAt === null).every((r) => r.credit === 1)).toBe(true);
  });

  it("drafts at the last moment: nothing mid-song, the next song once it's due", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;
    refillOnDeck(room, db);
    const [playing] = getOnDeckItems("room-1", db);
    db.update(queueItems).set({ status: "playing" }).where(eq(queueItems.id, playing.id)).run();

    // Mid-song: nothing more is drafted, every other song stays reorderable in its owner's queue.
    expect(refillOnDeck(room, db, { nextDue: false })).toBe(false);
    expect(getOnDeckItems("room-1", db)).toHaveLength(1);

    // Handoff window: exactly the next one.
    expect(refillOnDeck(room, db, { nextDue: true })).toBe(true);
    expect(getOnDeckItems("room-1", db)).toHaveLength(2);
    expect(refillOnDeck(room, db, { nextDue: true })).toBe(false);
  });

  it("R4 done check: reordering a guest's own queue changes what's drafted next", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    addGuest(db, "guest-2");
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
    for (const guestId of ["guest-1", "guest-2"]) {
      ensureRotationState("room-1", guestId, db);
      apply({ roomId: "room-1", guestId, delta: 20, reason: "start", cap: 20 }, db);
    }
    const first = addMineSong(db, "guest-1", "first", 0);
    const second = addMineSong(db, "guest-1", "second", 1);
    // guest-2's song is playing, so exactly one next song is due — guest-1's TOP song, not their
    // whole queue.
    const other = addQueueItem(
      { roomId: "room-1", trackUri: "other", trackName: "other", artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy: "guest-2" },
      db,
    );
    db.update(queueItems).set({ status: "playing", position: 1 }).where(eq(queueItems.id, other.id)).run();

    // swap the order — "second" is now the top of the guest's queue, exactly what PATCH /mine/order does
    db.update(queueItems).set({ minePosition: 1 }).where(eq(queueItems.id, first.id)).run();
    db.update(queueItems).set({ minePosition: 0 }).where(eq(queueItems.id, second.id)).run();

    const room = getRoomById("room-1", db)!;
    refillOnDeck(room, db);
    const onDeck = getOnDeckItems("room-1", db);
    expect(onDeck.map((o) => o.trackUri)).toContain("second");
    expect(onDeck.map((o) => o.trackUri)).not.toContain("first");
  });

  it("throws instead of looping forever when everyone's empty and there's no fallback playlist", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    ensureRotationState("room-1", "guest-1", db);
    const room = getRoomById("room-1", db)!;
    expect(() => refillOnDeck(room, db)).toThrow(/fallback playlist/);
  });

  it("R7 done check: DJ mode never drafts automatically, even with a song waiting", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", draftingStyle: "dj" }, db);
    ensureRotationState("room-1", "guest-1", db);
    const item = addMineSong(db, "guest-1", "a", 0);
    const room = getRoomById("room-1", db)!;

    // DJ mode skips the guest entirely and tries a house pick instead — which throws since there's no
    // fallback playlist configured here, proving the guest's own waiting song was never considered.
    expect(() => refillOnDeck(room, db)).toThrow(/fallback playlist/);
    expect(getQueueItemById(item.id, db)!.status).toBe("mine"); // untouched
  });
});

describe("forecastUpcoming — Rotation's live main queue", () => {
  it("follows everyone's top picks in turn order and changes the moment someone reorders", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const room = getRoomById("room-1", db)!;
    refillOnDeck(room, db);
    const onDeckBefore = getOnDeckItems("room-1", db).map((o) => o.id);

    const before = forecastUpcoming(room, db);
    expect(before).toHaveLength(10);
    const firstSlot = before[0];
    expect(firstSlot.kind).toBe("guest");

    // That guest swaps their first and second song: the forecast follows at once…
    const owner = firstSlot.ownerId!;
    const mine = db.select().from(queueItems).where(eq(queueItems.addedBy, owner)).all().filter((m) => m.status === "mine").sort((a, b) => a.minePosition! - b.minePosition!);
    db.update(queueItems).set({ minePosition: 1 }).where(eq(queueItems.id, mine[0].id)).run();
    db.update(queueItems).set({ minePosition: 0 }).where(eq(queueItems.id, mine[1].id)).run();
    const after = forecastUpcoming(room, db);
    expect(after[0]).toEqual({ ...firstSlot, itemId: mine[1].id });

    // …while on deck itself is untouched: songs only join it when a slot opens.
    expect(getOnDeckItems("room-1", db).map((o) => o.id)).toEqual(onDeckBefore);
    expect(getQueueItemById(mine[1].id, db)!.status).toBe("mine");
  });

  it("is empty outside Rotation mode", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(forecastUpcoming(getRoomById("room-1", db)!, db)).toEqual([]);
  });
});

describe("pinned host picks (dragged to a slot in Coming up)", () => {
  function pinHostSong(db: DB, uri: string, slot: number) {
    const item = addQueueItem({ roomId: "room-1", trackUri: uri, trackName: uri, artistName: "Host", albumArtUrl: null, durationMs: 180_000, addedBy: null }, db);
    db.update(queueItems).set({ status: "house" }).where(eq(queueItems.id, item.id)).run();
    expect(setHostPickSlot("room-1", item.id, slot, db)).toBe(true);
    return item;
  }

  it("sits at its slot in the forecast, guests' songs flowing around it", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const host = pinHostSong(db, "host-song", 2);
    const slots = forecastUpcoming(getRoomById("room-1", db)!, db);
    expect(slots[2]).toEqual({ kind: "host", itemId: host.id, ownerId: null });
    expect(slots.filter((s) => s.kind === "guest").length).toBeGreaterThanOrEqual(2);
  });

  it("counts down as songs are drafted, then takes its slot before the next turn", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const host = pinHostSong(db, "host-song", 1);
    const room = getRoomById("room-1", db)!;

    // Slot 0 is a guest's: drafted, and the pin moves to slot 0.
    refillOnDeck(room, db);
    const first = getOnDeckItems("room-1", db)[0];
    expect(first.addedBy).not.toBeNull();
    expect(getQueueItemById(host.id, db)!.pinnedPosition).toBe(0);

    // That song plays out: the host's song is next, ahead of everyone's turn.
    db.update(queueItems).set({ status: "played" }).where(eq(queueItems.id, first.id)).run();
    refillOnDeck(room, db);
    const next = getOnDeckItems("room-1", db)[0];
    expect(next.id).toBe(host.id);
    expect(next.draftedBy).toBe("host");
  });

  it("unpinning sends it back to the house picks", () => {
    const db = createTestDb();
    setUpThreePhonesFiveSongs(db);
    const host = pinHostSong(db, "host-song", 3);
    setHostPickSlot("room-1", host.id, null, db);
    expect(getQueueItemById(host.id, db)!.pinnedPosition).toBeNull();
    expect(forecastUpcoming(getRoomById("room-1", db)!, db).some((s) => s.kind === "host")).toBe(false);
  });
});
