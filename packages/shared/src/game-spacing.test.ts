import { describe, expect, it } from "vitest";
import { autoContestDue, gameSpacingOk, songsUntilAutoContest, songsUntilGameAllowed } from "./game-spacing";

describe("gameSpacingOk", () => {
  it("allows the first game", () => {
    expect(gameSpacingOk(0, null)).toBe(true);
  });
  it("never two games on the same or consecutive songs; the third is fine", () => {
    // A game began when 3 songs had finished (during song 4).
    expect(gameSpacingOk(3, 3)).toBe(false); // same song
    expect(gameSpacingOk(4, 3)).toBe(false); // the very next song
    expect(gameSpacingOk(5, 3)).toBe(true); // one game-free song in between
  });
  it("reports how many songs to wait", () => {
    expect(songsUntilGameAllowed(3, 3)).toBe(2);
    expect(songsUntilGameAllowed(4, 3)).toBe(1);
    expect(songsUntilGameAllowed(5, 3)).toBe(0);
    expect(songsUntilGameAllowed(0, null)).toBe(0);
  });
});

describe("auto-contest cadence", () => {
  it("is due every N finished songs, never at zero", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((n) => autoContestDue(n, 3))).toEqual([3, 6]);
    expect(autoContestDue(5, 0)).toBe(false);
    expect(autoContestDue(1, 1)).toBe(true);
  });
  it("counts down to the next one", () => {
    expect(songsUntilAutoContest(0, 3)).toBe(3);
    expect(songsUntilAutoContest(1, 3)).toBe(2);
    expect(songsUntilAutoContest(3, 3)).toBe(0);
    expect(songsUntilAutoContest(4, 3)).toBe(2);
  });
  it("with contests every 3 songs and the spacing rule, they never run back to back", () => {
    let last: number | null = null;
    const started: number[] = [];
    for (let finished = 0; finished <= 30; finished++) {
      if (autoContestDue(finished, 3) && gameSpacingOk(finished, last)) {
        started.push(finished);
        last = finished;
      }
    }
    expect(started).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
    for (let i = 1; i < started.length; i++) expect(started[i] - started[i - 1]).toBeGreaterThanOrEqual(2);
  });
  it("every-1 auto-contests still leave a song between games", () => {
    let last: number | null = null;
    const started: number[] = [];
    for (let finished = 1; finished <= 10; finished++) {
      if (autoContestDue(finished, 1) && gameSpacingOk(finished, last)) {
        started.push(finished);
        last = finished;
      }
    }
    expect(started).toEqual([1, 3, 5, 7, 9]);
  });
});
