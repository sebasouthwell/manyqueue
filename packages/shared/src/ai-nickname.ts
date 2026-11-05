import { z } from "zod";
import { containsBlockedWord } from "./dedication.js";

/** Guests with fewer songs than this are left out of nickname batches. */
export const AI_MIN_SONGS = 3;
/** A batch runs after every this many finished songs, and once when the night ends. */
export const AI_BATCH_EVERY_SONGS = 8;
/** A guest's nickname changes at most once per this many finished songs. */
export const AI_MIN_SONGS_BETWEEN_CHANGES = 16;
/** Cost guard: at most this many calls per room per night. */
export const AI_MAX_CALLS_PER_NIGHT = 10;
export const AI_MAX_TOKENS = 800;
export const AI_TIMEOUT_MS = 15_000;
/** In "host approves" mode a pending nickname shows itself after this long with no action. */
export const AI_AUTO_SHOW_MS = 60_000;
export const AI_NICKNAME_MAX_CHARS = 32;
export const AI_WHY_MAX_CHARS = 120;

export type AiNicknameMode = "off" | "approve" | "auto";

export const AI_SYSTEM_PROMPT = [
  "You give guests at a house party a funny nickname based only on the music they queued and how the room reacted to it.",
  "Be playful and affectionate, like a friend roasting you at a party.",
  "Never mention looks, body, identity, drinking, or anything sexual. Nothing mean or embarrassing.",
  "Each nickname is 2 to 4 words plus exactly one emoji, and at most 32 characters.",
  "Base it only on the data given. Do not invent things they didn't do.",
  "Write the one-sentence reason in the third person (they/their), never addressing the guest as you, because it is shown to the whole room.",
  'Reply with JSON only: an object with exactly one entry per guest id in the input, keyed by that exact id, each entry being {"nickname": "...", "why": "..."}.',
].join(" ");

export const AiReplySchema = z.record(z.string(), z.object({ nickname: z.string(), why: z.string() }));
export type AiReply = z.infer<typeof AiReplySchema>;

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

export function countEmoji(text: string): number {
  return (text.match(EMOJI) ?? []).length;
}

export type AiNicknameCheck = { ok: true; nickname: string; why: string } | { ok: false; reason: string };

/**
 * The server's checks on what the model sent back. Anything that fails is
 * dropped and the guest keeps their previous nickname. `realNames` are the
 * room's actual nicknames, which must not appear (they were never sent, so a
 * match means the model made one up that reads like a real person).
 */
export function validateAiNickname(nickname: unknown, why: unknown, realNames: readonly string[] = []): AiNicknameCheck {
  if (typeof nickname !== "string" || typeof why !== "string") return { ok: false, reason: "not_strings" };
  const n = nickname.replace(/\s+/g, " ").trim();
  const w = why.replace(/\s+/g, " ").trim();
  if (!n) return { ok: false, reason: "empty" };
  if (Array.from(n).length > AI_NICKNAME_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (countEmoji(n) !== 1) return { ok: false, reason: "emoji_count" };
  const words = n.replace(EMOJI, " ").split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 4) return { ok: false, reason: "word_count" };
  if (Array.from(w).length > AI_WHY_MAX_CHARS) return { ok: false, reason: "why_too_long" };
  if (containsBlockedWord(n) || containsBlockedWord(w)) return { ok: false, reason: "profanity" };
  const lower = `${n} ${w}`.toLowerCase();
  if (realNames.some((r) => r.trim().length >= 3 && lower.includes(r.trim().toLowerCase()))) return { ok: false, reason: "real_name" };
  return { ok: true, nickname: n, why: w };
}

/** A batch runs every 8 finished songs, while the night's call budget lasts. */
export function shouldRunBatch(finished: number, callsUsed: number): boolean {
  return finished > 0 && finished % AI_BATCH_EVERY_SONGS === 0 && callsUsed < AI_MAX_CALLS_PER_NIGHT;
}

/** A new nickname replaces the old one only if it's different and 16 songs have passed. */
export function shouldChangeNickname(
  current: { nickname: string; atFinished: number } | null,
  next: string,
  finishedNow: number,
): boolean {
  if (!current) return true;
  if (current.nickname.trim().toLowerCase() === next.trim().toLowerCase()) return false;
  return finishedNow - current.atFinished >= AI_MIN_SONGS_BETWEEN_CHANGES;
}

// ---- Genre tags (the AI fills them in: Spotify no longer returns artist genres) ----

/** Cost guard for tagging (about 200 tokens a call, and answers are cached for 30 days): its own budget, apart from the 10 nickname calls. */
export const AI_MAX_GENRE_CALLS_PER_NIGHT = 20;
/** Artists asked about in one tagging call. */
export const AI_GENRE_BATCH_MAX = 60;
export const AI_GENRE_MAX_TAGS = 3;

export const AI_GENRE_SYSTEM_PROMPT = [
  "You tag music artists with genres.",
  "For each artist id give up to 3 short lowercase genre tags, most fitting first (like: pop, dance pop, hip hop, reggaeton, salsa, edm, drum and bass, indie rock, r&b, country).",
  "Use only tags you are confident about. If you don't know the artist, give an empty list.",
  'Reply with JSON only, in this shape: {"a1": ["pop", "dance pop"], "a2": []} using the same artist ids you were given.',
].join(" ");

export const AiGenreReplySchema = z.record(z.string(), z.array(z.string()));

/** Lowercase, tidy, at most 3 tags of at most 24 characters; anything odd is dropped. */
export function cleanGenreTags(tags: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (!tag || tag.length > 24 || !/^[a-z0-9][a-z0-9 &'/+-]*$/.test(tag)) continue;
    if (containsBlockedWord(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === AI_GENRE_MAX_TAGS) break;
  }
  return out;
}

/** Guests get short ids (g1, g2...) in AI input, never their names. Stable for the order given. */
export function anonymiseIds(guestIds: readonly string[]): { toAnon: Map<string, string>; fromAnon: Map<string, string> } {
  const toAnon = new Map<string, string>();
  const fromAnon = new Map<string, string>();
  guestIds.forEach((id, i) => {
    toAnon.set(id, `g${i + 1}`);
    fromAnon.set(`g${i + 1}`, id);
  });
  return { toAnon, fromAnon };
}
