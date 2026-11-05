import type { VoteType } from "./vote.js";

export const VOTE_TALLY_MAX_PER_SECOND = 4;

/** Yes votes needed for a ban: at least 4, or half the active guests. */
export function banThreshold(activeCount: number): number {
  return Math.max(4, Math.ceil(0.5 * activeCount));
}

export interface Ballot {
  guestId: string;
  optionId: string;
  /** Epoch ms. */
  castAt: number;
}

export interface ResolvableVote {
  type: VoteType;
  /** In entry order: the first option is the one that entered first. */
  options: { id: string }[];
  /** skip only: yes votes needed. */
  threshold?: number;
}

export type VoteOutcome =
  | "winner" // most votes
  | "tie_break" // a tie, settled by the type's rule
  | "no_votes" // nobody voted
  | "tie" // a tie the type leaves unsettled
  | "passed"
  | "failed";

export interface VoteResult {
  winnerOptionId: string | null;
  outcome: VoteOutcome;
  counts: Record<string, number>;
  total: number;
  tiedOptionIds?: string[];
}

type Rule = (
  vote: ResolvableVote,
  counts: Record<string, number>,
  total: number,
  activeCount: number,
) => VoteResult;

function result(
  counts: Record<string, number>,
  total: number,
  winnerOptionId: string | null,
  outcome: VoteOutcome,
  tiedOptionIds?: string[],
): VoteResult {
  return { winnerOptionId, outcome, counts, total, ...(tiedOptionIds ? { tiedOptionIds } : {}) };
}

function leaders(vote: ResolvableVote, counts: Record<string, number>): string[] {
  const top = Math.max(...vote.options.map((o) => counts[o.id] ?? 0));
  return vote.options.filter((o) => (counts[o.id] ?? 0) === top).map((o) => o.id);
}

const RULES: Record<VoteType, Rule> = {
  // The song entered first wins a tie — including 0–0 — so a contest always
  // produces a winner; `no_votes` lets the UI say "nobody voted".
  contest(vote, counts, total) {
    const top = leaders(vote, counts);
    if (total === 0) return result(counts, total, vote.options[0]?.id ?? null, "no_votes");
    if (top.length === 1) return result(counts, total, top[0], "winner");
    return result(counts, total, top[0], "tie_break", top);
  },

  // yes/no; passes on the yes count alone, so "no" never needs a majority.
  ban(vote, counts, total, activeCount) {
    const yes = counts["yes"] ?? 0;
    const passed = yes >= banThreshold(activeCount);
    return result(counts, total, passed ? "yes" : "no", passed ? "passed" : "failed");
  },

  skip(vote, counts, total) {
    const yes = counts["yes"] ?? 0;
    const passed = vote.threshold !== undefined && yes >= vote.threshold;
    return result(counts, total, passed ? "yes" : "no", passed ? "passed" : "failed");
  },

  // Plurality; a tie has no single "most guessed" answer, so none is picked.
  guess(vote, counts, total) {
    if (total === 0) return result(counts, total, null, "no_votes");
    const top = leaders(vote, counts);
    if (top.length === 1) return result(counts, total, top[0], "winner");
    return result(counts, total, null, "tie", top);
  },
};

/**
 * Turns ballots into a result. One ballot counts per guest (the latest, or
 * the first for guess votes where the first choice is final). Ballots for an
 * option that doesn't exist, or from a guest outside `eligible` (kicked
 * mid-vote), are ignored. A guest who merely left keeps their ballot — they
 * did vote — but no longer counts towards `activeCount`.
 */
export function resolve(
  vote: ResolvableVote,
  ballots: Ballot[],
  activeCount: number,
  eligible?: ReadonlySet<string>,
): VoteResult {
  const optionIds = new Set(vote.options.map((o) => o.id));
  const chosen = new Map<string, Ballot>();
  for (const b of [...ballots].sort((a, b) => a.castAt - b.castAt)) {
    if (!optionIds.has(b.optionId)) continue;
    if (eligible && !eligible.has(b.guestId)) continue;
    if (vote.type === "guess" && chosen.has(b.guestId)) continue;
    chosen.set(b.guestId, b);
  }

  const counts: Record<string, number> = {};
  for (const o of vote.options) counts[o.id] = 0;
  for (const b of chosen.values()) counts[b.optionId] += 1;
  return RULES[vote.type](vote, counts, chosen.size, activeCount);
}

/** Live counts for the bar, using the same one-ballot-per-guest rule. */
export interface VoteCountsPayload {
  voteId: string;
  counts: Record<string, number>;
  total: number;
  /** Ban votes: the yes votes needed and how many could vote right now. */
  threshold?: number;
  active?: number;
}
