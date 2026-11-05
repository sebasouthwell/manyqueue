/** A song that loses twice stops returning to the pool and joins the queue. */
export const MAX_CONTEST_LOSSES = 2;
/** Tokens to enter the pool; refunded if the song wins. */
export const CONTEST_ENTRY_COST = 1;
/** How long the winner/loser result stays on the TV. */
export const CONTEST_RESULT_MS = 7_000;

export interface PoolEntryLite {
  id: string;
  enteredBy: string;
  /** Epoch ms. */
  createdAt: number;
  losses: number;
}

/** The two oldest entries from two different guests, older first (so the older
 * one is option one and wins a tie), or null if there aren't two guests. */
export function pickContestPair<T extends PoolEntryLite>(entries: T[]): [T, T] | null {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const first = sorted[0];
  if (!first) return null;
  const second = sorted.find((e) => e.enteredBy !== first.enteredBy);
  return second ? [first, second] : null;
}

/** After the vote: a loser goes back in the pool once; a second loss makes it a normal queued song. */
export function loserOutcome(lossesAfter: number): "return_to_pool" | "join_queue" {
  return lossesAfter >= MAX_CONTEST_LOSSES ? "join_queue" : "return_to_pool";
}

/** The Spotify handoff locks the next song this long before the current one ends. */
export const HANDOFF_LEAD_MS = 15_000;
const SAFETY_MS = 3_000;

/** How much of the current song has to be left for a contest to finish (vote +
 * result) before the handoff locks the next track. */
export function contestNeededMs(durationMs: number): number {
  return durationMs + CONTEST_RESULT_MS + HANDOFF_LEAD_MS + SAFETY_MS;
}

export type ContestBlocker =
  | "contest_running"
  | "not_enough_entries"
  | "next_locked"
  | "song_ending";

/** Why a contest can't start right now, or null when it can. The winner has to
 * really play next, and a song already handed to Spotify's queue can't be
 * pulled back, so a locked next song or a nearly finished current song blocks it. */
export function contestStartBlocker(input: {
  running: boolean;
  entries: PoolEntryLite[];
  nextLocked: boolean;
  /** ms left in the current song, or null if nothing is playing. */
  remainingMs: number | null;
  durationMs: number;
}): ContestBlocker | null {
  if (input.running) return "contest_running";
  if (!pickContestPair(input.entries)) return "not_enough_entries";
  if (input.nextLocked) return "next_locked";
  if (input.remainingMs !== null && input.remainingMs < contestNeededMs(input.durationMs)) return "song_ending";
  return null;
}

export const CONTEST_BLOCKER_TEXT: Record<ContestBlocker, string> = {
  contest_running: "A contest is already running.",
  not_enough_entries: "Needs songs from two different guests.",
  next_locked: "The next song is already locked in.",
  song_ending: "This song is too close to ending.",
};
