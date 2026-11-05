import { and, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "./client.js";
import { bannedTracks, hearts, queueItems, reactionsAgg, tokenEvents, votes } from "./schema.js";
import { artistKey, primaryArtist } from "./genres.js";

export type TasteOutcome = "played" | "skipped" | "banned" | "queued";

export interface TasteSong {
  title: string;
  artist: string;
  /** Genre tags for the artist (may be empty when none are known). */
  genres: string[];
  outcome: TasteOutcome;
  /** Reactions the room sent while it played, by emoji. */
  reactions: Record<string, number>;
  hearts: number;
}

export interface TasteProfile {
  guestId: string;
  songs: TasteSong[];
  totals: {
    songsAdded: number;
    /** Share of their finished songs that were skipped or banned, 0..1. */
    skipRate: number;
    topGenre: string | null;
    contestsWon: number;
    timesGuessedRight: number;
  };
}

/** Songs that count towards a guest's taste: ones in the room's story, never a still-hidden mystery pick
 * (a nickname built from one could point at who queued it). */
const COUNTED_STATUSES = ["played", "skipped", "playing", "locked", "queued"] as const;

/** Every artist name that would appear in the profiles, as tagging keys → the name to ask about. */
export function artistsForTasting(roomId: string, database: DB = defaultDb): Map<string, string> {
  const rows = database
    .select({ artist: queueItems.artistName })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        sql`${queueItems.addedBy} is not null`,
        inArray(queueItems.status, [...COUNTED_STATUSES]),
        sql`not (${queueItems.anonymous} = 1 and ${queueItems.revealed} = 0)`,
        sql`not (${queueItems.status} = 'skipped' and ${queueItems.startedAt} is null)`, // removed/rejected before it started: never played
      ),
    )
    .all();
  const out = new Map<string, string>();
  for (const r of rows) {
    const name = primaryArtist(r.artist);
    out.set(artistKey(name), name);
  }
  return out;
}

/**
 * One profile per guest with at least `minSongs` songs. The genre lookup is passed in (already cached), so
 * this stays a plain read of the room's own data.
 */
export function buildTasteProfiles(
  roomId: string,
  genresByArtistKey: Map<string, string[]>,
  minSongs: number,
  database: DB = defaultDb,
): TasteProfile[] {
  const items = database
    .select()
    .from(queueItems)
    .where(
      and(
        eq(queueItems.roomId, roomId),
        sql`${queueItems.addedBy} is not null`,
        inArray(queueItems.status, [...COUNTED_STATUSES]),
        sql`not (${queueItems.anonymous} = 1 and ${queueItems.revealed} = 0)`,
        sql`not (${queueItems.status} = 'skipped' and ${queueItems.startedAt} is null)`, // removed/rejected before it started: never played
      ),
    )
    .orderBy(queueItems.addedAt)
    .all();
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id);
  const reactionRows = database.select().from(reactionsAgg).where(inArray(reactionsAgg.queueItemId, ids)).all();
  const heartRows = database
    .select({ itemId: hearts.queueItemId, n: sql<number>`count(*)` })
    .from(hearts)
    .where(inArray(hearts.queueItemId, ids))
    .groupBy(hearts.queueItemId)
    .all();
  const banned = new Set(database.select({ uri: bannedTracks.trackUri }).from(bannedTracks).where(eq(bannedTracks.roomId, roomId)).all().map((b) => b.uri));

  const reactionsByItem = new Map<string, Record<string, number>>();
  for (const r of reactionRows) {
    const m = reactionsByItem.get(r.queueItemId) ?? {};
    m[r.emoji] = r.count;
    reactionsByItem.set(r.queueItemId, m);
  }
  const heartsByItem = new Map(heartRows.map((h) => [h.itemId, h.n]));

  // Contest wins: the closed contest votes whose winning entry belongs to the guest.
  const contestsWon = new Map<string, number>();
  for (const v of database.select().from(votes).where(and(eq(votes.roomId, roomId), eq(votes.type, "contest"), eq(votes.status, "closed"))).all()) {
    const winner = v.result?.winnerOptionId;
    const entries = (v.meta as { entries?: { entryId: string; enteredBy: string }[] } | null)?.entries ?? [];
    const by = entries.find((e) => e.entryId === winner)?.enteredBy;
    if (by) contestsWon.set(by, (contestsWon.get(by) ?? 0) + 1);
  }
  const guessedRight = new Map(
    database
      .select({ guestId: tokenEvents.guestId, n: sql<number>`count(*)` })
      .from(tokenEvents)
      .where(and(eq(tokenEvents.roomId, roomId), eq(tokenEvents.reason, "guess_right")))
      .groupBy(tokenEvents.guestId)
      .all()
      .map((g) => [g.guestId, g.n]),
  );

  const byGuest = new Map<string, TasteSong[]>();
  for (const item of items) {
    // A skip near the end of the song (nearEndSkip) reads as "played" here — skip rate is a stat, and
    // reaching for the next track right at the end isn't the same as cutting the song off.
    const outcome: TasteOutcome = banned.has(item.trackUri)
      ? "banned"
      : item.status === "skipped"
        ? item.nearEndSkip
          ? "played"
          : "skipped"
        : item.status === "played"
          ? "played"
          : "queued";
    const songs = byGuest.get(item.addedBy!) ?? [];
    songs.push({
      title: item.trackName,
      artist: item.artistName,
      genres: (genresByArtistKey.get(artistKey(primaryArtist(item.artistName))) ?? []).slice(0, 3),
      outcome,
      reactions: reactionsByItem.get(item.id) ?? {},
      hearts: heartsByItem.get(item.id) ?? 0,
    });
    byGuest.set(item.addedBy!, songs);
  }

  const profiles: TasteProfile[] = [];
  for (const [guestId, songs] of byGuest) {
    if (songs.length < minSongs) continue;
    const finished = songs.filter((s) => s.outcome !== "queued");
    const skipped = finished.filter((s) => s.outcome === "skipped" || s.outcome === "banned").length;
    const genreCounts = new Map<string, number>();
    for (const s of songs) for (const g of s.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    const top = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    profiles.push({
      guestId,
      songs,
      totals: {
        songsAdded: songs.length,
        skipRate: finished.length > 0 ? Math.round((skipped / finished.length) * 100) / 100 : 0,
        topGenre: top?.[0] ?? null,
        contestsWon: contestsWon.get(guestId) ?? 0,
        timesGuessedRight: guessedRight.get(guestId) ?? 0,
      },
    });
  }
  return profiles;
}
