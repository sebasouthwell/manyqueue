import type { ContestPoolPayload } from "./socket.js";
import type { VoteType } from "./vote.js";

/** The vote that's live right now, as the host and co-hosts see it. */
export interface LiveGameView {
  voteId: string;
  type: VoteType;
  title: string;
  /** Server epoch ms. */
  deadlineAt: number;
  options: { id: string; label: string; sublabel?: string; emoji?: string; count: number }[];
  total: number;
  /** Ban votes: yes votes needed and how many could vote. */
  ban?: { threshold: number; active: number };
  /** Guess votes hide their per-option counts, even from the host; only how many have guessed. */
  countsHidden: boolean;
}

/** Pushed to staff sockets whenever a game starts, moves or ends. */
export interface GamesState {
  live: LiveGameView | null;
  contest: ContestPoolPayload;
}

export interface BanHistoryItem {
  id: string;
  at: number;
  trackName: string;
  artistName: string;
  calledBy: string | null;
  outcome: "banned" | "kept" | "host_kept";
  yes: number;
  no: number;
}

export interface GuessHistoryItem {
  id: string;
  at: number;
  trackName: string;
  adder: string;
  guessers: number;
  correct: number;
}

export interface ContestHistoryItem {
  id: string;
  at: number;
  winner: string;
  loser: string;
  outcome: "winner" | "tie_break" | "no_votes";
}

export interface GamesHistory {
  bans: BanHistoryItem[];
  guesses: GuessHistoryItem[];
  contests: ContestHistoryItem[];
}

export interface GamesResponse {
  state: GamesState;
  history: GamesHistory;
}
