import { describe, it, expect } from "vitest";
import { createTestDb, seedRoomWithGuest } from "./test-helpers.js";
import { balance, apply, InsufficientTokensError, TokenCapExceededError } from "./tokens.js";

describe("token ledger", () => {
  it("balance is the sum of events, starting at 0", () => {
    const db = createTestDb();
    const { guestId } = seedRoomWithGuest(db);
    expect(balance(guestId, db)).toBe(0);
  });

  it("apply records an event and returns the new balance", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);

    const result = apply({ roomId, guestId, delta: 3, reason: "start", cap: 5 }, db);
    expect(result).toEqual({ balance: 3, delta: 3 });
    expect(balance(guestId, db)).toBe(3);
  });

  it("rejects a spend that would take the balance below 0", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);
    apply({ roomId, guestId, delta: 1, reason: "start", cap: 5 }, db);

    expect(() => apply({ roomId, guestId, delta: -2, reason: "queue_add", cap: 5 }, db)).toThrow(
      InsufficientTokensError,
    );
    // The rejected attempt must not have written an event.
    expect(balance(guestId, db)).toBe(1);
  });

  it("rejects a non-refund gain that would exceed the cap", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);
    apply({ roomId, guestId, delta: 5, reason: "start", cap: 5 }, db);

    expect(() => apply({ roomId, guestId, delta: 1, reason: "passive", cap: 5 }, db)).toThrow(
      TokenCapExceededError,
    );
    expect(balance(guestId, db)).toBe(5);
  });

  it("clamps a refund at the cap + 1 instead of rejecting it", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);
    apply({ roomId, guestId, delta: 5, reason: "start", cap: 5 }, db);

    const result = apply(
      { roomId, guestId, delta: 3, reason: "refund_reject", cap: 5 },
      db,
    );
    // Guest was at 5 (the cap); a refund can push to cap+1 = 6, but not further,
    // even though the nominal delta was 3.
    expect(result.balance).toBe(6);
    expect(result.delta).toBe(1);
    expect(balance(guestId, db)).toBe(6);
  });

  it("a refund that doesn't cross the cap applies in full", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);
    apply({ roomId, guestId, delta: 2, reason: "start", cap: 5 }, db);

    const result = apply({ roomId, guestId, delta: 1, reason: "refund_reject", cap: 5 }, db);
    expect(result).toEqual({ balance: 3, delta: 1 });
  });

  it("concurrent spends against a tight balance: only one of two can succeed", () => {
    const db = createTestDb();
    const { roomId, guestId } = seedRoomWithGuest(db);
    apply({ roomId, guestId, delta: 1, reason: "start", cap: 5 }, db);

    // better-sqlite3 is synchronous, so "concurrent" here means two spends racing
    // against the same starting balance with no await between the read and the
    // write — exactly the scenario the transaction has to serialize correctly.
    let succeeded = 0;
    let rejected = 0;
    for (const _ of [1, 2]) {
      try {
        apply({ roomId, guestId, delta: -1, reason: "queue_add", cap: 5 }, db);
        succeeded++;
      } catch (err) {
        if (err instanceof InsufficientTokensError) rejected++;
        else throw err;
      }
    }

    expect(succeeded).toBe(1);
    expect(rejected).toBe(1);
    expect(balance(guestId, db)).toBe(0);
  });
});
