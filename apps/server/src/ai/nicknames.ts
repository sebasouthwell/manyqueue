import {
  AI_MAX_CALLS_PER_NIGHT,
  AI_MAX_TOKENS,
  AI_MIN_SONGS,
  AI_SYSTEM_PROMPT,
  AiReplySchema,
  anonymiseIds,
  validateAiNickname,
} from "@manyqueue/shared";
import { eq } from "drizzle-orm";
import { db as defaultDb, type DB } from "../db/client.js";
import { guests } from "../db/schema.js";
import { bumpAiUsage, getAiUsage } from "../db/ai-nicknames.js";
import { artistsForTasting, buildTasteProfiles } from "../db/taste.js";
import { aiJsonCall, isAiConfigured } from "./deepseek.js";
import { ensureGenres } from "./genres.js";

export interface NicknameProposal {
  guestId: string;
  nickname: string;
  why: string;
}

export type NicknameBatchResult =
  | { ok: true; proposals: NicknameProposal[]; rejected: number }
  | { ok: false; reason: "not_configured" | "budget" | "no_guests" | "ai_failed" | "bad_reply" };

/**
 * ONE AI call for the whole room (or for one guest when `onlyGuestId` is set, for a re-roll). What goes out
 * is anonymised: short ids (g1, g2...) and music data. Real names, the room name and dedications never do.
 * Replies are checked (shape, length, exactly one emoji, no blocked words, no real names); anything
 * failing is dropped, so the guest keeps what they had.
 */
export async function generateNicknames(
  roomId: string,
  opts: { onlyGuestId?: string } = {},
  database: DB = defaultDb,
): Promise<NicknameBatchResult> {
  if (!isAiConfigured()) return { ok: false, reason: "not_configured" };
  if (getAiUsage(roomId, database).nicknameCalls >= AI_MAX_CALLS_PER_NIGHT) return { ok: false, reason: "budget" };

  const genres = await ensureGenres(roomId, artistsForTasting(roomId, database), database);
  let profiles = buildTasteProfiles(roomId, genres, AI_MIN_SONGS, database);
  if (opts.onlyGuestId) profiles = profiles.filter((p) => p.guestId === opts.onlyGuestId);
  if (profiles.length === 0) return { ok: false, reason: "no_guests" };

  const { toAnon, fromAnon } = anonymiseIds(profiles.map((p) => p.guestId));
  const payload = Object.fromEntries(
    profiles.map((p) => [
      toAnon.get(p.guestId)!,
      {
        songs: p.songs.map((s) => ({ title: s.title, artist: s.artist, genres: s.genres, result: s.outcome, reactions: s.reactions, hearts: s.hearts })),
        skipRate: p.totals.skipRate,
        topGenre: p.totals.topGenre,
        contestsWon: p.totals.contestsWon,
        timesGuessedRight: p.totals.timesGuessedRight,
      },
    ]),
  );

  bumpAiUsage(roomId, "nickname", database);
  let content: string;
  try {
    content = (
      await aiJsonCall({
        system: AI_SYSTEM_PROMPT,
        user: JSON.stringify({ guestIds: Object.keys(payload), guests: payload }),
        purpose: "nicknames",
        maxTokens: AI_MAX_TOKENS,
      })
    ).content;
  } catch {
    return { ok: false, reason: "ai_failed" };
  }

  let parsed;
  try {
    parsed = AiReplySchema.safeParse(JSON.parse(content));
  } catch {
    return { ok: false, reason: "bad_reply" };
  }
  if (!parsed.success) return { ok: false, reason: "bad_reply" };

  const realNames = database.select({ nickname: guests.nickname }).from(guests).where(eq(guests.roomId, roomId)).all().map((g) => g.nickname);
  const proposals: NicknameProposal[] = [];
  let rejected = 0;
  let entries = Object.entries(parsed.data);
  // With ONE guest there is no way to mix people up, so a wrongly-keyed reply (the model once answered with
  // an id it had seen in an example) still belongs to them. With several, an unknown id is dropped.
  if (fromAnon.size === 1 && entries.length === 1 && !fromAnon.has(entries[0]![0])) {
    entries = [[[...fromAnon.keys()][0]!, entries[0]![1]]];
  }
  for (const [anon, entry] of entries) {
    const guestId = fromAnon.get(anon);
    if (!guestId) {
      rejected++; // an id we never sent: counted, never guessed at
      continue;
    }
    const check = validateAiNickname(entry.nickname, entry.why, realNames);
    if (check.ok) proposals.push({ guestId, nickname: check.nickname, why: check.why });
    else rejected++;
  }
  return { ok: true, proposals, rejected };
}
