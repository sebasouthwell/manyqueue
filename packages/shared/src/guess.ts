/** How long the "who queued it?" vote runs (or until the song ends, if sooner). */
export const GUESS_VOTE_SECONDS = 45;
/** The real adder plus up to three other guests. */
export const GUESS_OPTION_COUNT = 4;
/** Extra tokens to queue a song anonymously; comes back as `stayed_hidden` if nobody guesses. */
export const ANONYMOUS_COST = 1;
/** The adder earns a token if fewer than this share of the guessers got it right. */
export const STAYED_HIDDEN_BELOW = 0.25;
/** The casual "who queued this?" on ordinary songs: about 1 in 5, 20 seconds, no tokens. */
export const QUICK_GUESS_CHANCE = 0.2;
export const QUICK_GUESS_SECONDS = 20;

export function rollQuickGuess(random: () => number = Math.random): boolean {
  return random() < QUICK_GUESS_CHANCE;
}

/** How long the reveal stays on the TV. */
export const REVEAL_HOLD_MS = 7_000;

/** Fisher-Yates with an injectable random source, so it's testable. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Who appears on the guess sheet: the real adder plus up to three other active
 * guests picked at random, in random order so the answer never sits in a fixed
 * slot. Returns just the adder if nobody else is around (the caller skips the
 * vote then).
 */
export function pickGuessOptions(
  adderId: string,
  otherActiveIds: readonly string[],
  random: () => number = Math.random,
): string[] {
  const others = shuffle(otherActiveIds.filter((id) => id !== adderId), random).slice(0, GUESS_OPTION_COUNT - 1);
  return shuffle([adderId, ...others], random);
}

export interface GuessBallot {
  guestId: string;
  optionId: string;
}

export interface GuessScore {
  /** Everyone who guessed the adder, each earning +1 (`guess_right`). */
  correctGuessers: string[];
  totalGuessers: number;
  /** Share (0-1) who got it right; 0 when nobody guessed. */
  correctShare: number;
  /** Fewer than 25% guessed right (nobody guessing counts): the adder earns +1 (`stayed_hidden`). */
  adderStayedHidden: boolean;
  /** Each option's share of the guesses, 0-100, for the reveal bars. */
  percents: Record<string, number>;
}

export function scoreGuessWho(adderId: string, ballots: readonly GuessBallot[], optionIds: readonly string[]): GuessScore {
  const valid = ballots.filter((b) => b.guestId !== adderId && optionIds.includes(b.optionId));
  const correctGuessers = valid.filter((b) => b.optionId === adderId).map((b) => b.guestId);
  const total = valid.length;
  const share = total === 0 ? 0 : correctGuessers.length / total;
  const percents: Record<string, number> = {};
  for (const id of optionIds) {
    const n = valid.filter((b) => b.optionId === id).length;
    percents[id] = total === 0 ? 0 : Math.round((n / total) * 100);
  }
  return {
    correctGuessers,
    totalGuessers: total,
    correctShare: share,
    adderStayedHidden: share < STAYED_HIDDEN_BELOW,
    percents,
  };
}
