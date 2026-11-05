/**
 * Announcements: a fun little feature — any guest can blast a short message to the whole room (TV +
 * every phone), by default. The host (or anyone holding Moderation) can take the ability away from a
 * specific guest without muting them entirely. Not censored — same call as dedications: it's the
 * guest's own words, and staff can take the ability away from anyone who abuses it.
 */
export const ANNOUNCEMENT_MAX_LENGTH = 80;
/** One announcement per guest per this long, so it can't be spammed. */
export const ANNOUNCEMENT_COOLDOWN_MS = 60_000;

export type AnnouncementCheck = { ok: true; text: string } | { ok: false; error: "empty" | "too_long" };

export function checkAnnouncement(raw: unknown): AnnouncementCheck {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "empty" };
  if (Array.from(text).length > ANNOUNCEMENT_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, text };
}

export function announcementCooldownLeft(lastAt: number | undefined, now: number): number {
  if (lastAt === undefined) return 0;
  return Math.max(0, lastAt + ANNOUNCEMENT_COOLDOWN_MS - now);
}
