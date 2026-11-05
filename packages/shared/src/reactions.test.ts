import { describe, expect, it } from "vitest";
import {
  DEFAULT_REACTIONS,
  REACTION_COOLDOWN_MS,
  sanitizeReactionSet,
  initialReactionPool,
  isReactionEmoji,
  poolFlush,
  poolOnFloatDone,
  poolOnReaction,
  reactionCooldownLeft,
} from "./reactions";

describe("cooldown", () => {
  it("allows the first reaction, then blocks until the cooldown has passed", () => {
    expect(reactionCooldownLeft(undefined, 5_000)).toBe(0);
    expect(reactionCooldownLeft(5_000, 5_000)).toBe(REACTION_COOLDOWN_MS);
    expect(reactionCooldownLeft(5_000, 5_000 + 200)).toBe(REACTION_COOLDOWN_MS - 200);
    expect(reactionCooldownLeft(5_000, 5_000 + REACTION_COOLDOWN_MS)).toBe(0);
  });
});

describe("isReactionEmoji", () => {
  it("accepts palette emoji only", () => {
    expect(isReactionEmoji("🔥")).toBe(true);
    expect(isReactionEmoji("🎉")).toBe(true);
    expect(isReactionEmoji("🍕")).toBe(false);
    expect(isReactionEmoji(undefined)).toBe(false);
  });
});

describe("sanitizeReactionSet", () => {
  it("defaults when nothing is saved", () => {
    expect(sanitizeReactionSet(undefined)).toEqual([...DEFAULT_REACTIONS]);
    expect(sanitizeReactionSet("junk")).toEqual([...DEFAULT_REACTIONS]);
  });

  it("keeps valid picks in the three swappable slots", () => {
    expect(sanitizeReactionSet(["🔥", "🎉", "❤️", "😂"])).toEqual(["🔥", "🎉", "❤️", "😂"]);
  });

  it("fire is always first, whatever was saved", () => {
    expect(sanitizeReactionSet(["🎉", "💀", "💃", "😭"])[0]).toBe("🔥");
    // The saved slot 0 is ignored; the other three are kept as chosen.
    expect(sanitizeReactionSet(["🎉", "🎉", "❤️", "😂"])).toEqual(["🔥", "🎉", "❤️", "😂"]);
  });

  it("repairs duplicates, fire in another slot, and unknown emoji", () => {
    const fixed = sanitizeReactionSet(["🔥", "🔥", "🍕", "🎉"]);
    expect(fixed).toHaveLength(4);
    expect(new Set(fixed).size).toBe(4);
    expect(fixed[0]).toBe("🔥");
    expect(fixed[3]).toBe("🎉");
    expect(fixed.every((e) => isReactionEmoji(e))).toBe(true);
  });
});

describe("reaction pool", () => {
  it("floats until full, then overflows into counts", () => {
    let state = initialReactionPool;
    for (let i = 0; i < 3; i++) {
      const r = poolOnReaction(state, "🔥", 3);
      expect(r.float).toBe(true);
      state = r.state;
    }
    const over = [poolOnReaction(state, "🔥", 3), poolOnReaction(state, "💃", 3)];
    expect(over.every((o) => !o.float)).toBe(true);
    state = poolOnReaction(poolOnReaction(state, "🔥", 3).state, "🔥", 3).state;
    expect(state.overflow).toEqual({ "🔥": 2 });
    expect(state.active).toBe(3);
  });

  it("flush turns overflow into one burst per emoji and clears it", () => {
    let state = { active: 3, overflow: { "🔥": 12, "😭": 2 } as Partial<Record<"🔥" | "😭", number>> };
    const { state: next, bursts } = poolFlush(state);
    expect(bursts).toEqual([
      { emoji: "🔥", count: 12 },
      { emoji: "😭", count: 2 },
    ]);
    expect(next.overflow).toEqual({});
    expect(poolFlush(next).bursts).toEqual([]);
  });

  it("finished floats free their slot, never below zero", () => {
    expect(poolOnFloatDone({ active: 2, overflow: {} }).active).toBe(1);
    expect(poolOnFloatDone({ active: 0, overflow: {} }).active).toBe(0);
    const freed = poolOnReaction(poolOnFloatDone({ active: 3, overflow: {} }), "💀", 3);
    expect(freed.float).toBe(true);
  });
});
