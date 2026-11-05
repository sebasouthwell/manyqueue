import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { TokenReason } from "@manyqueue/shared";
import { db as defaultDb, type DB, type DBOrTx } from "./client.js";
import { tokenEvents } from "./schema.js";

export class InsufficientTokensError extends Error {
  constructor() {
    super("Not enough tokens for this change");
    this.name = "InsufficientTokensError";
  }
}

export class TokenCapExceededError extends Error {
  constructor() {
    super("This change would exceed the token cap");
    this.name = "TokenCapExceededError";
  }
}

const REFUND_REASONS: TokenReason[] = ["refund_reject", "refund_expire", "refund_contest"];

/** The balance is always SUM(delta) — never stored as a separate number, so it
 * can't drift from the events that produced it. */
export function balance(guestId: string, database: DB = defaultDb): number {
  const row = database
    .select({ total: sql<number>`coalesce(sum(${tokenEvents.delta}), 0)` })
    .from(tokenEvents)
    .where(eq(tokenEvents.guestId, guestId))
    .get();
  return row?.total ?? 0;
}

export interface ApplyTokenParams {
  roomId: string;
  guestId: string;
  delta: number;
  reason: TokenReason;
  refId?: string;
  actor?: string;
  cap: number;
}

export interface ApplyTokenResult {
  balance: number;
  delta: number;
}

/**
 * The core balance-check-and-write, assuming the caller is already inside a
 * transaction (`tx`) — so it can be composed with other writes (e.g. inserting
 * a paid queue item) that must succeed or fail together with the token spend.
 *
 * Rejects (throws) any change that would go below 0 or above the cap, except
 * refunds (refund_reject/expire/contest), which are allowed past the cap but
 * clamped to cap + 1 rather than rejected outright — it's the guest's own token
 * coming back, not new income.
 */
export function applyInTransaction(tx: DBOrTx, params: ApplyTokenParams): ApplyTokenResult {
  const current =
    tx
      .select({ total: sql<number>`coalesce(sum(${tokenEvents.delta}), 0)` })
      .from(tokenEvents)
      .where(eq(tokenEvents.guestId, params.guestId))
      .get()?.total ?? 0;

  let delta = params.delta;
  let next = current + delta;

  if (next < 0) {
    throw new InsufficientTokensError();
  }

  const isRefund = REFUND_REASONS.includes(params.reason);
  const maxAllowed = isRefund ? params.cap + 1 : params.cap;

  if (next > maxAllowed) {
    if (!isRefund) {
      throw new TokenCapExceededError();
    }
    delta = maxAllowed - current;
    next = maxAllowed;
  }

  tx.insert(tokenEvents)
    .values({
      id: crypto.randomUUID(),
      roomId: params.roomId,
      guestId: params.guestId,
      delta,
      reason: params.reason,
      refId: params.refId ?? null,
      actor: params.actor ?? null,
      createdAt: new Date(),
    })
    .run();

  return { balance: next, delta };
}

/**
 * Applies a token change in its own transaction — reads the current balance,
 * checks it against the floor (0) and cap, writes the event, and returns the
 * new balance, all atomically, so two concurrent spends can't both read the
 * same stale balance and both succeed when only one should.
 *
 * For a change that must be atomic with another write (e.g. a paid queue
 * insert), open the outer transaction yourself and call
 * `applyInTransaction(tx, params)` inside it instead.
 */
export function apply(params: ApplyTokenParams, database: DB = defaultDb): ApplyTokenResult {
  return database.transaction((tx) => applyInTransaction(tx, params));
}

export function history(guestId: string, database: DB = defaultDb) {
  return database
    .select()
    .from(tokenEvents)
    .where(eq(tokenEvents.guestId, guestId))
    .orderBy(tokenEvents.createdAt)
    .all();
}
