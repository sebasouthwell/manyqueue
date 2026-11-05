import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, desc, sql } from "drizzle-orm";
import { db, type DB, type DBOrTx } from "./client.js";
import { queueItems, guests, hearts } from "./schema.js";
import { apply, applyInTransaction } from "./tokens.js";
import { reactionSummaries } from "./reaction-stats.js";
import { logAction } from "./action-log.js";
import { fairOrder, type HistoryItemView, type QueueItemView, type TokenReason } from "@manyqueue/shared";

export type QueueItem = typeof queueItems.$inferSelect;

const ACTIVE_STATUSES: QueueItem["status"][] = ["pending", "queued", "locked", "playing"];

/**
 * A mystery pick whose reveal hasn't happened yet. This is the one rule every
 * payload that names who queued a song must go through: while it holds, the
 * adder is not sent to anyone (phones, the TV, the host), only the flag.
 */
export function isMystery(item: Pick<QueueItem, "anonymous" | "revealed">): boolean {
  return item.anonymous && !item.revealed;
}

export function markRevealed(itemId: string, database: DB = db): void {
  database.update(queueItems).set({ revealed: true }).where(eq(queueItems.id, itemId)).run();
}

/** An ordinary song that just started a casual "who queued this?" round: hidden like a real mystery pick
 * (same isMystery flag, same leak rule) for the round, revealed the same way when it closes. */
export function markCasualMystery(itemId: string, database: DB = db): void {
  database.update(queueItems).set({ anonymous: true, revealed: false }).where(eq(queueItems.id, itemId)).run();
}

export function getActiveQueueItems(roomId: string, database: DBOrTx = db): QueueItem[] {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ACTIVE_STATUSES)))
    .orderBy(queueItems.position)
    .all();
}

const ON_DECK_ACTIVE_STATUSES: QueueItem["status"][] = ["on_deck", "locked", "playing"];

/** Rotation mode's on-deck list (the Rotation-mode design §5) — the only queue the player loop hands off from
 * while a room is in Rotation mode; slot order is `position`, same column Shared mode uses. Includes
 * a slot once it's locked or playing (mirrors Shared mode's ACTIVE_STATUSES) — leaving those out would
 * both starve the player loop's handoff state machine of the item it's mid-handoff on, and mean the
 * locked slot vanishes from every client's view right when the UI should flag it "🔒 Locked". */
export function getOnDeckItems(roomId: string, database: DBOrTx = db): QueueItem[] {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ON_DECK_ACTIVE_STATUSES)))
    .orderBy(queueItems.position)
    .all();
}

/** Everything actually heard tonight, in play order — for the end-of-night export.
 * Includes the currently playing item too, if the host ends the night mid-song. */
export function getPlayedItemsInOrder(roomId: string): QueueItem[] {
  return db
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["played", "playing"])))
    .orderBy(queueItems.startedAt)
    .all();
}

export function getPlayingItem(roomId: string): QueueItem | undefined {
  return getActiveQueueItems(roomId).find((i) => i.status === "playing");
}

export function getAllTrackUrisForRoom(roomId: string): Set<string> {
  const rows = db
    .select({ trackUri: queueItems.trackUri })
    .from(queueItems)
    .where(eq(queueItems.roomId, roomId))
    .all();
  return new Set(rows.map((r) => r.trackUri));
}

export function findActiveItemByTrackUri(roomId: string, trackUri: string): QueueItem | undefined {
  return getActiveQueueItems(roomId).find((i) => i.trackUri === trackUri);
}

/** How many times this track has already played (or been skipped mid-play)
 * tonight in this room — house picks count too. Drives replay pricing. A row that was removed or
 * rejected before it ever started is also stored as "skipped" but never played, so it doesn't count. */
export function countPlaysTonight(roomId: string, trackUri: string, database: DB = db): number {
  const row = database
    .select({ count: sql<number>`count(*)` })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        eq(queueItems.trackUri, trackUri),
        inArray(queueItems.status, ["played", "skipped"]),
        sql`${queueItems.startedAt} is not null`,
      ),
    )
    .get();
  return row?.count ?? 0;
}

/** When this guest last added a song (any status) — for the add cooldown. */
export function getLastAddedAtMs(roomId: string, guestId: string, database: DB = db): number | null {
  const row = database
    .select({ latest: sql<number | null>`max(${queueItems.addedAt})` })
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.addedBy, guestId)))
    .get();
  // Timestamp-mode columns store epoch seconds.
  return row?.latest ? row.latest * 1000 : null;
}

/** Total songs finished (played or skipped after starting) tonight, across every track —
 * drives passive income's "every N songs" cadence and the game/AI cadences. Songs removed or rejected
 * before they started are stored as "skipped" too, but they were never played. */
export function countSongsFinished(roomId: string, database: DB = db): number {
  const row = database
    .select({ count: sql<number>`count(*)` })
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["played", "skipped"]), sql`${queueItems.startedAt} is not null`))
    .get();
  return row?.count ?? 0;
}

function nextPosition(roomId: string, database: DBOrTx = db): number {
  const items = getActiveQueueItems(roomId, database);
  return items.length === 0 ? 1 : Math.max(...items.map((i) => i.position)) + 1;
}

function buildQueueItem(
  params: {
    roomId: string;
    trackUri: string;
    trackName: string;
    artistName: string;
    albumArtUrl: string | null;
    durationMs: number;
    addedBy: string | null;
    source?: QueueItem["source"];
    paid?: number;
    playsTonight?: number;
    id?: string;
    status?: "queued" | "pending";
    dedication?: string | null;
    anonymous?: boolean;
  },
  database: DBOrTx = db,
): QueueItem {
  return {
    id: params.id ?? crypto.randomUUID(),
    roomId: params.roomId,
    trackUri: params.trackUri,
    trackName: params.trackName,
    artistName: params.artistName,
    albumArtUrl: params.albumArtUrl,
    durationMs: params.durationMs,
    addedBy: params.addedBy,
    source: params.source ?? "queue",
    status: params.status ?? "queued",
    paid: params.paid ?? 0,
    playsTonight: params.playsTonight ?? 0,
    pinnedPosition: null,
    position: nextPosition(params.roomId, database),
    addedAt: new Date(),
    lockedAt: null,
    startedAt: null,
    endedAt: null,
    approvalLockAt: null,
    approvedBy: null,
    dedication: params.dedication ?? null,
    dedicationHidden: false,
    anonymous: params.anonymous ?? false,
    revealed: false,
    nearEndSkip: false,
    minePosition: null,
    draftedAt: null,
    draftedBy: null,
  };
}

export function addQueueItem(
  params: {
    roomId: string;
    trackUri: string;
    trackName: string;
    artistName: string;
    albumArtUrl: string | null;
    durationMs: number;
    addedBy: string | null;
    source?: QueueItem["source"];
    /** The host's own dedications are free (no guest, no token cost) — see the host-add route. */
    dedication?: string | null;
  },
  database: DB = db,
): QueueItem {
  const item = buildQueueItem(params, database);
  database.insert(queueItems).values(item).run();
  return item;
}

/**
 * Charges the guest and inserts the queue item in one transaction: if the
 * token spend fails (insufficient balance), the queue insert never happens
 * either. `cost` of 0 skips the ledger write entirely (token mode off).
 *
 * The base token and any replay surcharge are recorded as two separate
 * ledger events (when both apply) so stats can tell a first play from a
 * replay later — see priceFor in @manyqueue/shared.
 */
export function addPaidQueueItem(
  params: {
    roomId: string;
    trackUri: string;
    trackName: string;
    artistName: string;
    albumArtUrl: string | null;
    durationMs: number;
    addedBy: string;
    cost: number;
    playsTonight: number;
    tokenCap: number;
    pending?: boolean;
    /** Already checked text; its token (dedicationCost) is part of `cost`. */
    dedication?: string | null;
    dedicationCost?: number;
    /** Queue it as a mystery pick; anonymousCost is part of `cost`. */
    anonymous?: boolean;
    anonymousCost?: number;
  },
  database: DB = db,
): { item: QueueItem; balance: number | null } {
  return database.transaction((tx) => {
    const itemId = crypto.randomUUID();
    let balanceAfter: number | null = null;
    const dedicationCost = params.dedicationCost ?? 0;
    const anonymousCost = params.anonymousCost ?? 0;
    const songCost = params.cost - dedicationCost - anonymousCost;
    if (params.cost > 0) {
      const base = Math.min(1, songCost);
      const surcharge = songCost - base;

      const baseGrant = applyInTransaction(tx, {
        roomId: params.roomId,
        guestId: params.addedBy,
        delta: -base,
        reason: "queue_add",
        refId: itemId,
        cap: params.tokenCap,
      });
      balanceAfter = baseGrant.balance;

      if (surcharge > 0) {
        const surchargeGrant = applyInTransaction(tx, {
          roomId: params.roomId,
          guestId: params.addedBy,
          delta: -surcharge,
          reason: "replay_surcharge",
          refId: itemId,
          cap: params.tokenCap,
        });
        balanceAfter = surchargeGrant.balance;
      }

      if (anonymousCost > 0) {
        balanceAfter = applyInTransaction(tx, {
          roomId: params.roomId,
          guestId: params.addedBy,
          delta: -anonymousCost,
          reason: "anonymous",
          refId: itemId,
          cap: params.tokenCap,
        }).balance;
      }

      if (dedicationCost > 0) {
        const dedicationGrant = applyInTransaction(tx, {
          roomId: params.roomId,
          guestId: params.addedBy,
          delta: -dedicationCost,
          reason: "dedication",
          refId: itemId,
          cap: params.tokenCap,
        });
        balanceAfter = dedicationGrant.balance;
      }
    }

    const item = buildQueueItem(
      {
        ...params,
        id: itemId,
        paid: params.cost,
        playsTonight: params.playsTonight,
        status: params.pending ? "pending" : "queued",
      },
      tx,
    );
    tx.insert(queueItems).values(item).run();
    return { item, balance: balanceAfter };
  });
}

/** Refunds a queue item's paid cost, if any — used when the host removes an
 * unplayed song, or the night ends with it still queued. No-op for free adds. */
export function refundQueueItem(
  item: QueueItem,
  reason: Extract<TokenReason, "refund_reject" | "refund_expire">,
  tokenCap: number,
  database: DB = db,
): number | null {
  if (item.paid <= 0 || !item.addedBy) return null;
  const grant = apply(
    {
      roomId: item.roomId,
      guestId: item.addedBy,
      delta: item.paid,
      reason,
      refId: item.id,
      cap: tokenCap,
    },
    database,
  );
  return grant.balance;
}

export function getQueueItemById(id: string, database: DBOrTx = db): QueueItem | undefined {
  return database.select().from(queueItems).where(eq(queueItems.id, id)).get();
}

export function getQueueItemsByIds(ids: string[], database: DB = db): QueueItem[] {
  if (ids.length === 0) return [];
  return database.select().from(queueItems).where(inArray(queueItems.id, ids)).all();
}

/** How many songs this guest has ever added tonight, any status — for the Me
 * tab's stats row. */
export function countSongsAddedBy(roomId: string, guestId: string, database: DB = db): number {
  const row = database
    .select({ count: sql<number>`count(*)` })
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.addedBy, guestId)))
    .get();
  return row?.count ?? 0;
}

export function markQueueItemLocked(id: string, database: DBOrTx = db): void {
  database
    .update(queueItems)
    .set({ status: "locked", lockedAt: new Date() })
    .where(eq(queueItems.id, id))
    .run();
}

export function markQueueItemPlaying(id: string, database: DBOrTx = db): void {
  database
    .update(queueItems)
    .set({ status: "playing", startedAt: new Date() })
    .where(eq(queueItems.id, id))
    .run();
}

export function markQueueItemPlayed(id: string, database: DBOrTx = db): void {
  database
    .update(queueItems)
    .set({ status: "played", endedAt: new Date() })
    .where(eq(queueItems.id, id))
    .run();
}

/** `nearEnd`: the caller already worked out the skip landed at/after SKIP_NEAR_END_PERCENT through the song
 * (see isNearEndSkip in shared) — still stored as a skip, but skip-counting stats leave it out. */
export function markQueueItemSkipped(id: string, nearEnd = false, database: DBOrTx = db): void {
  database
    .update(queueItems)
    .set({ status: "skipped", endedAt: new Date(), nearEndSkip: nearEnd })
    .where(eq(queueItems.id, id))
    .run();
}

/** Only removes an item that hasn't started down the handoff path yet — a
 * locked/playing item is already committed to Spotify's own queue or actively
 * playing, so removal there would just desync us from what's really happening.
 * Covers both a normal host removal (queued) and an approvals rejection
 * (pending) — same "hasn't started yet" semantics either way. */
export function removeQueuedItem(itemId: string, database: DB = db): QueueItem | null {
  const item = getQueueItemById(itemId, database);
  if (!item || (item.status !== "queued" && item.status !== "pending")) return null;
  markQueueItemSkipped(itemId, false, database);
  return item;
}

export function moveQueueItem(roomId: string, itemId: string, direction: "up" | "down"): boolean {
  const queued = getActiveQueueItems(roomId)
    .filter((i) => i.status === "queued")
    .sort((a, b) => a.position - b.position);
  const index = queued.findIndex((i) => i.id === itemId);
  if (index === -1) return false;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= queued.length) return false;

  const a = queued[index];
  const b = queued[swapIndex];
  db.update(queueItems).set({ position: b.position }).where(eq(queueItems.id, a.id)).run();
  db.update(queueItems).set({ position: a.position }).where(eq(queueItems.id, b.id)).run();
  return true;
}

export function addHeartIfAbsent(queueItemId: string, guestId: string): boolean {
  const existing = db
    .select()
    .from(hearts)
    .where(and(eq(hearts.queueItemId, queueItemId), eq(hearts.guestId, guestId)))
    .get();
  if (existing) return false;
  db.insert(hearts).values({ queueItemId, guestId }).run();
  return true;
}

function getHeartCounts(itemIds: string[]): Map<string, number> {
  if (itemIds.length === 0) return new Map();
  const rows = db
    .select({ queueItemId: hearts.queueItemId, count: sql<number>`count(*)` })
    .from(hearts)
    .where(inArray(hearts.queueItemId, itemIds))
    .groupBy(hearts.queueItemId)
    .all();
  return new Map(rows.map((r) => [r.queueItemId, r.count]));
}

export function serializeQueue(roomId: string): QueueItemView[] {
  const items = getActiveQueueItems(roomId);
  const guestIds = [...new Set(items.map((i) => i.addedBy).filter((x): x is string => !!x))];
  const guestRows = guestIds.length
    ? db.select().from(guests).where(inArray(guests.id, guestIds)).all()
    : [];
  const guestMap = new Map(guestRows.map((g) => [g.id, g]));
  const heartCounts = getHeartCounts(items.map((i) => i.id));

  return items.map((item) => {
    const mystery = isMystery(item);
    const guest = item.addedBy && !mystery ? guestMap.get(item.addedBy) : undefined;
    return {
      id: item.id,
      trackUri: item.trackUri,
      trackName: item.trackName,
      artistName: item.artistName,
      albumArtUrl: item.albumArtUrl,
      durationMs: item.durationMs,
      position: item.position,
      status: item.status,
      addedBy: guest ? { id: guest.id, nickname: guest.nickname, emoji: guest.emoji } : null,
      source: item.source,
      hearts: heartCounts.get(item.id) ?? 0,
      paid: item.paid,
      playsTonight: item.playsTonight,
      pinnedPosition: item.pinnedPosition,
      approvalLockAt: item.approvalLockAt ? item.approvalLockAt.getTime() : null,
      dedication: item.dedication && !item.dedicationHidden ? item.dedication : null,
      dedicationHidden: !!item.dedication && item.dedicationHidden,
      mystery,
    } satisfies QueueItemView;
  });
}

/** Guests whose song most recently started playing, most-recent-first —
 * drives fairOrder's "played most recently goes last" rule. Only counts
 * items that actually started (startedAt set); a song the host removed
 * before it ever played doesn't count as "having had a turn". */
export function getRecentlyPlayedGuestIds(roomId: string, database: DB = db): string[] {
  const rows = database
    .select({ addedBy: queueItems.addedBy, startedAt: queueItems.startedAt })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        isNotNull(queueItems.startedAt),
        isNotNull(queueItems.addedBy),
      ),
    )
    .orderBy(desc(queueItems.startedAt))
    .all();

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of rows) {
    if (row.addedBy && !seen.has(row.addedBy)) {
      seen.add(row.addedBy);
      result.push(row.addedBy);
    }
  }
  return result;
}

/**
 * Recomputes and persists `position` for every `queued` item using fairOrder
 * — locked/playing items are never touched (the locked item never moves).
 * No-op on an empty queue. Call after any add, remove, or finished song.
 */
export function applyFairOrder(roomId: string, database: DB = db): void {
  // Pending items are still "waiting their turn" for fairness purposes, even
  // though they can't be handed off to Spotify until approved.
  const queued = database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["queued", "pending"])))
    .orderBy(queueItems.position)
    .all();
  if (queued.length === 0) return;

  const recentlyPlayed = getRecentlyPlayedGuestIds(roomId, database);
  const reordered = fairOrder(
    queued.map((q) => ({ id: q.id, addedBy: q.addedBy, pinnedPosition: q.pinnedPosition })),
    recentlyPlayed,
  );

  const lockedOrPlaying = database
    .select({ position: queueItems.position })
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["locked", "playing"])))
    .all();
  const basePosition = lockedOrPlaying.length
    ? Math.max(...lockedOrPlaying.map((r) => r.position))
    : 0;

  reordered.forEach((item, idx) => {
    database
      .update(queueItems)
      .set({ position: basePosition + idx + 1 })
      .where(eq(queueItems.id, item.id))
      .run();
  });
}

/** Pins an item at its current rank among queued items (1-indexed) — a
 * manual host reorder expresses explicit intent that fairOrder must respect. */
export function pinQueueItemAtCurrentRank(itemId: string, database: DB = db): void {
  const item = database.select().from(queueItems).where(eq(queueItems.id, itemId)).get();
  if (!item || item.status !== "queued") return;

  const queued = database
    .select({ id: queueItems.id })
    .from(queueItems)
    .where(and(eq(queueItems.roomId, item.roomId), eq(queueItems.status, "queued")))
    .orderBy(queueItems.position)
    .all();
  const rank = queued.findIndex((q) => q.id === itemId);
  if (rank === -1) return;

  database
    .update(queueItems)
    .set({ pinnedPosition: rank + 1 })
    .where(eq(queueItems.id, itemId))
    .run();
}

/**
 * Recomputes approvalLockAt for every pending item, using the same
 * cumulative-wait-time estimate the guest queue banner uses (sum of what's
 * ahead of it in current position order) minus approvalGraceSec — "silence
 * = approval, just before the handoff". Call whenever the queue changes:
 * add, remove, approve, reorder, or a poll tick.
 */
export function recomputeApprovalLockAt(
  roomId: string,
  approvalGraceSec: number,
  database: DB = db,
): void {
  const active = getActiveQueueItems(roomId, database).sort((a, b) => a.position - b.position);
  const now = Date.now();
  let cumulativeMs = 0;
  for (const item of active) {
    if (item.status === "pending") {
      const lockAt = new Date(now + cumulativeMs - approvalGraceSec * 1000);
      database
        .update(queueItems)
        .set({ approvalLockAt: lockAt })
        .where(eq(queueItems.id, item.id))
        .run();
    }
    cumulativeMs += item.durationMs;
  }
}

/**
 * Auto-approves any pending item whose approvalLockAt has passed. Ordering
 * guarantees only the immediate next-up pending item is ever due at a given
 * tick — everything ahead of it in position order has an equal or earlier
 * lock time, so it would already have been approved on a prior tick.
 */
export function autoApprovePendingItems(roomId: string, database: DB = db): QueueItem[] {
  const now = new Date();
  const due = getActiveQueueItems(roomId, database).filter(
    (item): item is QueueItem & { approvalLockAt: Date } =>
      item.status === "pending" && item.approvalLockAt !== null && item.approvalLockAt <= now,
  );
  for (const item of due) {
    database
      .update(queueItems)
      .set({ status: "queued", approvedBy: "auto" })
      .where(eq(queueItems.id, item.id))
      .run();
    logAction(
      { roomId, actor: "system", action: "auto_approve", target: item.id, detail: item.trackName },
      database,
    );
  }
  return due;
}

/** Host approves a pending item ahead of its silent auto-approval. */
export function approveQueueItem(itemId: string, hostId: string, database: DB = db): QueueItem | null {
  const item = database.select().from(queueItems).where(eq(queueItems.id, itemId)).get();
  if (!item || item.status !== "pending") return null;

  database
    .update(queueItems)
    .set({ status: "queued", approvedBy: hostId })
    .where(eq(queueItems.id, itemId))
    .run();
  logAction(
    { roomId: item.roomId, actor: hostId, action: "approve", target: itemId, detail: item.trackName },
    database,
  );
  return item;
}

export function setDedicationHidden(itemId: string, hidden: boolean, database: DB = db): void {
  database.update(queueItems).set({ dedicationHidden: hidden }).where(eq(queueItems.id, itemId)).run();
}

/** Songs that actually started and are now over — played through or skipped
 * mid-play — newest first. A song the host removed before it ever played
 * isn't history. */
export function getHistoryItems(roomId: string, limit = 200, database: DB = db): QueueItem[] {
  return database
    .select()
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        inArray(queueItems.status, ["played", "skipped"]),
        isNotNull(queueItems.startedAt),
      ),
    )
    .orderBy(desc(queueItems.endedAt))
    .limit(limit)
    .all();
}

export function serializeHistory(roomId: string, limit = 200, database: DB = db): HistoryItemView[] {
  const items = getHistoryItems(roomId, limit, database);
  const summaries = reactionSummaries(items.map((i) => i.id), database);
  const guestIds = [...new Set(items.map((i) => i.addedBy).filter((x): x is string => !!x))];
  const guestMap = new Map(
    (guestIds.length ? database.select().from(guests).where(inArray(guests.id, guestIds)).all() : []).map((g) => [g.id, g]),
  );
  return items.map((item) => {
    const mystery = isMystery(item);
    const guest = item.addedBy && !mystery ? guestMap.get(item.addedBy) : undefined;
    return {
      id: item.id,
      trackName: item.trackName,
      artistName: item.artistName,
      albumArtUrl: item.albumArtUrl,
      durationMs: item.durationMs,
      status: item.status as "played" | "skipped",
      addedBy: guest ? { id: guest.id, nickname: guest.nickname, emoji: guest.emoji } : null,
      source: item.source,
      endedAt: (item.endedAt ?? item.startedAt ?? new Date(0)).getTime(),
      mystery,
      reactions: summaries.get(item.id)?.reactions ?? [],
      topReactor: summaries.get(item.id)?.topReactor ?? null,
    } satisfies HistoryItemView;
  });
}
