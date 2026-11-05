// No voting in the first 15s of a song. Shared so the client can derive the
// countdown from the already-synced playback progress instead of running its
// own independent timer (which drifts, especially when a phone tab is
// backgrounded) — the server remains the authority via queue_items.startedAt.
export const VOTE_SKIP_OPENS_AFTER_MS = 15_000;

export interface VoteTallyPayload {
  targetQueueItemId: string;
  count: number;
  threshold: number;
  skipped: boolean;
}

export type VoteType = "skip" | "contest" | "ban" | "guess";

export interface VoteOptionView {
  id: string;
  label: string;
  sublabel?: string;
  albumArtUrl?: string | null;
  /** A guest avatar, for "who queued it?" options. */
  emoji?: string;
  /** e.g. "Your song" — the card is shown but can't be picked. */
  disabledReason?: string;
}

/** What the server stores for an option; per-guest extras (disabledReason)
 * are added when the vote is sent to a phone. */
export type VoteOptionSpec = Omit<VoteOptionView, "disabledReason">;

/** deadlineAt is server epoch ms; clients compare it against Date.now() +
 * clockOffsetMs so a phone with a wrong clock still closes on time. */
export interface VoteOpenedPayload {
  id: string;
  type: VoteType;
  title: string;
  instruction?: string;
  options: VoteOptionView[];
  deadlineAt: number;
  /** Set when the phone reconnects mid-vote and already has a ballot. */
  myOptionId?: string | null;
  /** Ban votes: yes votes needed, and how many could vote, when it opened. */
  threshold?: number;
  active?: number;
  /** A light-hearted vote: phones show a pill instead of opening the sheet. */
  casual?: boolean;
  /** Ban votes: the song being voted on. */
  target?: { name: string; artist: string; albumArtUrl: string | null };
}

export interface VoteClosedPayload {
  id: string;
  winnerOptionId: string | null;
  /** One line for the 2s result hold, e.g. "Levitating wins". */
  summary?: string;
  closedAt: number;
}

/** How long a vote sheet keeps showing its result before it goes away. */
export const VOTE_RESULT_MS = 2_000;

export type VotePhase = "open" | "result" | "closed";

/** open until the deadline (or an early close), then the result for 2s, then
 * gone. A vote that has already ended when it first arrives (a reconnect, a
 * slow socket) is "closed" and must never be opened late. */
export function votePhase(
  vote: { deadlineAt: number },
  closed: { closedAt: number } | undefined,
  now: number,
): VotePhase {
  const endsAt = closed ? Math.min(closed.closedAt, vote.deadlineAt) : vote.deadlineAt;
  if (now < endsAt) return "open";
  if (now < endsAt + VOTE_RESULT_MS) return "result";
  return "closed";
}

/** Whether a vote arriving now may open a sheet at all. */
export function shouldOpenVote(vote: { deadlineAt: number }, now: number): boolean {
  return now < vote.deadlineAt;
}
