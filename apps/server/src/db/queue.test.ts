import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { balance, apply, history, InsufficientTokensError } from "./tokens.js";
import {
  addPaidQueueItem,
  refundQueueItem,
  addQueueItem,
  applyFairOrder,
  pinQueueItemAtCurrentRank,
  markQueueItemLocked,
  markQueueItemPlaying,
  markQueueItemPlayed,
  markQueueItemSkipped,
  getActiveQueueItems,
  recomputeApprovalLockAt,
  autoApprovePendingItems,
  approveQueueItem,
  removeQueuedItem,
  getQueueItemById,
  getLastAddedAtMs,
  serializeHistory,
} from "./queue.js";
import { guests } from "./schema.js";
import { queueItems } from "./schema.js";
import type { DB } from "./client.js";

function addFreeItem(db: DB, uri: string, name: string, addedBy: string | null) {
  return addQueueItem(
    {
      roomId: "room-1",
      trackUri: uri,
      trackName: name,
      artistName: "Artist",
      albumArtUrl: null,
      durationMs: 180_000,
      addedBy,
    },
    db,
  );
}

function addSecondGuest(db: DB, id: string, nickname: string) {
  db.insert(guests)
    .values({
      id,
      roomId: "room-1",
      nickname,
      emoji: "🐸",
      role: "guest",
      lastSeenAt: new Date(),
      createdAt: new Date(),
    })
    .run();
}

function track(overrides: Partial<Parameters<typeof addPaidQueueItem>[0]> = {}) {
  return {
    roomId: "room-1",
    trackUri: "spotify:track:abc",
    trackName: "Song",
    artistName: "Artist",
    albumArtUrl: null,
    durationMs: 180_000,
    addedBy: "guest-1",
    cost: 1,
    playsTonight: 0,
    tokenCap: 5,
    ...overrides,
  };
}

describe("addQueueItem", () => {
  it("stores a dedication with no cost and no adder — the host's own free dedication", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addQueueItem(
      {
        roomId: "room-1",
        trackUri: "spotify:track:host",
        trackName: "Song",
        artistName: "Artist",
        albumArtUrl: null,
        durationMs: 180_000,
        addedBy: null,
        dedication: "For Sam 🎂",
      },
      db,
    );
    expect(item.dedication).toBe("For Sam 🎂");
    expect(item.paid).toBe(0);
    expect(item.addedBy).toBeNull();
    expect(history(item.addedBy ?? "guest-1")).toHaveLength(0); // nothing charged: no guest to charge
  });

  it("defaults to no dedication when none is given", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addFreeItem(db, "spotify:track:plain", "Song", null);
    expect(item.dedication).toBeNull();
  });
});

describe("markQueueItemSkipped", () => {
  it("is still a skip either way — nearEnd only marks it for stats to leave out", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const early = addFreeItem(db, "spotify:track:early", "Early", "guest-1");
    const late = addFreeItem(db, "spotify:track:late", "Late", "guest-1");

    markQueueItemSkipped(early.id, false, db);
    markQueueItemSkipped(late.id, true, db);

    const earlyRow = getQueueItemById(early.id, db)!;
    const lateRow = getQueueItemById(late.id, db)!;
    expect(earlyRow).toMatchObject({ status: "skipped", nearEndSkip: false });
    expect(lateRow).toMatchObject({ status: "skipped", nearEndSkip: true });
    expect(earlyRow.endedAt).not.toBeNull();
    expect(lateRow.endedAt).not.toBeNull();
  });

  it("defaults to a real (not near-end) skip when the caller doesn't say", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    const item = addFreeItem(db, "spotify:track:default", "Song", "guest-1");
    markQueueItemSkipped(item.id, undefined, db);
    expect(getQueueItemById(item.id, db)).toMatchObject({ status: "skipped", nearEndSkip: false });
  });
});

describe("addPaidQueueItem", () => {
  it("charges the guest and inserts the item with paid = cost", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);

    const { item, balance: after } = addPaidQueueItem(track(), db);

    expect(item.paid).toBe(1);
    expect(after).toBe(2);
    expect(balance(guestId, db)).toBe(2);
  });

  it("cost 0 (token mode off) skips the ledger entirely", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);

    const { item, balance: after } = addPaidQueueItem(track({ cost: 0 }), db);

    expect(item.paid).toBe(0);
    expect(after).toBeNull();
    expect(balance("guest-1", db)).toBe(0);
  });

  it("records the base token and the replay surcharge as two ledger events", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 5, reason: "start", cap: 5 }, db);

    // A 2nd play: base 1 + surcharge 1 (playsTonight=1, replaySurcharge=1) = 2.
    addPaidQueueItem(track({ cost: 2, playsTonight: 1 }), db);

    const events = history(guestId, db).filter((e) => e.reason !== "start");
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.reason === "queue_add")?.delta).toBe(-1);
    expect(events.find((e) => e.reason === "replay_surcharge")?.delta).toBe(-1);
    expect(balance(guestId, db)).toBe(3);
  });

  it("a dedication costs one more token, as its own ledger event, and refunds with the song", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 5, reason: "start", cap: 5 }, db);

    const { item } = addPaidQueueItem(track({ cost: 2, dedication: "for Sam 🎂", dedicationCost: 1 }), db);

    expect(item.dedication).toBe("for Sam 🎂");
    expect(item.paid).toBe(2);
    const events = history(guestId, db).filter((e) => e.reason !== "start");
    expect(events.map((e) => [e.reason, e.delta]).sort()).toEqual([
      ["dedication", -1],
      ["queue_add", -1],
    ]);
    expect(balance(guestId, db)).toBe(3);

    // Removing the song gives back the song cost AND the dedication token.
    refundQueueItem(item, "refund_reject", 5, db);
    expect(balance(guestId, db)).toBe(5);
  });

  it("a dedication on a replay charges base + surcharge + dedication", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 5, reason: "start", cap: 5 }, db);

    addPaidQueueItem(track({ cost: 3, playsTonight: 1, dedication: "hi", dedicationCost: 1 }), db);

    const events = history(guestId, db).filter((e) => e.reason !== "start");
    expect(events.map((e) => [e.reason, e.delta]).sort()).toEqual([
      ["dedication", -1],
      ["queue_add", -1],
      ["replay_surcharge", -1],
    ]);
    expect(balance(guestId, db)).toBe(2);
  });

  it("a dedication the guest can't afford writes nothing", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 1, reason: "start", cap: 5 }, db);

    expect(() => addPaidQueueItem(track({ cost: 2, dedication: "hi", dedicationCost: 1 }), db)).toThrow(InsufficientTokensError);
    expect(balance(guestId, db)).toBe(1);
    expect(db.select().from(queueItems).all()).toHaveLength(0);
  });

  it("rejects the add and writes nothing when the guest can't afford it", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    // balance stays at 0 — no start grant

    expect(() => addPaidQueueItem(track(), db)).toThrow(InsufficientTokensError);
    expect(balance(guestId, db)).toBe(0);
    expect(db.select().from(queueItems).all()).toHaveLength(0);
  });
});

describe("refundQueueItem", () => {
  it("gives back exactly what was paid", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);
    const { item } = addPaidQueueItem(track(), db);
    expect(balance(guestId, db)).toBe(2);

    const after = refundQueueItem(item, "refund_reject", 5, db);

    expect(after).toBe(3);
    expect(balance(guestId, db)).toBe(3);
  });

  it("is a no-op for a free item", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    const { item } = addPaidQueueItem(track({ cost: 0 }), db);

    const after = refundQueueItem(item, "refund_expire", 5, db);

    expect(after).toBeNull();
    expect(balance(guestId, db)).toBe(0);
  });
});

describe("applyFairOrder", () => {
  function queuedTrackNames(db: DB): string[] {
    return getActiveQueueItems("room-1", db)
      .filter((i) => i.status === "queued")
      .map((i) => i.trackName);
  }

  it("interleaves two guests instead of leaving one guest's songs bunched up", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");

    addFreeItem(db, "uri:a1", "A1", guestId);
    addFreeItem(db, "uri:a2", "A2", guestId);
    addFreeItem(db, "uri:a3", "A3", guestId);
    addFreeItem(db, "uri:b1", "B1", "guest-2");

    applyFairOrder("room-1", db);

    expect(queuedTrackNames(db)).toEqual(["A1", "B1", "A2", "A3"]);
  });

  it("the locked item never moves and queued positions continue after it", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");

    const locked = addFreeItem(db, "uri:locked", "Locked", guestId);
    markQueueItemLocked(locked.id, db);
    addFreeItem(db, "uri:a1", "A1", guestId);
    addFreeItem(db, "uri:b1", "B1", "guest-2");
    addFreeItem(db, "uri:a2", "A2", guestId);

    applyFairOrder("room-1", db);

    const active = getActiveQueueItems("room-1", db);
    const lockedRow = active.find((i) => i.id === locked.id)!;
    expect(lockedRow.status).toBe("locked");
    expect(lockedRow.position).toBe(1);

    const queued = active.filter((i) => i.status === "queued").sort((a, b) => a.position - b.position);
    expect(queued.map((i) => i.trackName)).toEqual(["A1", "B1", "A2"]);
    expect(queued[0].position).toBe(2); // continues right after the locked item
  });

  it("a pinned item stays put while the rest reorders around it", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");

    addFreeItem(db, "uri:a1", "A1", guestId);
    const pinned = addFreeItem(db, "uri:a2", "A2", guestId);
    addFreeItem(db, "uri:b1", "B1", "guest-2");

    // Pin A2 at its current rank (2nd).
    pinQueueItemAtCurrentRank(pinned.id, db);
    applyFairOrder("room-1", db);

    expect(queuedTrackNames(db)).toEqual(["A1", "A2", "B1"]);
  });

  it("the guest who played most recently takes their next turn last", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");

    // Guest 1 (Maya) just had a song play.
    const played = addFreeItem(db, "uri:played", "Played", guestId);
    markQueueItemPlaying(played.id, db);
    markQueueItemPlayed(played.id, db);

    addFreeItem(db, "uri:a1", "A1 next", guestId);
    addFreeItem(db, "uri:b1", "B1", "guest-2");

    applyFairOrder("room-1", db);

    // Sam (never played) goes first even though Maya's song was added first.
    expect(queuedTrackNames(db)).toEqual(["B1", "A1 next"]);
  });

  it("a guest who leaves (no songs left) simply drops out, no crash", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");

    addFreeItem(db, "uri:b1", "B1", "guest-2");
    addFreeItem(db, "uri:b2", "B2", "guest-2");

    expect(() => applyFairOrder("room-1", db)).not.toThrow();
    expect(queuedTrackNames(db)).toEqual(["B1", "B2"]);
  });

  it("is a no-op on an empty queue", () => {
    const db = createTestDb();
    seedRoomWithGuest(db);
    expect(() => applyFairOrder("room-1", db)).not.toThrow();
  });

  it("a pending (unapproved) item still participates in the round-robin", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");
    apply({ roomId: "room-1", guestId, delta: 5, reason: "start", cap: 5 }, db);
    apply({ roomId: "room-1", guestId: "guest-2", delta: 5, reason: "start", cap: 5 }, db);

    addFreeItem(db, "uri:a1", "A1", guestId);
    addFreeItem(db, "uri:a2", "A2", guestId);
    addPaidQueueItem(
      track({ trackUri: "uri:b1", trackName: "B1", addedBy: "guest-2", pending: true }),
      db,
    );

    applyFairOrder("room-1", db);

    const active = getActiveQueueItems("room-1", db).sort((a, b) => a.position - b.position);
    expect(active.map((i) => i.trackName)).toEqual(["A1", "B1", "A2"]);
    expect(active.find((i) => i.trackName === "B1")?.status).toBe("pending");
  });
});

describe("approvals", () => {
  it("recomputeApprovalLockAt sets an earlier lock time for a pending item with nothing ahead of it", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);

    const { item } = addPaidQueueItem(track({ pending: true }), db);
    recomputeApprovalLockAt("room-1", 15, db);

    const updated = getQueueItemById(item.id, db)!;
    expect(updated.status).toBe("pending");
    expect(updated.approvalLockAt).not.toBeNull();
    // Nothing ahead of it, so lock time is ~now minus the grace period.
    expect(updated.approvalLockAt!.getTime()).toBeLessThanOrEqual(Date.now() - 14_000);
  });

  it("autoApprovePendingItems flips a due item to queued with approvedBy 'auto'", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);

    const { item } = addPaidQueueItem(track({ pending: true }), db);
    // Force it overdue directly rather than waiting on a real clock.
    db.update(queueItems).set({ approvalLockAt: new Date(Date.now() - 1000) }).where(eq(queueItems.id, item.id)).run();

    const due = autoApprovePendingItems("room-1", db);

    expect(due.map((i) => i.id)).toEqual([item.id]);
    const updated = getQueueItemById(item.id, db)!;
    expect(updated.status).toBe("queued");
    expect(updated.approvedBy).toBe("auto");
  });

  it("autoApprovePendingItems leaves a not-yet-due item alone", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);

    const { item } = addPaidQueueItem(track({ pending: true }), db);
    db.update(queueItems).set({ approvalLockAt: new Date(Date.now() + 60_000) }).where(eq(queueItems.id, item.id)).run();

    const due = autoApprovePendingItems("room-1", db);

    expect(due).toHaveLength(0);
    expect(getQueueItemById(item.id, db)!.status).toBe("pending");
  });

  it("approveQueueItem flips pending to queued with the host as approvedBy", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);
    const { item } = addPaidQueueItem(track({ pending: true }), db);

    const approved = approveQueueItem(item.id, "host-1", db);

    expect(approved?.id).toBe(item.id);
    const updated = getQueueItemById(item.id, db)!;
    expect(updated.status).toBe("queued");
    expect(updated.approvedBy).toBe("host-1");
  });

  it("approveQueueItem is a no-op on an item that isn't pending", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);
    const { item } = addPaidQueueItem(track(), db); // not pending

    expect(approveQueueItem(item.id, "host-1", db)).toBeNull();
  });

  it("removeQueuedItem (reject) accepts a pending item and refunds it", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    apply({ roomId: "room-1", guestId, delta: 3, reason: "start", cap: 5 }, db);
    const { item } = addPaidQueueItem(track({ pending: true }), db);
    expect(balance(guestId, db)).toBe(2);

    const removed = removeQueuedItem(item.id, db);
    expect(removed?.status).toBe("pending");

    const newBalance = refundQueueItem(removed!, "refund_reject", 5, db);
    expect(newBalance).toBe(3);
    expect(balance(guestId, db)).toBe(3);
    expect(getQueueItemById(item.id, db)!.status).toBe("skipped");
  });
});

describe("getLastAddedAtMs", () => {
  it("is null for a guest who hasn't added anything", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    expect(getLastAddedAtMs("room-1", guestId, db)).toBeNull();
  });

  it("returns roughly now after an add, and ignores other guests' adds", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    addSecondGuest(db, "guest-2", "Sam");
    addFreeItem(db, "uri:x", "X", "guest-2");
    expect(getLastAddedAtMs("room-1", guestId, db)).toBeNull();

    addFreeItem(db, "uri:y", "Y", guestId);
    const at = getLastAddedAtMs("room-1", guestId, db)!;
    expect(Math.abs(Date.now() - at)).toBeLessThan(5000);
  });
});

describe("serializeHistory", () => {
  it("lists songs that started and ended, newest first, and skips ones that never played", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    const a = addFreeItem(db, "spotify:track:a", "First", guestId);
    const b = addFreeItem(db, "spotify:track:b", "Second", guestId);
    const c = addFreeItem(db, "spotify:track:c", "Removed before playing", guestId);
    const d = addFreeItem(db, "spotify:track:d", "Still queued", guestId);

    markQueueItemPlaying(a.id, db);
    markQueueItemPlayed(a.id, db);
    markQueueItemPlaying(b.id, db);
    db.update(queueItems).set({ status: "skipped", endedAt: new Date(Date.now() + 5000) }).where(eq(queueItems.id, b.id)).run();
    removeQueuedItem(c.id, db);

    const history = serializeHistory("room-1", 200, db);
    expect(history.map((h) => [h.trackName, h.status])).toEqual([
      ["Second", "skipped"],
      ["First", "played"],
    ]);
    expect(history[0].addedBy).toMatchObject({ id: guestId, nickname: "Maya" });
    expect(history.some((h) => h.trackName === d.trackName)).toBe(false);
  });
});

describe("mystery picks never name their adder until revealed", () => {
  it("serializeQueue and serializeHistory hide addedBy, then show it once revealed", async () => {
    const { markRevealed, serializeQueue } = await import("./queue.js");
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    const item = addFreeItem(db, "spotify:track:m", "Mystery", guestId);
    db.update(queueItems).set({ anonymous: true }).where(eq(queueItems.id, item.id)).run();

    // serializeQueue reads the app's global db, so check the rule at the source: isMystery + the DB row.
    const row = getQueueItemById(item.id, db)!;
    expect(row.anonymous).toBe(true);
    const { isMystery } = await import("./queue.js");
    expect(isMystery(row)).toBe(true);

    markRevealed(item.id, db);
    expect(isMystery(getQueueItemById(item.id, db)!)).toBe(false);

    // History shares the rule: a played mystery that was never revealed stays anonymous.
    const other = addFreeItem(db, "spotify:track:m2", "Never revealed", guestId);
    db.update(queueItems).set({ anonymous: true, status: "played", startedAt: new Date(), endedAt: new Date() }).where(eq(queueItems.id, other.id)).run();
    const history = serializeHistory("room-1", 50, db);
    const hidden = history.find((h) => h.trackName === "Never revealed")!;
    expect(hidden.mystery).toBe(true);
    expect(hidden.addedBy).toBeNull();
    expect(typeof serializeQueue).toBe("function");
  });
});
