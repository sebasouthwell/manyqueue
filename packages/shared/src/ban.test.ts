import { describe, expect, it } from "vitest";
import { banBarLayout, banCooldownLabel, banCooldownLeftMs } from "./ban";

describe("banCooldownLeftMs", () => {
  const T = 1_000_000;
  it("is free the first time", () => {
    expect(banCooldownLeftMs(null, 20, T)).toBe(0);
    expect(banCooldownLeftMs(undefined, 20, T)).toBe(0);
  });
  it("counts down 20 minutes from the last call", () => {
    expect(banCooldownLeftMs(T, 20, T)).toBe(20 * 60_000);
    expect(banCooldownLeftMs(T, 20, T + 14 * 60_000)).toBe(6 * 60_000);
    expect(banCooldownLeftMs(T, 20, T + 20 * 60_000)).toBe(0);
  });
  it("labels the wait, rounding up", () => {
    expect(banCooldownLabel(6 * 60_000)).toBe("Available in 6 min");
    expect(banCooldownLabel(5 * 60_000 + 1)).toBe("Available in 6 min");
    expect(banCooldownLabel(1)).toBe("Available in 1 min");
  });
});

describe("banBarLayout", () => {
  it("scales to the people who could vote", () => {
    const l = banBarLayout(2, 1, 10, 5);
    expect(l).toEqual({ yesPct: 20, noPct: 10, thresholdPct: 50 });
  });
  it("never overflows if more voted than were counted active", () => {
    const l = banBarLayout(6, 4, 8, 4);
    expect(l.yesPct + l.noPct).toBeLessThanOrEqual(100);
    expect(l.thresholdPct).toBeLessThanOrEqual(100);
  });
  it("copes with an empty room", () => {
    expect(banBarLayout(0, 0, 0, 4)).toEqual({ yesPct: 0, noPct: 0, thresholdPct: 100 });
  });
});
