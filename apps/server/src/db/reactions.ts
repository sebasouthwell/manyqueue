import { and, eq, sql } from "drizzle-orm";
import type { ReactionEmoji } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { reactionByGuest, reactionsAgg } from "./schema.js";

/** Counts one reaction against the song that was playing. */
export function recordReaction(queueItemId: string, guestId: string, emoji: ReactionEmoji, database: DB = defaultDb): void {
  database
    .insert(reactionsAgg)
    .values({ queueItemId, emoji, count: 1 })
    .onConflictDoUpdate({
      target: [reactionsAgg.queueItemId, reactionsAgg.emoji],
      set: { count: sql`${reactionsAgg.count} + 1` },
    })
    .run();
  database
    .insert(reactionByGuest)
    .values({ queueItemId, guestId, count: 1 })
    .onConflictDoUpdate({
      target: [reactionByGuest.queueItemId, reactionByGuest.guestId],
      set: { count: sql`${reactionByGuest.count} + 1` },
    })
    .run();
}

export function getReactionCounts(queueItemId: string, database: DB = defaultDb): Record<string, number> {
  const rows = database.select().from(reactionsAgg).where(eq(reactionsAgg.queueItemId, queueItemId)).all();
  return Object.fromEntries(rows.map((r) => [r.emoji, r.count]));
}

export function getGuestReactionCount(queueItemId: string, guestId: string, database: DB = defaultDb): number {
  return (
    database
      .select()
      .from(reactionByGuest)
      .where(and(eq(reactionByGuest.queueItemId, queueItemId), eq(reactionByGuest.guestId, guestId)))
      .get()?.count ?? 0
  );
}
