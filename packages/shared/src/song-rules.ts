import type { RoomSettings } from "./room-settings.js";

export type SongRuleViolation = "too_long" | "explicit";

/** Which of the room's song rules (max length, explicit filter) a track breaks, if any. */
export function songRuleViolation(
  track: { durationMs: number; explicit: boolean },
  settings: Pick<RoomSettings, "maxSongMin" | "explicit">,
): SongRuleViolation | null {
  if (settings.maxSongMin !== null && track.durationMs > settings.maxSongMin * 60_000) {
    return "too_long";
  }
  if (!settings.explicit && track.explicit) return "explicit";
  return null;
}

/** ms left until this guest may add again, given when they last did (0 = now). */
export function cooldownRemainingMs(
  lastAddedAtMs: number | null,
  cooldownSec: number,
  nowMs: number,
): number {
  if (lastAddedAtMs === null || cooldownSec <= 0) return 0;
  return Math.max(0, lastAddedAtMs + cooldownSec * 1000 - nowMs);
}
