import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { CONTEST_ENTRY_COST, priceFor } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { contestPool, queueItems } from "./schema.js";
import { applyInTransaction, balance } from "./tokens.js";
import { getRoomSettings } from "./settings.js";
import { getOnDeckItems, getQueueItemById, type QueueItem } from "./queue.js";
import { getPoolEntry, getPoolEntryForGuest, type PoolEntry } from "./contest.js";

/**
 * Fight for a spot (the Rotation-mode design §11, D10): Rotation mode's version of the song contest. A guest
 * puts a song from their own queue up for a fight (1 🪙 with tokens on, refunded if it wins). Two songs
 * from different guests fight on the shared contest engine and TV takeover; the winner goes straight on
 * deck **without using its owner's turn**, the loser goes back to its place in its owner's queue.
 *
 * The song itself stays the same queue row: status "in_fight" while it waits or fights (out of the
 * rotation, so it can't be drafted from under the vote), `paid` holding the entry fee, its minePosition
 * kept so it returns where it was.
 */

export type FightBlocker = "off" | "not_found" | "already_fighting" | "on_deck" | "cant_afford";

export const FIGHT_BLOCKER_TEXT: Record<FightBlocker, string> = {
  off: "Fights are off right now.",
  not_found: "That song isn't in your queue any more.",
  already_fighting: "You already have a song in a fight.",
  on_deck: "You have a song on deck: fight once it's played.",
  cant_afford: "Entering a fight costs 1 🪙.",
};

export function fightsOpen(roomId: string, database: DB = defaultDb): boolean {
  const s = getRoomSettings(roomId, database);
  return s.mode === "rotation" && s.nextSongMethod === "rotation" && s.fights;
}

export function enterFight(
  roomId: string,
  guestId: string,
  itemId: string,
  database: DB = defaultDb,
): { ok: true; entry: PoolEntry; item: QueueItem; balance: number | null } | { ok: false; error: FightBlocker } {
  const settings = getRoomSettings(roomId, database);
  if (!fightsOpen(roomId, database)) return { ok: false, error: "off" };
  const item = getQueueItemById(itemId, database);
  if (!item || item.roomId !== roomId || item.addedBy !== guestId || item.status !== "mine") return { ok: false, error: "not_found" };
  if (getPoolEntryForGuest(roomId, guestId, database)) return { ok: false, error: "already_fighting" };
  if (getOnDeckItems(roomId, database).some((o) => o.addedBy === guestId && o.status !== "playing")) return { ok: false, error: "on_deck" };
  const cost = settings.tokenMode ? CONTEST_ENTRY_COST : 0;
  if (cost > 0 && balance(guestId, database) < cost) return { ok: false, error: "cant_afford" };

  return database.transaction((tx) => {
    const t = tx as unknown as DB;
    let bal: number | null = null;
    if (cost > 0) {
      bal = applyInTransaction(tx, { roomId, guestId, delta: -cost, reason: "contest_entry", refId: itemId, cap: settings.tokenCap }).balance;
    }
    tx.update(queueItems).set({ status: "in_fight", paid: cost }).where(eq(queueItems.id, itemId)).run();
    const entry: PoolEntry = { id: crypto.randomUUID(), roomId, queueItemId: itemId, enteredBy: guestId, losses: 0, createdAt: new Date() };
    tx.insert(contestPool).values(entry).run();
    return { ok: true as const, entry, item: getQueueItemById(itemId, t)!, balance: bal };
  });
}

/** Out of the fight and back to its place in the owner's queue, entry fee refunded (they left, the host
 * took it out, the fight was cancelled, or fights were turned off). */
export function leaveFight(
  entryId: string,
  reason: "refund_reject" | "refund_expire",
  database: DB = defaultDb,
): { entry: PoolEntry; item: QueueItem; refunded: number; balance: number | null } | null {
  const entry = getPoolEntry(entryId, database);
  if (!entry) return null;
  const item = getQueueItemById(entry.queueItemId, database);
  if (!item || item.status !== "in_fight") return null;
  const { tokenCap } = getRoomSettings(item.roomId, database);
  return database.transaction((tx) => {
    let bal: number | null = null;
    if (item.paid > 0) {
      bal = applyInTransaction(tx, { roomId: item.roomId, guestId: entry.enteredBy, delta: item.paid, reason, refId: item.id, cap: tokenCap }).balance;
    }
    tx.update(queueItems).set({ status: "mine", paid: 0 }).where(eq(queueItems.id, item.id)).run();
    tx.delete(contestPool).where(eq(contestPool.id, entry.id)).run();
    return { entry, item: { ...item, status: "mine" as const, paid: 0 }, refunded: item.paid, balance: bal };
  });
}

export interface FightSettlement {
  winnerItem: QueueItem;
  loserItem: QueueItem;
  winnerOwner: string;
  loserOwner: string;
  /** The winner's balance after the entry refund and the song's price, or null with tokens off. */
  winnerBalance: number | null;
  /** Net token change for the winner: entry back, song charged (0 on the house). */
  winnerDelta: number;
}

/**
 * The fight is over. The winner's entry fee comes back and it goes straight on deck as the next song,
 * charged like any draft (on the house if they can't afford it) but **without** touching their turn
 * (D10). The loser goes back to its place in its owner's queue; its entry fee is spent.
 */
export function settleFight(winnerEntryId: string, loserEntryId: string, database: DB = defaultDb): FightSettlement {
  const winnerEntry = getPoolEntry(winnerEntryId, database);
  const loserEntry = getPoolEntry(loserEntryId, database);
  if (!winnerEntry || !loserEntry) throw new Error("fight entry no longer in the pool");
  const winnerItem = getQueueItemById(winnerEntry.queueItemId, database)!;
  const loserItem = getQueueItemById(loserEntry.queueItemId, database)!;
  const settings = getRoomSettings(winnerItem.roomId, database);

  return database.transaction((tx) => {
    const t = tx as unknown as DB;
    let winnerBalance: number | null = null;
    let winnerDelta = 0;
    // The entry fee comes back whatever the token setting is now: it was paid.
    if (winnerItem.paid > 0) {
      winnerBalance = applyInTransaction(tx, {
        roomId: winnerItem.roomId,
        guestId: winnerEntry.enteredBy,
        delta: winnerItem.paid,
        reason: "refund_contest",
        refId: winnerItem.id,
        cap: settings.tokenCap,
      }).balance;
      winnerDelta += winnerItem.paid;
    }
    let charge = 0;
    if (settings.tokenMode) {
      const price = priceFor(winnerItem.playsTonight, settings.replaySurcharge) + (winnerItem.dedication ? 1 : 0);
      charge = balance(winnerEntry.enteredBy, t) >= price ? price : 0; // broke: on the house
      if (charge > 0) {
        winnerBalance = applyInTransaction(tx, {
          roomId: winnerItem.roomId,
          guestId: winnerEntry.enteredBy,
          delta: -charge,
          reason: "queue_add",
          refId: winnerItem.id,
          cap: settings.tokenCap,
        }).balance;
        winnerDelta -= charge;
      }
    }
    winnerItem.paid = charge;

    const onDeck = getOnDeckItems(winnerItem.roomId, t);
    const position = onDeck.length ? Math.max(...onDeck.map((o) => o.position)) + 1 : 1;
    tx.update(queueItems)
      .set({ status: "on_deck", paid: winnerItem.paid, position, minePosition: null, draftedAt: new Date(), draftedBy: "fight" })
      .where(eq(queueItems.id, winnerItem.id))
      .run();
    tx.update(queueItems).set({ status: "mine", paid: 0 }).where(eq(queueItems.id, loserItem.id)).run();
    tx.delete(contestPool).where(inArray(contestPool.id, [winnerEntry.id, loserEntry.id])).run();

    return {
      winnerItem: getQueueItemById(winnerItem.id, t)!,
      loserItem: getQueueItemById(loserItem.id, t)!,
      winnerOwner: winnerEntry.enteredBy,
      loserOwner: loserEntry.enteredBy,
      winnerBalance,
      winnerDelta,
    };
  });
}

/** Every waiting fight entry in the room back to its owner's queue, refunded (fights turned off, Crowd
 * pick switched on). One mid-vote is left to finish. */
export function clearFights(roomId: string, skipEntryIds: string[] = [], database: DB = defaultDb) {
  const entries = database
    .select()
    .from(contestPool)
    .innerJoin(queueItems, eq(queueItems.id, contestPool.queueItemId))
    .where(and(eq(contestPool.roomId, roomId), eq(queueItems.status, "in_fight")))
    .all()
    .map((r) => r.contest_pool)
    .filter((e) => !skipEntryIds.includes(e.id));
  return entries.map((e) => leaveFight(e.id, "refund_expire", database)).filter((r) => r !== null);
}
