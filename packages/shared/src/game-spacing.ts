/**
 * Games (song contests, ban votes) are spaced out by the count of songs
 * finished when each began: at most one game per song, and at least one song
 * with no game between two games. A game that started when `last` songs had
 * finished (so, during song last+1) leaves song last+2 free, and the next game
 * may start once `last + 2` songs have finished (during song last+3).
 */
export function gameSpacingOk(finishedNow: number, lastGameAtFinished: number | null): boolean {
  return lastGameAtFinished === null || finishedNow >= lastGameAtFinished + 2;
}

/** How many more songs must finish before another game may start (0 = it may now). */
export function songsUntilGameAllowed(finishedNow: number, lastGameAtFinished: number | null): number {
  if (lastGameAtFinished === null) return 0;
  return Math.max(0, lastGameAtFinished + 2 - finishedNow);
}

/** Auto-contest runs as a song starts, every `everySongs` finished songs. */
export function autoContestDue(finishedNow: number, everySongs: number): boolean {
  return everySongs > 0 && finishedNow > 0 && finishedNow % everySongs === 0;
}

/** Songs until the next auto-contest is due (0 when it's due right now). */
export function songsUntilAutoContest(finishedNow: number, everySongs: number): number {
  if (everySongs <= 0) return 0;
  const into = finishedNow % everySongs;
  return into === 0 && finishedNow > 0 ? 0 : everySongs - into;
}
