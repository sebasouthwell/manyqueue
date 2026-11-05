import { inArray } from "drizzle-orm";
import { db as defaultDb, type DB } from "./client.js";
import { genreCache } from "./schema.js";

/** Cached tags stay good for this long. */
export const GENRE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** "Dua Lipa" and "dua  lipa" are the same artist. */
export function artistKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The first credited artist: "A, B" and "A feat. B" are tagged as A. */
export function primaryArtist(artistName: string): string {
  return artistName.split(/,|\bfeat\.?\b|\bft\.?\b|\bwith\b|&/i)[0]?.trim() || artistName.trim();
}

/** Fresh cached tags by artist key; keys with no (or stale) entry are simply absent. */
export function getCachedGenres(keys: string[], now: Date = new Date(), database: DB = defaultDb): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (keys.length === 0) return out;
  const rows = database.select().from(genreCache).where(inArray(genreCache.artistKey, keys)).all();
  for (const r of rows) {
    if (now.getTime() - r.fetchedAt.getTime() <= GENRE_TTL_MS) out.set(r.artistKey, r.genres);
  }
  return out;
}

export function saveGenres(entries: Map<string, string[]>, now: Date = new Date(), database: DB = defaultDb): void {
  for (const [key, genres] of entries) {
    database
      .insert(genreCache)
      .values({ artistKey: key, genres, fetchedAt: now })
      .onConflictDoUpdate({ target: genreCache.artistKey, set: { genres, fetchedAt: now } })
      .run();
  }
}
