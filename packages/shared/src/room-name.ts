import { containsBlockedWord } from "./dedication.js";

export const PARTY_NAME_MAX_LENGTH = 40;

export type PartyNameCheck = { ok: true; name: string } | { ok: false; error: "empty" | "too_long" | "profanity" };

/** The party name shows on the TV and on every phone's join screen. */
export function cleanPartyName(raw: unknown): PartyNameCheck {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, error: "empty" };
  if (Array.from(name).length > PARTY_NAME_MAX_LENGTH) return { ok: false, error: "too_long" };
  if (containsBlockedWord(name)) return { ok: false, error: "profanity" };
  return { ok: true, name };
}
