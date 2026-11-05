import { describe, expect, it } from "vitest";
import { GUESS_OPTION_COUNT, QUICK_GUESS_CHANCE, pickGuessOptions, rollQuickGuess, scoreGuessWho, shuffle } from "./guess";

// A tiny deterministic random source.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("pickGuessOptions", () => {
  const others = ["b", "c", "d", "e", "f", "g"];

  it("always includes the adder, with up to three others, all distinct", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const picked = pickGuessOptions("a", others, seeded(seed));
      expect(picked).toHaveLength(GUESS_OPTION_COUNT);
      expect(picked).toContain("a");
      expect(new Set(picked).size).toBe(GUESS_OPTION_COUNT);
    }
  });

  it("the adder isn't always in the same slot", () => {
    const slots = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) slots.add(pickGuessOptions("a", others, seeded(seed)).indexOf("a"));
    expect(slots.size).toBeGreaterThan(1);
  });

  it("uses fewer options when few guests are around, and never lists the adder twice", () => {
    expect(pickGuessOptions("a", ["b"], seeded(3)).sort()).toEqual(["a", "b"]);
    expect(pickGuessOptions("a", ["a", "b"], seeded(3)).sort()).toEqual(["a", "b"]);
    expect(pickGuessOptions("a", [], seeded(3))).toEqual(["a"]);
  });

  it("shuffle keeps every item", () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(9)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("scoreGuessWho", () => {
  const options = ["adder", "x", "y", "z"];
  const ballot = (guestId: string, optionId: string) => ({ guestId, optionId });

  it("everyone who guessed the adder is right; the adder earns nothing when 25% or more got it", () => {
    const s = scoreGuessWho("adder", [ballot("g1", "adder"), ballot("g2", "x"), ballot("g3", "y"), ballot("g4", "z")], options);
    expect(s.correctGuessers).toEqual(["g1"]);
    expect(s.correctShare).toBe(0.25);
    expect(s.adderStayedHidden).toBe(false); // exactly 25% is not "under 25%"
  });

  it("under 25% right: the adder stayed hidden", () => {
    const ballots = [ballot("g1", "adder"), ...Array.from({ length: 4 }, (_, i) => ballot(`h${i}`, "x"))];
    const s = scoreGuessWho("adder", ballots, options);
    expect(s.correctShare).toBe(0.2);
    expect(s.adderStayedHidden).toBe(true);
  });

  it("nobody guessing counts as staying hidden", () => {
    const s = scoreGuessWho("adder", [], options);
    expect(s).toMatchObject({ correctGuessers: [], totalGuessers: 0, adderStayedHidden: true });
    expect(s.percents).toEqual({ adder: 0, x: 0, y: 0, z: 0 });
  });

  it("everyone right: nobody stayed hidden", () => {
    const s = scoreGuessWho("adder", [ballot("g1", "adder"), ballot("g2", "adder")], options);
    expect(s.correctGuessers).toEqual(["g1", "g2"]);
    expect(s.adderStayedHidden).toBe(false);
    expect(s.percents.adder).toBe(100);
  });

  it("the adder's own ballot and unknown options are ignored", () => {
    const s = scoreGuessWho("adder", [ballot("adder", "adder"), ballot("g1", "nobody")], options);
    expect(s.totalGuessers).toBe(0);
  });

  it("reports each option's share for the reveal bars", () => {
    const s = scoreGuessWho("adder", [ballot("g1", "adder"), ballot("g2", "x"), ballot("g3", "x"), ballot("g4", "y")], options);
    expect(s.percents).toEqual({ adder: 25, x: 50, y: 25, z: 0 });
  });
});

describe("rollQuickGuess", () => {
  it("fires on about one song in five", () => {
    const random = seeded(2024);
    let hits = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) if (rollQuickGuess(random)) hits++;
    expect(hits / N).toBeGreaterThan(QUICK_GUESS_CHANCE - 0.02);
    expect(hits / N).toBeLessThan(QUICK_GUESS_CHANCE + 0.02);
  });
  it("is deterministic at the edges", () => {
    expect(rollQuickGuess(() => 0)).toBe(true);
    expect(rollQuickGuess(() => 0.999)).toBe(false);
  });
});
