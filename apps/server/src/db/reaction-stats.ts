import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "./client.js";
import { guests, queueItems, reactionByGuest, reactionsAgg } from "./schema.js";

export interface SongReactionSummary {
  reactions: { emoji: string; count: number }[];
  topReactor: { nickname: string; emoji: string; count: number } | null;
}

/** Per song: reaction counts (most first) and who reacted the most. */
export function reactionSummaries(itemIds: string[], database: DB = defaultDb): Map<string, SongReactionSummary> {
  const out = new Map<string, SongReactionSummary>();
  if (itemIds.length === 0) return out;

  const rows = database.select().from(reactionsAgg).where(inArray(reactionsAgg.queueItemId, itemIds)).all();
  for (const r of rows) {
    const entry = out.get(r.queueItemId) ?? { reactions: [], topReactor: null };
    entry.reactions.push({ emoji: r.emoji, count: r.count });
    out.set(r.queueItemId, entry);
  }
  for (const entry of out.values()) entry.reactions.sort((a, b) => b.count - a.count);

  const byGuest = database
    .select({ itemId: reactionByGuest.queueItemId, guestId: reactionByGuest.guestId, count: reactionByGuest.count })
    .from(reactionByGuest)
    .where(inArray(reactionByGuest.queueItemId, itemIds))
    .orderBy(desc(reactionByGuest.count))
    .all();
  const guestRows = new Map(
    byGuest.length
      ? database.select().from(guests).where(inArray(guests.id, [...new Set(byGuest.map((b) => b.guestId))])).all().map((g) => [g.id, g])
      : [],
  );
  for (const b of byGuest) {
    const entry = out.get(b.itemId);
    if (!entry || entry.topReactor) continue;
    const g = guestRows.get(b.guestId);
    if (g) entry.topReactor = { nickname: g.nickname, emoji: g.emoji, count: b.count };
  }
  return out;
}

/** Every reaction on songs this guest added, and the emoji they got most: "🔥 42 reactions got". */
export function reactionsReceivedBy(roomId: string, guestId: string, database: DB = defaultDb): { total: number; topEmoji: string | null } {
  const rows = database
    .select({ emoji: reactionsAgg.emoji, count: sql<number>`sum(${reactionsAgg.count})` })
    .from(reactionsAgg)
    .innerJoin(queueItems, eq(queueItems.id, reactionsAgg.queueItemId))
    .where(and(eq(queueItems.roomId, roomId), eq(queueItems.addedBy, guestId)))
    .groupBy(reactionsAgg.emoji)
    .all();
  let total = 0;
  let top: { emoji: string; count: number } | null = null;
  for (const r of rows) {
    total += r.count;
    if (!top || r.count > top.count) top = { emoji: r.emoji, count: r.count };
  }
  return { total, topEmoji: top?.emoji ?? null };
}

/**
 * The guest with the most songs added tonight, once at least two. Mystery picks
 * are left out on purpose, so this can't hint at who queued an unrevealed one,
 * and so are songs removed before they played and house picks.
 */
export function mostActiveGuest(roomId: string, database: DB = defaultDb): { nickname: string; emoji: string; songs: number } | null {
  const rows = database
    .select({ guestId: queueItems.addedBy, songs: sql<number>`count(*)` })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        isNotNull(queueItems.addedBy),
        sql`${queueItems.status} in ('queued','pending','locked','playing','played')`,
        sql`not (${queueItems.anonymous} = 1 and ${queueItems.revealed} = 0)`,
      ),
    )
    .groupBy(queueItems.addedBy)
    .orderBy(desc(sql`count(*)`))
    .all();
  const top = rows.find((r) => r.guestId && r.songs >= 2);
  if (!top?.guestId) return null;
  const g = database.select().from(guests).where(eq(guests.id, top.guestId)).get();
  if (!g || g.kickedAt) return null;
  return { nickname: g.nickname, emoji: g.emoji, songs: top.songs };
}
