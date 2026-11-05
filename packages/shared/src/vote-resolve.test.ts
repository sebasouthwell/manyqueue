import { describe, expect, it } from "vitest";
import { banThreshold, resolve, type Ballot } from "./vote-resolve";

const b = (guestId: string, optionId: string, castAt = 0): Ballot => ({ guestId, optionId, castAt });
const contest = { type: "contest" as const, options: [{ id: "first" }, { id: "second" }] };

describe("contest", () => {
  it("most votes wins", () => {
    const r = resolve(contest, [b("a", "second"), b("b", "second"), b("c", "first")], 5);
    expect(r).toMatchObject({ winnerOptionId: "second", outcome: "winner", total: 3 });
    expect(r.counts).toEqual({ first: 1, second: 2 });
  });

  it("a tie goes to the song entered first", () => {
    const r = resolve(contest, [b("a", "second"), b("b", "first")], 5);
    expect(r).toMatchObject({ winnerOptionId: "first", outcome: "tie_break", tiedOptionIds: ["first", "second"] });
  });

  it("no votes: the first entry wins but it's flagged", () => {
    expect(resolve(contest, [], 5)).toMatchObject({ winnerOptionId: "first", outcome: "no_votes", total: 0 });
  });

  it("a changed ballot counts once, as the latest choice", () => {
    const r = resolve(contest, [b("a", "first", 1), b("a", "second", 2), b("b", "first", 1)], 5);
    expect(r.counts).toEqual({ first: 1, second: 1 });
    expect(r.total).toBe(2);
  });

  it("ignores unknown options and kicked guests, keeps guests who just left", () => {
    const r = resolve(
      contest,
      [b("a", "nope"), b("kicked", "second"), b("left", "second"), b("stays", "first")],
      1,
      new Set(["left", "stays"]),
    );
    expect(r.counts).toEqual({ first: 1, second: 1 });
  });
});

describe("ban", () => {
  const ban = { type: "ban" as const, options: [{ id: "yes" }, { id: "no" }] };
  const yes = (n: number) => Array.from({ length: n }, (_, i) => b(`g${i}`, "yes"));

  it("threshold is max(4, half of active)", () => {
    expect(banThreshold(3)).toBe(4);
    expect(banThreshold(8)).toBe(4);
    expect(banThreshold(9)).toBe(5);
    expect(banThreshold(20)).toBe(10);
  });

  it("passes at the threshold, fails one short", () => {
    expect(resolve(ban, yes(4), 8)).toMatchObject({ winnerOptionId: "yes", outcome: "passed" });
    expect(resolve(ban, yes(3), 8)).toMatchObject({ winnerOptionId: "no", outcome: "failed" });
  });

  it("a guest leaving mid-vote lowers the bar but keeps their ballot", () => {
    // 10 active → need 5; 4 yes fails. Two leave → 8 active → need 4; the same 4 ballots now pass.
    expect(resolve(ban, yes(4), 10).outcome).toBe("failed");
    expect(resolve(ban, yes(4), 8).outcome).toBe("passed");
  });

  it("no votes fails", () => {
    expect(resolve(ban, [], 10)).toMatchObject({ winnerOptionId: "no", outcome: "failed" });
  });
});

describe("guess", () => {
  const guess = { type: "guess" as const, options: [{ id: "p" }, { id: "q" }, { id: "r" }] };

  it("plurality wins", () => {
    expect(resolve(guess, [b("a", "p"), b("b", "p"), b("c", "q")], 4)).toMatchObject({
      winnerOptionId: "p",
      outcome: "winner",
    });
  });

  it("a tie picks nobody", () => {
    expect(resolve(guess, [b("a", "p"), b("b", "q")], 4)).toMatchObject({
      winnerOptionId: null,
      outcome: "tie",
      tiedOptionIds: ["p", "q"],
    });
  });

  it("the first choice is final", () => {
    const r = resolve(guess, [b("a", "p", 1), b("a", "q", 2)], 4);
    expect(r.counts).toEqual({ p: 1, q: 0, r: 0 });
  });

  it("no votes", () => {
    expect(resolve(guess, [], 4)).toMatchObject({ winnerOptionId: null, outcome: "no_votes" });
  });
});

describe("skip", () => {
  const skip = { type: "skip" as const, options: [{ id: "yes" }], threshold: 3 };
  it("passes at its threshold", () => {
    expect(resolve(skip, [b("a", "yes"), b("b", "yes")], 9).outcome).toBe("failed");
    expect(resolve(skip, [b("a", "yes"), b("b", "yes"), b("c", "yes")], 9).outcome).toBe("passed");
  });
});
