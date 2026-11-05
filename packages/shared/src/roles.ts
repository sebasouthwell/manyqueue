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
}
