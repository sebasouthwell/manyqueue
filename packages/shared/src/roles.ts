import type { Permission } from "./permissions.js";

export type GuestRole = "guest" | "cohost";
export type ActorRole = "host" | "cohost" | "guest";

export interface GuestSummary {
  id: string;
  nickname: string;
  emoji: string;
  role: GuestRole;
  muted: boolean;
  /** Extra permissions the host gave this guest (co-hosts hold every one regardless). */
  perms: Permission[];
  /** Announcements are on for everyone by default; staff can take it away from a specific guest. */
  canAnnounce: boolean;
  /** null when token mode is off — nothing to show. */
  tokenBalance: number | null;
  /** The guest's newest AI nickname (staff only): pending ones still wait for approval. */
  aiNickname?: { id: string; nickname: string; why: string; status: "pending" | "shown" | "hidden" } | null;
  /** Host only: a private note waiting for this guest (null when none). Never sent to co-hosts. */
  hostNote?: string | null;
  /** Only for the host and whoever holds the glitch permission (glitch mode easter egg). */
  glitch?: GlitchState;
}

/** A guest's glitch, as the host set it. `level` 0 = off. */
export interface GlitchState {
  level: number;
  /** Seconds it runs once started; null = until someone stops it. */
  durationSec: number | null;
  /** Waiting for their next visit (then starts 3-7s in). */
  armed: boolean;
  /** Epoch ms it started on their phone; null while armed or off. */
  startedAt: number | null;
}

export type GlitchPayload = GlitchState;

/** Longest private note the host can leave a guest. */
export const HOST_NOTE_MAX = 280;
