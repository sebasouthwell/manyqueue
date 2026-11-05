export const DEDICATION_MAX_LENGTH = 60;
/** Tokens a dedication adds to the price (only when the room uses tokens). */
export const DEDICATION_COST = 1;
/** How long the dedication line stays on the TV once its song starts. */
export const DEDICATION_TV_MS = 20_000;
/** The big animated splash when a dedicated song first starts; the small line takes over after. */
export const DEDICATION_SPLASH_MS = 7_000;
export type DedicationCheck =
  | { ok: true; text: string }
  | { ok: false; error: "empty" | "too_long" };

// A small list on purpose: this catches the obvious, it isn't a moderation
// system. It guards the PUBLIC names the app shows (party name, AI nicknames), not dedications:
// those are the guest's own words, and the host can hide any that shouldn't go on the TV.
const BLOCKED = [
  "fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "asshole", "bastard", "slut", "whore",
  "nigger", "nigga", "faggot", "fag", "retard", "rape", "rapist", "nazi", "wanker", "twat", "piss",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[01345 7@$!]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, "$1$1"); // "fuuuuck" -> "fuuck"
}

function squash(text: string): string {
  return normalise(text).replace(/[^a-z]/g, "").replace(/(.)\1+/g, "$1");
}

/** True if a word from the list appears as a word (so "class" and
 * "Scunthorpe" pass), or is spelled out with spaces/punctuation between
 * letters ("f u c k", "f.u.c.k"), or with repeated letters ("fuuuck"). */
export function containsBlockedWord(text: string): boolean {
  const words = normalise(text).split(/[^a-z]+/).filter(Boolean);
  const blocked = BLOCKED.map((w) => w.replace(/(.)\1+/g, "$1"));
  if (words.some((w) => blocked.includes(w.replace(/(.)\1+/g, "$1")))) return true;

  // Spelled out across separators: only single-letter runs ("f u c k").
  const singles = normalise(text).split(/[^a-z]+/).filter(Boolean);
  let run = "";
  for (const w of singles) {
    if (w.length === 1) run += w;
    else {
      if (run.length >= 3 && blocked.includes(run.replace(/(.)\1+/g, "$1"))) return true;
      run = "";
    }
  }
  if (run.length >= 3 && blocked.includes(run.replace(/(.)\1+/g, "$1"))) return true;
  return blocked.includes(squash(text)) && squash(text).length <= 8;
}

export function checkDedication(raw: unknown): DedicationCheck {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "empty" };
  if (Array.from(text).length > DEDICATION_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, text };
}
