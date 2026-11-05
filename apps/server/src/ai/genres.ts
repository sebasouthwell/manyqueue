import {
  AI_GENRE_BATCH_MAX,
  AI_GENRE_SYSTEM_PROMPT,
  AI_MAX_GENRE_CALLS_PER_NIGHT,
  AiGenreReplySchema,
  anonymiseIds,
  cleanGenreTags,
} from "@manyqueue/shared";
import { db as defaultDb, type DB } from "../db/client.js";
import { getCachedGenres, saveGenres } from "../db/genres.js";
import { bumpAiUsage, getAiUsage } from "../db/ai-nicknames.js";
import { aiJsonCall, isAiConfigured } from "./deepseek.js";

/**
 * Genre tags for artists, by artist key. Cached tags are used as they are; artists with none get ONE
 * batched AI call (at most a few per night), and the answers are cached for 30 days. Any failure is quiet:
 * the artists just stay untagged and nicknames are made from titles and artists alone.
 */
export async function ensureGenres(
  roomId: string,
  artists: Map<string, string>,
  database: DB = defaultDb,
): Promise<Map<string, string[]>> {
  const cached = getCachedGenres([...artists.keys()], new Date(), database);
  const missing = [...artists.entries()].filter(([key]) => !cached.has(key)).slice(0, AI_GENRE_BATCH_MAX);
  if (missing.length === 0 || !isAiConfigured()) return cached;
  if (getAiUsage(roomId, database).genreCalls >= AI_MAX_GENRE_CALLS_PER_NIGHT) return cached;

  const { toAnon, fromAnon } = anonymiseIds(missing.map(([key]) => key));
  const list = Object.fromEntries(missing.map(([key, name]) => [toAnon.get(key)!.replace("g", "a"), name]));
  bumpAiUsage(roomId, "genre", database);
  try {
    const result = await aiJsonCall({ system: AI_GENRE_SYSTEM_PROMPT, user: JSON.stringify({ artists: list }), purpose: "genres" });
    const parsed = AiGenreReplySchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) return cached;
    const fresh = new Map<string, string[]>();
    for (const [anon, tags] of Object.entries(parsed.data)) {
      const key = fromAnon.get(anon.replace("a", "g"));
      const clean = cleanGenreTags(tags);
      if (key && clean.length > 0) fresh.set(key, clean);
    }
    saveGenres(fresh, new Date(), database);
    for (const [k, v] of fresh) cached.set(k, v);
  } catch {
    // quiet by design; the failure is already logged by the client
  }
  return cached;
}
