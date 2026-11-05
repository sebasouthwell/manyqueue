import { and, eq, inArray, sql } from "drizzle-orm";
import { EMPTY_LABEL_STATS, type LabelStats, type LabelView } from "@manyqueue/shared";
import { db as defaultDb, type DB } from "./client.js";
import { guestLabels, hearts, queueItems, reactionsAgg, tokenEvents, votes } from "./schema.js";
import { artistKey, primaryArtist } from "./genres.js";

const COUNTED = ["played", "skipped", "playing", "locked", "queued"] as const;

/**
 * The numbers the label rules run on, per guest. A still-hidden mystery pick never counts anywhere (songs,
 * reactions, contest wins), so an earned label can't point at who queued it.
 */
export function buildLabelStats(
  roomId: string,
  genresByArtistKey: Map<string, string[]>,
  database: DB = defaultDb,
): Map<string, LabelStats> {
  const items = database
    .select()
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        sql`${queueItems.addedBy} is not null`,
        inArray(queueItems.status, [...COUNTED]),
        sql`not (${queueItems.anonymous} = 1 and ${queueItems.revealed} = 0)`,
        sql`not (${queueItems.status} = 'skipped' and ${queueItems.startedAt} is null)`, // removed/rejected before it started: never played
      ),
    )
    .orderBy(queueItems.addedAt, queueItems.position)
    .all();
  const out = new Map<string, LabelStats>();
  if (items.length === 0) return out;

  const stat = (guestId: string): LabelStats => {
    let s = out.get(guestId);
    if (!s) {
      s = { ...EMPTY_LABEL_STATS, genreSongs: {} };
      out.set(guestId, s);
    }
    return s;
  };

  const ids = items.map((i) => i.id);
  const reactionsByItem = new Map<string, { total: number; fire: number }>();
  for (const r of database.select().from(reactionsAgg).where(inArray(reactionsAgg.queueItemId, ids)).all()) {
    const e = reactionsByItem.get(r.queueItemId) ?? { total: 0, fire: 0 };
    e.total += r.count;
    if (r.emoji === "🔥") e.fire += r.count;
    reactionsByItem.set(r.queueItemId, e);
  }
  const heartsByItem = new Map(
    database
      .select({ itemId: hearts.queueItemId, n: sql<number>`count(*)` })
      .from(hearts)
      .where(inArray(hearts.queueItemId, ids))
      .groupBy(hearts.queueItemId)
      .all()
      .map((h) => [h.itemId, h.n]),
  );

  for (const item of items) {
    const s = stat(item.addedBy!);
    s.songsAdded++;
    if (item.status === "played" || item.status === "skipped") s.finished++;
    // A skip near the end of the song (nearEndSkip) is still recorded as a skip, but doesn't count
    // against the guest here — reaching for the next track right at the end isn't the same as a cutoff.
    if (item.status === "skipped" && !item.nearEndSkip) s.skipped++;
    const r = reactionsByItem.get(item.id);
    if (r) {
      s.reactionsReceived += r.total;
      s.fireReactions += r.fire;
      s.bestSongReactions = Math.max(s.bestSongReactions, r.total);
    }
    s.heartsReceived += heartsByItem.get(item.id) ?? 0;
    for (const tag of new Set(genresByArtistKey.get(artistKey(primaryArtist(item.artistName))) ?? [])) {
      s.genreSongs[tag] = (s.genreSongs[tag] ?? 0) + 1;
    }
  }

  // Contest wins, counting only entries whose song isn't a hidden mystery pick.
  const visibleItemIds = new Set(ids);
  for (const v of database.select().from(votes).where(and(eq(votes.roomId, roomId), eq(votes.type, "contest"), eq(votes.status, "closed"))).all()) {
    const winner = v.result?.winnerOptionId;
    const entries = (v.meta as { entries?: { entryId: string; queueItemId: string; enteredBy: string }[] } | null)?.entries ?? [];
    const entry = entries.find((e) => e.entryId === winner);
    if (entry && visibleItemIds.has(entry.queueItemId)) stat(entry.enteredBy).contestsWon++;
  }
  for (const g of database
    .select({ guestId: tokenEvents.guestId, n: sql<number>`count(*)` })
    .from(tokenEvents)
    .where(and(eq(tokenEvents.roomId, roomId), eq(tokenEvents.reason, "guess_right")))
    .groupBy(tokenEvents.guestId)
    .all()) {
    stat(g.guestId).timesGuessedRight = g.n;
  }
  return out;
}

export interface EarnedLabelRow {
  guestId: string;
  key: string;
  name: string;
  emoji: string;
  earnedAt: Date;
}

export function listEarnedLabels(roomId: string, database: DB = defaultDb): EarnedLabelRow[] {
  return database
    .select()
    .from(guestLabels)
    .where(eq(guestLabels.roomId, roomId))
    .orderBy(guestLabels.earnedAt)
    .all()
    .map((r) => ({ guestId: r.guestId, key: r.labelKey, name: r.name, emoji: r.emoji, earnedAt: r.earnedAt }));
}

/** Records a label as earned; false if the guest already had it (so nobody is told twice). */
export function saveEarnedLabel(roomId: string, guestId: string, label: LabelView, now: Date = new Date(), database: DB = defaultDb): boolean {
  const res = database
    .insert(guestLabels)
    .values({ roomId, guestId, labelKey: label.key, name: label.name, emoji: label.emoji, earnedAt: now })
    .onConflictDoNothing()
    .run();
  return res.changes > 0;
}
