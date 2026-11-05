import { describe, expect, it } from "vitest";
import { contestNeededMs, contestStartBlocker, loserOutcome, pickContestPair } from "./contest";

const e = (id: string, enteredBy: string, createdAt: number, losses = 0) => ({ id, enteredBy, createdAt, losses });

describe("pickContestPair", () => {
  it("takes the two oldest from different guests, older first", () => {
    const pair = pickContestPair([e("c", "g3", 30), e("a", "g1", 10), e("b", "g2", 20)]);
    expect(pair?.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("skips a second entry from the same guest", () => {
    const pair = pickContestPair([e("a", "g1", 10), e("a2", "g1", 15), e("b", "g2", 20)]);
    expect(pair?.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("needs two different guests", () => {
    expect(pickContestPair([])).toBeNull();
    expect(pickContestPair([e("a", "g1", 10)])).toBeNull();
    expect(pickContestPair([e("a", "g1", 10), e("a2", "g1", 20)])).toBeNull();
  });
});

describe("loserOutcome", () => {
  it("returns to the pool once, then joins the queue", () => {
    expect(loserOutcome(1)).toBe("return_to_pool");
    expect(loserOutcome(2)).toBe("join_queue");
  });
});

describe("contestStartBlocker", () => {
  const entries = [e("a", "g1", 1), e("b", "g2", 2)];
  const base = { running: false, entries, nextLocked: false, remainingMs: 200_000, durationMs: 30_000 };

  it("allows a contest with room to finish", () => {
    expect(contestStartBlocker(base)).toBeNull();
  });

  it("blocks while one is running, without two guests, with a locked next song, or too near the end", () => {
    expect(contestStartBlocker({ ...base, running: true })).toBe("contest_running");
    expect(contestStartBlocker({ ...base, entries: [e("a", "g1", 1)] })).toBe("not_enough_entries");
    expect(contestStartBlocker({ ...base, nextLocked: true })).toBe("next_locked");
    expect(contestStartBlocker({ ...base, remainingMs: contestNeededMs(30_000) - 1 })).toBe("song_ending");
    expect(contestStartBlocker({ ...base, remainingMs: contestNeededMs(30_000) })).toBeNull();
  });

  it("nothing playing is fine", () => {
    expect(contestStartBlocker({ ...base, remainingMs: null })).toBeNull();
  });
});
