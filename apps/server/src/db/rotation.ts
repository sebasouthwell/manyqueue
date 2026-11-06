import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { priceFor, ANONYMOUS_COST, onDeckSize, TURN_WEIGHTS, applyWeightChange } from "@manyqueue/shared";
import { db, type DB } from "./client.js";
import { queueItems, guests, rotationState } from "./schema.js";
import { apply, balance } from "./tokens.js";
import {
  applyFairOrder,
  getQueueItemById,
  getOnDeckItems,
  markQueueItemSkipped,
  refundQueueItem,
  type QueueItem,
} from "./queue.js";
import { getRoomSettings } from "./settings.js";

export type RotationState = typeof rotationState.$inferSelect;

export function ensureRotationState(roomId: string, guestId: string, database: DB = db): void {
  const existing = database
    .select()
    .from(rotationState)
    .where(and(eq(rotationState.roomId, roomId), eq(rotationState.guestId, guestId)))
    .get();
  if (existing) return;
  // §5 rule 2: joining mid-party goes to the end of the line: no turns left in this round, so everyone
  // still owed one goes first and the newcomer's first turn is in the next round (see startRound in
  // @manyqueue/shared for how rounds work).
  const credit = 0;
  database
    .insert(rotationState)
    .values({ roomId, guestId, credit, weight: 1, lastTurnAt: null, joinedAt: new Date(), active: true })
    .run();
}

export function getRotationRoster(roomId: string, database: DB = db): RotationState[] {
  // In join order. Times here are whole seconds, so guests who join in the same second tie on every
  // time-based tie-break and the sorts fall back to this order. Without the orderBy SQLite reads through
  // the (room_id, guest_id) index, i.e. random UUID order: Ben got the first turn ahead of Ana.
  return database
    .select()
    .from(rotationState)
    .where(eq(rotationState.roomId, roomId))
    .orderBy(rotationState.joinedAt, sql`rowid`)
    .all();
}

export function getMineQueue(roomId: string, guestId: string, database: DB = db) {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.addedBy, guestId), eq(queueItems.status, "mine")))
    .orderBy(queueItems.minePosition, queueItems.addedAt)
    .all();
}

/** Where a song joins the end of a guest's queue. Not `mine.length`: drafting or deleting a song leaves
 * the rest at their old positions (1, 2, 3 after slot 0 is drafted), so the length can collide with the
 * last song's position and leave two songs tied. */
export function nextMinePosition(mine: { minePosition: number | null }[]): number {
  return mine.reduce((max, m) => Math.max(max, m.minePosition ?? -1), -1) + 1;
}

export function getPoolItems(roomId: string, database: DB = db) {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "pool")))
    .orderBy(queueItems.addedAt)
    .all();
}

/**
 * Rotation mode: where a song the host just added goes (it was inserted as a plain row).
 * - "next": up next on deck, straight after whatever is playing or already handed to Spotify; a house
 *   slot waiting there gives way (a fallback track is dropped, another host song goes back to waiting).
 * - "house": the host's waiting list for house picks. If a fallback track is up next right now, the
 *   host's song takes its place at once: it's the "next house pick" either way.
 */
export function placeHostSong(roomId: string, itemId: string, placement: "next" | "house", database: DB = db): void {
  const onDeck = database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["on_deck", "locked", "playing"])))
    .orderBy(queueItems.position)
    .all();
  const fixed = onDeck.filter((o) => o.status !== "on_deck");
  const waiting = onDeck.filter((o) => o.status === "on_deck");
  const firstWaiting = waiting[0];
  const firstIsHouse = !!firstWaiting && (firstWaiting.source === "fallback" || firstWaiting.draftedBy === "house");
  const giveWay = () => {
    if (!firstWaiting) return;
    if (firstWaiting.source === "fallback") {
      try {
        database.delete(queueItems).where(eq(queueItems.id, firstWaiting.id)).run();
        return;
      } catch {
        // Someone already reacted to it, so the row is referenced: just park it as skipped.
        database.update(queueItems).set({ status: "skipped", endedAt: new Date() }).where(eq(queueItems.id, firstWaiting.id)).run();
        return;
      }
    }
    database.update(queueItems).set({ status: "house", draftedAt: null, draftedBy: null, position: -1 }).where(eq(queueItems.id, firstWaiting.id)).run();
  };

  if (placement === "next" || firstIsHouse) {
    if (firstIsHouse) giveWay();
    const base = fixed.length ? Math.max(...fixed.map((o) => o.position)) + 1 : 1;
    database
      .update(queueItems)
      .set({ status: "on_deck", draftedAt: new Date(), draftedBy: placement === "next" ? "host" : "house", position: base, paid: 0 })
      .where(eq(queueItems.id, itemId))
      .run();
    // Everything else still waiting on deck moves back one.
    let p = base + 1;
    for (const w of waiting) {
      if (firstIsHouse && w.id === firstWaiting.id) continue;
      database.update(queueItems).set({ position: p++ }).where(eq(queueItems.id, w.id)).run();
    }
    return;
  }
  const house = getHouseItems(roomId, database);
  const position = house.length ? Math.max(...house.map((h) => h.position)) + 1 : 0;
  database.update(queueItems).set({ status: "house", position, paid: 0 }).where(eq(queueItems.id, itemId)).run();
}

/** The host's songs waiting for a house pick, in the order they'll take one (not the pinned ones). */
export function getHouseItems(roomId: string, database: DB = db) {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "house"), isNull(queueItems.pinnedPosition)))
    .orderBy(queueItems.position, queueItems.addedAt)
    .all();
}

/** The host's songs pinned to a slot in Coming up, soonest first. `pinnedPosition` is the slot: how many
 * more songs get drafted before it (0 = it's next). */
export function getPinnedHostItems(roomId: string, database: DB = db) {
  return database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "house"), isNotNull(queueItems.pinnedPosition)))
    .orderBy(queueItems.pinnedPosition, queueItems.addedAt)
    .all();
}

/** Pins a host song to a slot in Coming up (null unpins it back to the house picks). */
export function setHostPickSlot(roomId: string, itemId: string, slot: number | null, database: DB = db): boolean {
  const item = database.select().from(queueItems).where(eq(queueItems.id, itemId)).get();
  if (!item || item.roomId !== roomId || item.status !== "house") return false;
  database
    .update(queueItems)
    .set({ pinnedPosition: slot === null ? null : Math.max(0, Math.min(50, Math.round(slot))) })
    .where(eq(queueItems.id, itemId))
    .run();
  return true;
}

/** Songs were drafted onto deck: every pinned host song moves that many slots closer. */
export function advancePinnedHostItems(roomId: string, drafted: number, database: DB = db): void {
  if (drafted <= 0) return;
  for (const p of getPinnedHostItems(roomId, database)) {
    database
      .update(queueItems)
      .set({ pinnedPosition: Math.max(0, (p.pinnedPosition ?? 0) - drafted) })
      .where(eq(queueItems.id, p.id))
      .run();
  }
}

export function setRotationCredit(
  roomId: string,
  guestId: string,
  credit: number,
  lastTurnAt: Date | null,
  database: DB = db,
): void {
  database
    .update(rotationState)
    .set({ credit, lastTurnAt })
    .where(and(eq(rotationState.roomId, roomId), eq(rotationState.guestId, guestId)))
    .run();
}

/** Host only (§8, §9). Takes effect in the current round (applyWeightChange in @manyqueue/shared). */
export function setGuestWeight(roomId: string, guestId: string, weight: number, database: DB = db): boolean {
  if (!(TURN_WEIGHTS as readonly number[]).includes(weight)) return false;
  const existing = database
    .select()
    .from(rotationState)
    .where(and(eq(rotationState.roomId, roomId), eq(rotationState.guestId, guestId)))
    .get();
  if (!existing) return false;
  const next = applyWeightChange({ weight: existing.weight, credit: existing.credit, lastTurnAt: existing.lastTurnAt?.getTime() ?? null }, weight);
  database
    .update(rotationState)
    .set({ weight, credit: next.credit, lastTurnAt: next.lastTurnAt === null ? null : new Date(next.lastTurnAt) })
    .where(and(eq(rotationState.roomId, roomId), eq(rotationState.guestId, guestId)))
    .run();
  return true;
}

/**
 * Runs the data side of a Shared <-> Rotation mode switch (the Rotation-mode design §16, D1-D2). Called after
 * the room's `settings.mode` has already been written to the new value — this only moves rows around
 * and settles token charges. It never touches the currently locked/playing song or played/skipped
 * history; only the still-waiting part of the queue is affected.
 */
export function switchRoomMode(roomId: string, to: "shared" | "rotation", database: DB = db): void {
  if (to === "rotation") migrateSharedToRotation(roomId, database);
  else migrateRotationToShared(roomId, database);
}

/** Shared → Rotation: the shared queue splits into personal queues, keeping each guest's order.
 * Anonymous items — and ownerless leftovers like an unplayed house pick, which have nowhere else to
 * go — become mystery-pool entries instead. */
function migrateSharedToRotation(roomId: string, database: DB): void {
  const activeGuests = database
    .select()
    .from(guests)
    .where(and(eq(guests.roomId, roomId), isNull(guests.kickedAt)))
    .all();
  for (const g of activeGuests) ensureRotationState(roomId, g.id, database);

  const items = database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["queued", "pending"])))
    .orderBy(queueItems.position)
    .all();

  const nextPositionByGuest = new Map<string, number>();
  // Songs waiting in Shared mode's contest pool become fight entries (same pool row, same entry fee).
  database
    .update(queueItems)
    .set({ status: "in_fight", minePosition: 9999 })
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "contest")))
    .run();
  for (const item of items) {
    // The host's own songs (ownerless, not a mystery): they take the house picks, ahead of the fallback.
    if (!item.addedBy && !item.anonymous && item.source === "queue") {
      database
        .update(queueItems)
        .set({ status: "house", minePosition: null, draftedAt: null, draftedBy: null, pinnedPosition: null })
        .where(eq(queueItems.id, item.id))
        .run();
      continue;
    }
    if (item.anonymous || !item.addedBy) {
      database
        .update(queueItems)
        .set({ status: "pool", minePosition: null, draftedAt: null, draftedBy: null })
        .where(eq(queueItems.id, item.id))
        .run();
      continue;
    }
    const position = nextPositionByGuest.get(item.addedBy) ?? 0;
    nextPositionByGuest.set(item.addedBy, position + 1);
    database
      .update(queueItems)
      .set({ status: "mine", minePosition: position, draftedAt: null, draftedBy: null })
      .where(eq(queueItems.id, item.id))
      .run();
  }
}

/** Rotation → Shared: personal queues and the pool merge back into one list, fair-ordered. Anything
 * not already paid is charged now — on the house (whatever they can afford, never blocked) for anyone
 * who can't cover it — since nothing charges twice, `paid` items are left alone. */
function migrateRotationToShared(roomId: string, database: DB): void {
  const settings = getRoomSettings(roomId, database);
  // Fight entries become Shared contest entries (same pool row, same entry fee).
  database
    .update(queueItems)
    .set({ status: "contest", minePosition: null })
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "in_fight")))
    .run();
  const items = database
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.roomId, roomId), inArray(queueItems.status, ["mine", "pool", "house"])))
    .orderBy(queueItems.addedAt)
    .all();

  let position = 0;
  for (const item of items) {
    let paid = item.paid; // items already settled (e.g. a Shared -> Rotation -> Shared round trip) keep their real amount
    if (!item.paid && item.addedBy && settings.tokenMode) {
      const price =
        priceFor(item.playsTonight, settings.replaySurcharge) +
        (item.dedication ? 1 : 0) +
        (item.anonymous ? ANONYMOUS_COST : 0);
      if (price > 0) {
        const current = balance(item.addedBy, database);
        const charge = Math.min(price, current);
        if (charge > 0) {
          apply(
            { roomId, guestId: item.addedBy, delta: -charge, reason: "queue_add", refId: item.id, cap: settings.tokenCap },
            database,
          );
        }
        paid = charge; // the actual amount charged, same convention refundQueueItem() elsewhere relies on
      }
    }
    database
      .update(queueItems)
      .set({ status: "queued", paid, position, minePosition: null, draftedAt: null, draftedBy: null, pinnedPosition: null })
      .where(eq(queueItems.id, item.id))
      .run();
    position++;
  }

  applyFairOrder(roomId, database);
}

// ---- Song action sheet (R5, §11): dedicate/edit, mystery pool, remove ----

/** Sets or edits a dedication on a guest's own queued/on-deck song. If it's already on deck, the extra
 * token is charged right away (§10); if it's still in the guest's own queue, the normal draft-time
 * price already accounts for a dedication (priceOf in @manyqueue/shared) — never both. */
export function setMineDedication(
  itemId: string,
  guestId: string,
  dedication: string | null,
  database: DB = db,
): { item: QueueItem; charged: number } | null {
  const item = getQueueItemById(itemId, database);
  if (!item || item.addedBy !== guestId || (item.status !== "mine" && item.status !== "on_deck")) return null;

  let charged = 0;
  if (item.status === "on_deck" && !item.dedication && dedication) {
    const settings = getRoomSettings(item.roomId, database);
    if (settings.tokenMode) {
      charged = Math.min(1, balance(guestId, database));
      if (charged > 0) {
        apply({ roomId: item.roomId, guestId, delta: -charged, reason: "dedication", refId: itemId, cap: settings.tokenCap }, database);
        database.update(queueItems).set({ paid: item.paid + charged }).where(eq(queueItems.id, itemId)).run();
      }
    }
  }

  database.update(queueItems).set({ dedication }).where(eq(queueItems.id, itemId)).run();
  return { item: getQueueItemById(itemId, database)!, charged };
}

/** Moves a song from "mine" into the mystery pool — leaves the rotation entirely until drafted (§7).
 * Only one song per guest may be in the pool at once. */
export function sendToMysteryPool(itemId: string, guestId: string, database: DB = db): "ok" | "not_found" | "already_in_pool" {
  const item = getQueueItemById(itemId, database);
  if (!item || item.addedBy !== guestId || item.status !== "mine") return "not_found";
  const existing = getPoolItems(item.roomId, database).find((p) => p.addedBy === guestId);
  if (existing) return "already_in_pool";
  database.update(queueItems).set({ status: "pool", anonymous: true, minePosition: null }).where(eq(queueItems.id, itemId)).run();
  return "ok";
}

/** Pulls a song back out of the pool into the guest's own queue — only while it's still waiting there. */
export function pullFromMysteryPool(itemId: string, guestId: string, database: DB = db): QueueItem | null {
  const item = getQueueItemById(itemId, database);
  if (!item || item.addedBy !== guestId || item.status !== "pool") return null;
  const mine = getMineQueue(item.roomId, guestId, database);
  database
    .update(queueItems)
    .set({ status: "mine", anonymous: false, minePosition: nextMinePosition(mine) })
    .where(eq(queueItems.id, itemId))
    .run();
  return getQueueItemById(itemId, database) ?? null;
}

/** Removes a song from a guest's own queue, the pool, or on deck (refunded if it was already charged).
 * Recorded as "skipped" rather than deleted, the same convention Shared mode's removeQueuedItem uses —
 * it never got played, but it did exist. */
export function removeRotationItem(
  itemId: string,
  guestId: string,
  tokenCap: number,
  database: DB = db,
): { item: QueueItem; balanceAfterRefund: number | null } | null {
  const item = getQueueItemById(itemId, database);
  if (!item || item.addedBy !== guestId || !["mine", "pool", "on_deck"].includes(item.status)) return null;
  // refundQueueItem's return is the guest's new balance (null when there was nothing to refund),
  // not the refunded amount — named to match so a caller isn't tempted to read it as a delta.
  const balanceAfterRefund = refundQueueItem(item, "refund_reject", tokenCap, database);
  markQueueItemSkipped(itemId, false, database);
  return { item, balanceAfterRefund };
}

/** Sets a guest's own queue order. `itemIds` must be exactly their queued songs (no more, no fewer), or
 * nothing changes and it returns false. Used by the guest themselves and by the host's Queues board. */
export function reorderMineQueue(roomId: string, guestId: string, itemIds: unknown, database: DB = db): boolean {
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === "string")) return false;
  const mine = getMineQueue(roomId, guestId, database);
  const currentIds = new Set(mine.map((m) => m.id));
  if (itemIds.length !== mine.length || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => currentIds.has(id))) return false;
  itemIds.forEach((id, index) => {
    database
      .update(queueItems)
      .set({ minePosition: index })
      .where(and(eq(queueItems.id, id), eq(queueItems.addedBy, guestId), eq(queueItems.status, "mine")))
      .run();
  });
  return true;
}

// ---- Host Queues board (R7, §9) ----

export interface HostDraftResult {
  item: QueueItem;
  chargedTokens: number;
  onHouse: boolean;
  /** The automatically-drafted song this one displaced, if on deck was already full — refunded and
   * back at the top of its own owner's queue, keeping their turn (§9). */
  displaced: QueueItem | null;
}

function resetTurnCredit(roomId: string, guestId: string, roster: RotationState[], now: Date, database: DB): void {
  const g = roster.find((r) => r.guestId === guestId);
  if (!g) return;
  // One turn of this round; with none left it's borrowed from the next (credit goes below 0).
  setRotationCredit(roomId, guestId, g.credit - 1, now, database);
}

/**
 * A host (or co-host) drafts a specific song from a guest's own queue straight onto on deck, any time —
 * not just when it's that guest's turn. Into the next free slot if there is one; otherwise it bumps the
 * least-imminent plain on_deck song (never one that's already locked/playing — that can't be touched)
 * back to the top of ITS owner's queue, refunded, keeping their turn. Counts as the drafted guest's own
 * turn either way. A broke guest is always on the house, regardless of `onHouse`.
 */
export function hostDraftItem(roomId: string, itemId: string, onHouse: boolean, database: DB = db): HostDraftResult | null {
  const item = getQueueItemById(itemId, database);
  if (!item || item.roomId !== roomId || item.status !== "mine" || !item.addedBy) return null;

  const settings = getRoomSettings(roomId, database);
  const roster = getRotationRoster(roomId, database);
  const targetSize = onDeckSize(roster.filter((r) => r.active).length);
  const onDeckItems = getOnDeckItems(roomId, database);
  const now = new Date();

  let position: number;
  let displaced: QueueItem | null = null;

  if (onDeckItems.length < targetSize) {
    position = onDeckItems.length ? Math.max(...onDeckItems.map((o) => o.position)) + 1 : 1;
  } else {
    const bumpable = onDeckItems.filter((o) => o.status === "on_deck").sort((a, b) => b.position - a.position);
    const toBump = bumpable[0];
    if (!toBump) return null; // every slot is locked or playing — nothing left that can safely move
    position = toBump.position;
    refundQueueItem(toBump, "refund_reject", settings.tokenCap, database);
    if (toBump.addedBy) {
      // Their credit already dropped once when this song was originally drafted — that stands as
      // their turn "used" (§9 "they keep their turn" means no further penalty, not a refund of it).
      const theirMine = getMineQueue(roomId, toBump.addedBy, database);
      for (const m of theirMine) {
        database.update(queueItems).set({ minePosition: (m.minePosition ?? 0) + 1 }).where(eq(queueItems.id, m.id)).run();
      }
    }
    database
      .update(queueItems)
      .set({ status: "mine", minePosition: 0, draftedAt: null, draftedBy: null })
      .where(eq(queueItems.id, toBump.id))
      .run();
    displaced = { ...toBump, status: "mine", minePosition: 0, draftedAt: null, draftedBy: null };
  }

  const price = priceFor(item.playsTonight, settings.replaySurcharge) + (item.dedication ? 1 : 0);
  const guestBalance = balance(item.addedBy, database);
  const wentOnHouse = !settings.tokenMode || onHouse || guestBalance < price;
  const chargedTokens = settings.tokenMode ? (wentOnHouse ? Math.min(price, guestBalance) : price) : 0;
  if (chargedTokens > 0) {
    apply({ roomId, guestId: item.addedBy, delta: -chargedTokens, reason: "queue_add", refId: itemId, cap: settings.tokenCap }, database);
  }

  database
    .update(queueItems)
    .set({ status: "on_deck", draftedAt: now, draftedBy: "host", minePosition: null, position, paid: chargedTokens })
    .where(eq(queueItems.id, itemId))
    .run();

  resetTurnCredit(roomId, item.addedBy, roster, now, database);

  return { item: getQueueItemById(itemId, database)!, chargedTokens, onHouse: wentOnHouse, displaced };
}

/** A guest's turn is skipped by hand — same credit reset as an actual draft, minus the draft. */
export function skipGuestTurn(roomId: string, guestId: string, database: DB = db): boolean {
  const roster = getRotationRoster(roomId, database);
  if (!roster.some((r) => r.guestId === guestId)) return false;
  resetTurnCredit(roomId, guestId, roster, new Date(), database);
  return true;
}

/** Drafts a random eligible guest's top song, same as any other host draft. Null if nobody's eligible. */
export function draftRandomGuest(roomId: string, onHouse: boolean, database: DB = db): HostDraftResult | null {
  const roster = getRotationRoster(roomId, database).filter((r) => r.active);
  const eligible = roster
    .map((r) => ({ guestId: r.guestId, top: getMineQueue(roomId, r.guestId, database)[0] }))
    .filter((r): r is { guestId: string; top: QueueItem } => !!r.top);
  if (eligible.length === 0) return null;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return hostDraftItem(roomId, pick.top.id, onHouse, database);
}
