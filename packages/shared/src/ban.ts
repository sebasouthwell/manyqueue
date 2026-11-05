/** How long a ban vote runs. */
export const BAN_VOTE_SECONDS = 30;
/** How long the result stays on the TV. */
export const BAN_RESULT_MS = 4_000;

/** ms until this guest may call another ban vote; 0 means now. */
export function banCooldownLeftMs(lastCalledAt: number | null | undefined, cooldownMin: number, now: number): number {
  if (lastCalledAt == null) return 0;
  return Math.max(0, lastCalledAt + cooldownMin * 60_000 - now);
}

/** "Available in 6 min": rounds up so it never says 0 while still locked. */
export function banCooldownLabel(msLeft: number): string {
  const minutes = Math.ceil(msLeft / 60_000);
  return `Available in ${minutes} min`;
}

/** Where the yes / no / threshold sit on a bar whose full length is the number
 * of people who could vote (or the votes cast, if somehow more). Percentages, 0-100. */
export function banBarLayout(yes: number, no: number, active: number, threshold: number) {
  const scale = Math.max(1, active, yes + no, threshold);
  return {
    yesPct: (yes / scale) * 100,
    noPct: (no / scale) * 100,
    thresholdPct: (threshold / scale) * 100,
  };
}
