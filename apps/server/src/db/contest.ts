import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { loserOutcome, type ContestPoolEntryView } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { contestPool, guests, queueItems } from "./schema.js";
import { applyInTransaction } from "./tokens.js";
import type { QueueItem } from "./queue.js";

export type PoolEntry = typeof contestPool.$inferSelect;

export class AlreadyInPoolError extends Error {
  constructor() {
    super("This guest already has a song in the contest pool");
    this.name = "AlreadyInPoolError";
  }
}

export function getPoolEntry(id: string, database: DB = defaultDb): PoolEntry | undefined {
  return database.select().from(contestPool).where(eq(contestPool.id, id)).get();
}

/** Oldest first — the order entries are paired in and ties are settled by. */
export function listPoolEntries(roomId: string, database: DB = defaultDb): PoolEntry[] {
  return database.select().from(contestPool).where(eq(contestPool.roomId, roomId)).orderBy(asc(contestPool.createdAt)).all();
}

export function getPoolEntryForGuest(roomId: string, guestId: string, database: DB = defaultDb): PoolEntry | undefined {
  return database
    .select()
    .from(contestPool)
    .where(and(eq(contestPool.roomId, roomId), eq(contestPool.enteredBy, guestId)))
    .get();
}

export function isTrackInPool(roomId: string, trackUri: string, database: DB = defaultDb): boolean {
  return !!database
    .select({ id: contestPool.id })
    .from(contestPool)
    .innerJoin(queueItems, eq(queueItems.id, contestPool.queueItemId))
    .where(and(eq(contestPool.roomId, roomId), eq(queueItems.trackUri, trackUri)))
    .get();
}

/** Every song sitting in the contest (the queue's own listings never include these). */
export function listContestItems(roomId: string, database: DB = defaultDb): QueueItem[] {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "contest")))
    .all();
}

/**
 * Puts a song in the pool: charges the entry token, and stores the song as a
 * queue row with status "contest" so it stays out of the queue, fair order and
 * the Spotify handoff until it wins or loses twice. One entry per guest.
 */
export function enterContestPool(
  params: {
    roomId: string;
    guestId: string;
    trackUri: string;
    trackName: string;
    artistName: string;
    albumArtUrl: string | null;
    durationMs: number;
    cost: number;
    tokenCap: number;
    anonymous?: boolean;
  },
  database: DB = defaultDb,
): { entry: PoolEntry; item: QueueItem; balance: number | null } {
  return database.transaction((tx) => {
    if (getPoolEntryForGuest(params.roomId, params.guestId, tx as unknown as DB)) throw new AlreadyInPoolError();

    const itemId = crypto.randomUUID();
    let balance: number | null = null;
    if (params.cost > 0) {
      balance = applyInTransaction(tx, {
        roomId: params.roomId,
        guestId: params.guestId,
        delta: -params.cost,
        reason: "contest_entry",
        refId: itemId,
        cap: params.tokenCap,
      }).balance;
    }

    const now = new Date();
    const item: QueueItem = {
      id: itemId,
      roomId: params.roomId,
      trackUri: params.trackUri,
      trackName: params.trackName,
      artistName: params.artistName,
      albumArtUrl: params.albumArtUrl,
      durationMs: params.durationMs,
      addedBy: params.guestId,
      source: "queue",
      status: "contest",
      paid: params.cost,
      playsTonight: 0,
      pinnedPosition: null,
      position: 0,
      addedAt: now,
      lockedAt: null,
      startedAt: null,
      endedAt: null,
      approvalLockAt: null,
      approvedBy: null,
      dedication: null,
      dedicationHidden: false,
      anonymous: params.anonymous ?? false,
      revealed: false,
      nearEndSkip: false,
      minePosition: null,
      draftedAt: null,
      draftedBy: null,
    };
    tx.insert(queueItems).values(item).run();
    const entry: PoolEntry = {
      id: crypto.randomUUID(),
      roomId: params.roomId,
      queueItemId: itemId,
      enteredBy: params.guestId,
      losses: 0,
      createdAt: now,
    };
    tx.insert(contestPool).values(entry).run();
    return { entry, item, balance };
  });
}

export interface ContestSettlement {
  winnerItem: QueueItem;
  loserItem: QueueItem;
  /** The winner's entrant after the refund, or null if nothing was refunded. */
  winnerBalance: number | null;
  loserJoinedQueue: boolean;
}

/**
 * The vote is over. The winner leaves the pool for the front of the queue and
 * its entry token comes back (paid drops to 0, so a later removal can't refund
 * it twice); it is pinned to slot 1, pushing anything already pinned down one,
 * which is the single deliberate exception to fair order. The loser goes back
 * to the pool once; after a second loss it becomes an ordinary queued song
 * (still paid for, refundable like any other).
 */
export function settleContest(
  params: { winnerEntryId: string; loserEntryId: string; tokenCap: number },
  database: DB = defaultDb,
): ContestSettlement {
  return database.transaction((tx) => {
    const winnerEntry = getPoolEntry(params.winnerEntryId, tx as unknown as DB);
    const loserEntry = getPoolEntry(params.loserEntryId, tx as unknown as DB);
    if (!winnerEntry || !loserEntry) throw new Error("contest entry no longer in the pool");

    const winnerItem = tx.select().from(queueItems).where(eq(queueItems.id, winnerEntry.queueItemId)).get()!;
    const loserItem = tx.select().from(queueItems).where(eq(queueItems.id, loserEntry.queueItemId)).get()!;

    let winnerBalance: number | null = null;
    if (winnerItem.paid > 0) {
      winnerBalance = applyInTransaction(tx, {
        roomId: winnerItem.roomId,
        guestId: winnerEntry.enteredBy,
        delta: winnerItem.paid,
        reason: "refund_contest",
        refId: winnerItem.id,
        cap: params.tokenCap,
      }).balance;
    }

    // Everything already pinned in the queue slides down one to make slot 1.
    tx.update(queueItems)
      .set({ pinnedPosition: sql`${queueItems.pinnedPosition} + 1` })
      .where(and(eq(queueItems.roomId, winnerItem.roomId), eq(queueItems.status, "queued"), sql`${queueItems.pinnedPosition} is not null`))
      .run();
    const maxPos =
      tx
        .select({ m: sql<number>`coalesce(max(${queueItems.position}), 0)` })
        .from(queueItems)
        .where(and(eq(queueItems.roomId, winnerItem.roomId), sql`${queueItems.status} != 'contest'`))
        .get()?.m ?? 0;
    tx.update(queueItems)
      .set({ status: "queued", paid: 0, pinnedPosition: 1, position: maxPos + 1, addedAt: new Date() })
      .where(eq(queueItems.id, winnerItem.id))
      .run();
    tx.delete(contestPool).where(eq(contestPool.id, winnerEntry.id)).run();

    const lossesAfter = loserEntry.losses + 1;
    const joins = loserOutcome(lossesAfter) === "join_queue";
    if (joins) {
      tx.update(queueItems)
        .set({ status: "queued", position: maxPos + 2, addedAt: new Date() })
        .where(eq(queueItems.id, loserItem.id))
        .run();
      tx.delete(contestPool).where(eq(contestPool.id, loserEntry.id)).run();
    } else {
      tx.update(contestPool).set({ losses: lossesAfter }).where(eq(contestPool.id, loserEntry.id)).run();
    }

    return {
      winnerItem: { ...winnerItem, status: "queued", paid: 0, pinnedPosition: 1 },
      loserItem: joins ? { ...loserItem, status: "queued" } : loserItem,
      winnerBalance,
      loserJoinedQueue: joins,
    };
  });
}

/** Takes an entry out of the pool (host removed it, guest left, night ended)
 * and returns what its entrant paid. The queue row is marked skipped. */
export function removePoolEntry(
  entryId: string,
  reason: "refund_reject" | "refund_expire",
  tokenCap: number,
  database: DB = defaultDb,
): { entry: PoolEntry; item: QueueItem; balance: number | null } | null {
  return database.transaction((tx) => {
    const entry = getPoolEntry(entryId, tx as unknown as DB);
    if (!entry) return null;
    const item = tx.select().from(queueItems).where(eq(queueItems.id, entry.queueItemId)).get()!;
    let balance: number | null = null;
    if (item.paid > 0) {
      balance = applyInTransaction(tx, {
        roomId: item.roomId,
        guestId: entry.enteredBy,
        delta: item.paid,
        reason,
        refId: item.id,
        cap: tokenCap,
      }).balance;
    }
    tx.update(queueItems).set({ status: "skipped", paid: 0, endedAt: new Date() }).where(eq(queueItems.id, item.id)).run();
    tx.delete(contestPool).where(eq(contestPool.id, entry.id)).run();
    return { entry, item, balance };
  });
}

export function serializePool(roomId: string, database: DB = defaultDb): ContestPoolEntryView[] {
  const entries = listPoolEntries(roomId, database);
  if (entries.length === 0) return [];
  const items = new Map(listContestItems(roomId, database).map((i) => [i.id, i]));
  const guestRows = new Map(
    database.select().from(guests).where(eq(guests.roomId, roomId)).all().map((g) => [g.id, g]),
  );
  return entries.map((e) => {
    const item = items.get(e.queueItemId);
    const mystery = !!item && item.anonymous && !item.revealed;
    const g = mystery ? undefined : guestRows.get(e.enteredBy);
    return {
      id: e.id,
      queueItemId: e.queueItemId,
      trackName: item?.trackName ?? "",
      artistName: item?.artistName ?? "",
      albumArtUrl: item?.albumArtUrl ?? null,
      enteredBy: g ? { id: g.id, nickname: g.nickname, emoji: g.emoji } : null,
      mystery,
      losses: e.losses,
      createdAt: e.createdAt.getTime(),
    };
  });
}
