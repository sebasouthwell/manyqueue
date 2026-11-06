import { describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { addQueueItem, getQueueItemById } from "./queue.js";
import { apply, balance } from "./tokens.js";
import {
  switchRoomMode,
  getRotationRoster,
  getMineQueue,
  getPoolItems,
  setMineDedication,
  sendToMysteryPool,
  pullFromMysteryPool,
  removeRotationItem,
  ensureRotationState,
  hostDraftItem,
  skipGuestTurn,
  draftRandomGuest,
  setGuestWeight,
  nextMinePosition,
  placeHostSong,
  getHouseItems,
} from "./rotation.js";
import { getOnDeckItems } from "./queue.js";
import { updateRoomSettings } from "./settings.js";
import { guests, queueItems } from "./schema.js";
import type { DB } from "./client.js";

function addGuest(db: DB, id: string, overrides: Partial<typeof guests.$inferInsert> = {}) {
  db.insert(guests)
    .values({
      id,
      roomId: "room-1",
      nickname: id,
      emoji: "🦋",
      role: "guest",
      lastSeenAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    })
    .run();
  return id;
}

function addItem(db: DB, addedBy: string | null, uri: string) {
  return addQueueItem(
    { roomId: "room-1", trackUri: uri, trackName: uri, artistName: "Artist", albumArtUrl: null, durationMs: 180_000, addedBy },
    db,
  );
}

describe("switchRoomMode: shared -> rotation", () => {
  it("splits the shared queue into personal queues, keeping each guest's order, no lost songs", () => {
    const db = createTestDb();
    seedRoomWithGuest(db); // guest-1
    addGuest(db, "guest-2");
    addGuest(db, "guest-3"); // no songs

    const g1Items = [addItem(db, "guest-1", "a"), addItem(db, "guest-1", "b"), addItem(db, "guest-1", "c")];
    const g2Items = [addItem(db, "guest-2", "d"), addItem(db, "guest-2", "e")];

    const totalBefore = db.select().from(queueItems).where(eq(queueItems.roomId, "room-1")).all().length;
    switchRoomMode("room-1", "rotation", db);
    const totalAfter = db.select().from(queueItems).where(eq(queueItems.roomId, "room-1")).all().length;
    expect(totalAfter).toBe(totalBefore); // nothing lost

    const g1After = g1Items.map((i) => getQueueItemById(i.id, db)!);
    expect(g1After.every((i) => i.status === "mine")).toBe(true);
    expect(g1After.map((i) => i.minePosition)).toEqual([0, 1, 2]); // order preserved

    const g2After = g2Items.map((i) => getQueueItemById(i.id, db)!);
    expect(g2After.map((i) => i.minePosition)).toEqual([0, 1]);

    // every active guest (including one with no songs) gets a rotation row
    const roster = getRotationRoster("room-1", db);
    expect(roster.map((r) => r.guestId).sort()).toEqual(["guest-1", "guest-2", "guest-3"]);
    expect(roster.every((r) => r.credit === 0 && r.weight === 1 && r.active)).toBe(true);
  });

  it("sends anonymous items to the mystery pool instead of a personal queue", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ anonymous: true }).where(eq(queueItems.id, item.id)).run();

    switchRoomMode("room-1", "rotation", db);
    const after = getQueueItemById(item.id, db)!;
    expect(after.status).toBe("pool");
    expect(after.minePosition).toBeNull();
  });

  it("the host's own song (ownerless, not a mystery) becomes a house pick, not a mystery-pool entry", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addItem(db, null, "house-track");

    switchRoomMode("room-1", "rotation", db);
    const after = getQueueItemById(item.id, db)!;
    expect(after.status).toBe("house");
    // ...and back in Shared mode it's an ordinary queued song again.
    switchRoomMode("room-1", "shared", db);
    expect(getQueueItemById(item.id, db)!.status).toBe("queued");
  });

  it("a kicked guest doesn't get a rotation row", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    addGuest(db, "guest-kicked", { kickedAt: new Date() });

    switchRoomMode("room-1", "rotation", db);
    const roster = getRotationRoster("room-1", db);
    expect(roster.map((r) => r.guestId)).not.toContain("guest-kicked");
  });
});

describe("switchRoomMode: rotation -> shared", () => {
  it("charges unpaid items on the way back, and never charges an already-paid one twice", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);

    const unpaid = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", paid: 0 }).where(eq(queueItems.id, unpaid.id)).run();
    const alreadyPaid = addItem(db, "guest-1", "b");
    db.update(queueItems).set({ status: "mine", paid: 1 }).where(eq(queueItems.id, alreadyPaid.id)).run();

    switchRoomMode("room-1", "shared", db);

    expect(getQueueItemById(unpaid.id, db)!.status).toBe("queued");
    expect(getQueueItemById(unpaid.id, db)!.paid).toBe(1);
    expect(getQueueItemById(alreadyPaid.id, db)!.status).toBe("queued");
    // one ledger charge for the unpaid item (base price 1), none for the already-paid one
    expect(balance("guest-1", db)).toBe(4);
  });

  it("a broke guest still gets switched back — charged on the house, never blocked", () => {
    const db = createTestDb();
    seedRoomWithGuest(db); // guest-1 has 0 tokens (no ledger entries)
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", paid: 0 }).where(eq(queueItems.id, item.id)).run();

    switchRoomMode("room-1", "shared", db);

    expect(getQueueItemById(item.id, db)!.status).toBe("queued");
    expect(getQueueItemById(item.id, db)!.paid).toBe(0); // charged the actual (0) amount they had, not the nominal price
    expect(balance("guest-1", db)).toBe(0); // floored, never went negative
  });

  it("pool items merge back in too", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "pool", anonymous: true, paid: 0 }).where(eq(queueItems.id, item.id)).run();

    switchRoomMode("room-1", "shared", db);
    expect(getQueueItemById(item.id, db)!.status).toBe("queued");
  });
});

describe("song action sheet (R5)", () => {
  it("setMineDedication on a still-queued song: no charge, draft-time pricing covers it", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    const result = setMineDedication(item.id, "guest-1", "for Sam 🎂", db);
    expect(result?.item.dedication).toBe("for Sam 🎂");
    expect(result?.charged).toBe(0);
    expect(balance("guest-1", db)).toBe(5); // untouched
  });

  it("setMineDedication on an on-deck song: charges 1 right away, once", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "on_deck", paid: 1 }).where(eq(queueItems.id, item.id)).run();

    const first = setMineDedication(item.id, "guest-1", "for Sam 🎂", db);
    expect(first?.charged).toBe(1);
    expect(balance("guest-1", db)).toBe(4);
    expect(getQueueItemById(item.id, db)!.paid).toBe(2);

    // editing the text again doesn't charge a second time
    const second = setMineDedication(item.id, "guest-1", "for Sam 🎂🎉", db);
    expect(second?.charged).toBe(0);
    expect(balance("guest-1", db)).toBe(4);
  });

  it("setMineDedication refuses another guest's song", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine" }).where(eq(queueItems.id, item.id)).run();
    expect(setMineDedication(item.id, "someone-else", "nope", db)).toBeNull();
  });

  it("sendToMysteryPool moves the song out of mine, and only one at a time", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = addItem(db, "guest-1", "a");
    const b = addItem(db, "guest-1", "b");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, a.id)).run();
    db.update(queueItems).set({ status: "mine", minePosition: 1 }).where(eq(queueItems.id, b.id)).run();

    expect(sendToMysteryPool(a.id, "guest-1", db)).toBe("ok");
    expect(getQueueItemById(a.id, db)!.status).toBe("pool");
    expect(getQueueItemById(a.id, db)!.anonymous).toBe(true);
    expect(getPoolItems("room-1", db)).toHaveLength(1);

    expect(sendToMysteryPool(b.id, "guest-1", db)).toBe("already_in_pool");
    expect(getQueueItemById(b.id, db)!.status).toBe("mine");
  });

  it("pullFromMysteryPool returns the song to the end of the guest's own queue", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = addItem(db, "guest-1", "a");
    const b = addItem(db, "guest-1", "b");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, a.id)).run();
    db.update(queueItems).set({ status: "pool", anonymous: true }).where(eq(queueItems.id, b.id)).run();

    const pulled = pullFromMysteryPool(b.id, "guest-1", db);
    expect(pulled?.status).toBe("mine");
    expect(pulled?.anonymous).toBe(false);
    expect(pulled?.minePosition).toBe(1);
    expect(getMineQueue("room-1", "guest-1", db).map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("removeRotationItem marks a never-played song skipped, no refund when nothing was charged", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine" }).where(eq(queueItems.id, item.id)).run();

    const result = removeRotationItem(item.id, "guest-1", 5, db);
    expect(result?.balanceAfterRefund).toBeNull();
    expect(getQueueItemById(item.id, db)!.status).toBe("skipped");
  });

  it("removeRotationItem refunds an on-deck song that was already charged", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 5 }, db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: -1, reason: "queue_add", cap: 5 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "on_deck", paid: 1 }).where(eq(queueItems.id, item.id)).run();

    const result = removeRotationItem(item.id, "guest-1", 5, db);
    expect(result?.balanceAfterRefund).toBe(5);
    expect(balance("guest-1", db)).toBe(5);
    expect(getQueueItemById(item.id, db)!.status).toBe("skipped");
  });

  it("removeRotationItem refuses another guest's song", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine" }).where(eq(queueItems.id, item.id)).run();
    expect(removeRotationItem(item.id, "someone-else", 5, db)).toBeNull();
  });
});

describe("host Queues board (R7)", () => {
  it("Draft now fills a free on-deck slot directly", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
    ensureRotationState("room-1", "guest-1", db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 20 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    const result = hostDraftItem("room-1", item.id, false, db);
    expect(result?.item.status).toBe("on_deck");
    expect(result?.item.draftedBy).toBe("host");
    expect(result?.chargedTokens).toBe(1);
    expect(result?.displaced).toBeNull();
    expect(balance("guest-1", db)).toBe(4);
  });

  it("a broke guest is always on the house — drafted anyway, charged nothing", () => {
    const db = createTestDb();
    seedRoomWithGuest(db); // guest-1 has 0 tokens
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    ensureRotationState("room-1", "guest-1", db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    const result = hostDraftItem("room-1", item.id, false, db); // onHouse not requested, but they're broke
    expect(result?.onHouse).toBe(true);
    expect(result?.chargedTokens).toBe(0);
    expect(result?.item.status).toBe("on_deck");
  });

  it("Draft now resets the drafted guest's turn credit", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
    ensureRotationState("room-1", "guest-1", db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 20 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    hostDraftItem("room-1", item.id, false, db);
    const roster = getRotationRoster("room-1", db);
    expect(roster[0].credit).toBeLessThan(0); // used their turn, same as an automatic draft would
    expect(roster[0].lastTurnAt).not.toBeNull();
  });

  it("when on deck is full, Draft now bumps the least-imminent song back to its owner, refunded, keeping their turn", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    addGuest(db, "guest-2");
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
    for (const g of ["guest-1", "guest-2"]) {
      ensureRotationState("room-1", g, db);
      apply({ roomId: "room-1", guestId: g, delta: 5, reason: "start", cap: 20 }, db);
    }
    // fill both on-deck slots (onDeckSize(2 guests) = 2) with guest-2's songs, already drafted
    const already1 = addItem(db, "guest-2", "already-1");
    const already2 = addItem(db, "guest-2", "already-2");
    db.update(queueItems).set({ status: "on_deck", position: 1, paid: 1 }).where(eq(queueItems.id, already1.id)).run();
    db.update(queueItems).set({ status: "on_deck", position: 2, paid: 1 }).where(eq(queueItems.id, already2.id)).run();

    const wanted = addItem(db, "guest-1", "wanted");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, wanted.id)).run();

    const result = hostDraftItem("room-1", wanted.id, false, db);
    expect(result?.item.status).toBe("on_deck");
    expect(result?.displaced?.trackUri).toBe("already-2"); // the least-imminent (highest position) one
    expect(getQueueItemById(already2.id, db)!.status).toBe("mine");
    expect(getQueueItemById(already2.id, db)!.minePosition).toBe(0);
    expect(balance("guest-2", db)).toBe(6); // started at 5; refunding already2's paid=1 brings it to 6
  });

  it("refuses to bump when every on-deck slot is already locked or playing", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation" }, db);
    ensureRotationState("room-1", "guest-1", db);
    const locked = addItem(db, "guest-1", "locked-song");
    db.update(queueItems).set({ status: "locked", position: 1 }).where(eq(queueItems.id, locked.id)).run();
    // onDeckSize(1 guest) = 2, so this alone isn't "full" yet — lock a second slot too
    const playing = addItem(db, "guest-1", "playing-song");
    db.update(queueItems).set({ status: "playing", position: 2 }).where(eq(queueItems.id, playing.id)).run();

    const wanted = addItem(db, "guest-1", "wanted");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, wanted.id)).run();

    expect(hostDraftItem("room-1", wanted.id, false, db)).toBeNull();
  });

  it("skipGuestTurn resets credit without drafting anything", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    addGuest(db, "guest-2");
    ensureRotationState("room-1", "guest-1", db);
    ensureRotationState("room-1", "guest-2", db);

    expect(skipGuestTurn("room-1", "guest-1", db)).toBe(true);
    const roster = getRotationRoster("room-1", db);
    const skipped = roster.find((r) => r.guestId === "guest-1")!;
    expect(skipped.credit).toBeLessThan(0); // treated the same as having just been drafted
    expect(skipped.lastTurnAt).not.toBeNull();

    expect(skipGuestTurn("room-1", "not-a-real-guest", db)).toBe(false);
  });

  it("draftRandomGuest drafts some eligible guest's top song", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    updateRoomSettings("room-1", { mode: "rotation", tokenCap: 20 }, db);
    ensureRotationState("room-1", "guest-1", db);
    apply({ roomId: "room-1", guestId: "guest-1", delta: 5, reason: "start", cap: 20 }, db);
    const item = addItem(db, "guest-1", "a");
    db.update(queueItems).set({ status: "mine", minePosition: 0 }).where(eq(queueItems.id, item.id)).run();

    const result = draftRandomGuest("room-1", false, db);
    expect(result?.item.id).toBe(item.id);
  });

  it("draftRandomGuest returns null when nobody's eligible", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    ensureRotationState("room-1", "guest-1", db);
    expect(draftRandomGuest("room-1", false, db)).toBeNull();
  });

  it("setGuestWeight accepts only the six documented values (R8, §8)", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    ensureRotationState("room-1", "guest-1", db);

    expect(setGuestWeight("room-1", "guest-1", 2, db)).toBe(true);
    expect(getRotationRoster("room-1", db)[0].weight).toBe(2);

    expect(setGuestWeight("room-1", "guest-1", 1.25, db)).toBe(false); // not one of the six steps
    expect(getRotationRoster("room-1", db)[0].weight).toBe(2); // unchanged by the rejected call

    expect(setGuestWeight("room-1", "not-a-guest", 2, db)).toBe(false);
  });
});

describe("nextMinePosition", () => {
  it("goes after the highest position, not at the queue length, once a draft has left a gap", () => {
    // After slot 0 is drafted the rest stay at 1, 2, 3: length 3 would tie with the last song.
    expect(nextMinePosition([{ minePosition: 1 }, { minePosition: 2 }, { minePosition: 3 }])).toBe(4);
  });

  it("starts at 0 for an empty queue", () => {
    expect(nextMinePosition([])).toBe(0);
  });
});

describe("getRotationRoster order", () => {
  it("returns guests in join order even when they joined in the same second", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    // ids chosen so UUID/index order is the reverse of join order
    addGuest(db, "zz-first");
    addGuest(db, "aa-second");
    ensureRotationState("room-1", "zz-first", db);
    ensureRotationState("room-1", "aa-second", db);
    const ids = getRotationRoster("room-1", db).map((r) => r.guestId);
    expect(ids.indexOf("zz-first")).toBeLessThan(ids.indexOf("aa-second"));
  });
});

describe("reorderMineQueue (guest or host)", () => {
  it("applies an exact reordering of the guest's queue, and rejects anything else", async () => {
    const { createTestDb, seedRoomWithGuest } = await import("./test-helpers.js");
    const { addQueueItem } = await import("./queue.js");
    const { reorderMineQueue, getMineQueue } = await import("./rotation.js");
    const { queueItems } = await import("./schema.js");
    const { eq } = await import("drizzle-orm");
    const db = createTestDb();
    seedRoomWithGuest(db);
    const ids = [0, 1, 2].map((i) => {
      const item = addQueueItem(
        { roomId: "room-1", trackUri: `t${i}`, trackName: `t${i}`, artistName: "A", albumArtUrl: null, durationMs: 1000, addedBy: "guest-1" },
        db,
      );
      db.update(queueItems).set({ status: "mine", minePosition: i }).where(eq(queueItems.id, item.id)).run();
      return item.id;
    });
    expect(reorderMineQueue("room-1", "guest-1", [ids[2], ids[0], ids[1]], db)).toBe(true);
    expect(getMineQueue("room-1", "guest-1", db).map((m) => m.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(reorderMineQueue("room-1", "guest-1", [ids[0], ids[1]], db)).toBe(false); // missing one
    expect(reorderMineQueue("room-1", "guest-1", [ids[0], ids[0], ids[1]], db)).toBe(false); // duplicate
    expect(reorderMineQueue("room-1", "guest-1", "nope", db)).toBe(false);
  });
});

describe("placeHostSong (Rotation mode host adds)", () => {
  it("house: waits in the host's list, in the order added", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const a = addItem(db, null, "host-a");
    const b = addItem(db, null, "host-b");
    placeHostSong("room-1", a.id, "house", db);
    placeHostSong("room-1", b.id, "house", db);
    expect(getHouseItems("room-1", db).map((h) => h.trackUri)).toEqual(["host-a", "host-b"]);
  });

  it("next: goes on deck straight after the playing song, ahead of anything already waiting", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const playing = addItem(db, "guest-1", "playing");
    const waiting = addItem(db, "guest-1", "waiting");
    db.update(queueItems).set({ status: "playing", position: 1 }).where(eq(queueItems.id, playing.id)).run();
    db.update(queueItems).set({ status: "on_deck", position: 2 }).where(eq(queueItems.id, waiting.id)).run();
    const host = addItem(db, null, "host-next");
    placeHostSong("room-1", host.id, "next", db);
    const order = db.select().from(queueItems).where(inArray(queueItems.status, ["playing", "on_deck"])).orderBy(queueItems.position).all();
    expect(order.map((o) => o.trackUri)).toEqual(["playing", "host-next", "waiting"]);
  });

  it("house: replaces a fallback track that's up next", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const fallback = addQueueItem(
      { roomId: "room-1", trackUri: "fallback", trackName: "f", artistName: "A", albumArtUrl: null, durationMs: 1, addedBy: null, source: "fallback" },
      db,
    );
    db.update(queueItems).set({ status: "on_deck", position: 1 }).where(eq(queueItems.id, fallback.id)).run();
    const host = addItem(db, null, "host-song");
    placeHostSong("room-1", host.id, "house", db);
    expect(getQueueItemById(fallback.id, db)).toBeUndefined();
    const after = getQueueItemById(host.id, db)!;
    expect(after.status).toBe("on_deck");
    expect(after.draftedBy).toBe("house");
  });
});
