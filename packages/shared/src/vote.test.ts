import { describe, expect, it } from "vitest";
import { VOTE_RESULT_MS, shouldOpenVote, votePhase } from "./vote";

const vote = { deadlineAt: 10_000 };

describe("votePhase", () => {
  it("is open until the deadline", () => {
    expect(votePhase(vote, undefined, 0)).toBe("open");
    expect(votePhase(vote, undefined, 9_999)).toBe("open");
  });

  it("shows the result for 2s after the deadline, then closes", () => {
    expect(votePhase(vote, undefined, 10_000)).toBe("result");
    expect(votePhase(vote, undefined, 10_000 + VOTE_RESULT_MS - 1)).toBe("result");
    expect(votePhase(vote, undefined, 10_000 + VOTE_RESULT_MS)).toBe("closed");
  });

  it("an early close moves the result hold earlier", () => {
    expect(votePhase(vote, { closedAt: 4_000 }, 3_999)).toBe("open");
    expect(votePhase(vote, { closedAt: 4_000 }, 4_000)).toBe("result");
    expect(votePhase(vote, { closedAt: 4_000 }, 6_000)).toBe("closed");
  });

  it("a closedAt after the deadline never extends the vote", () => {
    expect(votePhase(vote, { closedAt: 99_000 }, 10_000)).toBe("result");
  });
});

describe("shouldOpenVote", () => {
  it("never opens a vote that already ended", () => {
    expect(shouldOpenVote(vote, 9_999)).toBe(true);
    expect(shouldOpenVote(vote, 10_000)).toBe(false);
    expect(shouldOpenVote(vote, 50_000)).toBe(false);
  });
});
