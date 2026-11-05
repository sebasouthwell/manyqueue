import { describe, expect, it } from "vitest";
import { isNearEndSkip } from "./queue";

describe("isNearEndSkip", () => {
  it("is a real skip below 80% through", () => {
    expect(isNearEndSkip(0, 200_000)).toBe(false);
    expect(isNearEndSkip(100_000, 200_000)).toBe(false);
    expect(isNearEndSkip(159_000, 200_000)).toBe(false); // 79.5%
  });

  it("doesn't count from 80% through, including right at the end", () => {
    expect(isNearEndSkip(160_000, 200_000)).toBe(true); // exactly 80%
    expect(isNearEndSkip(190_000, 200_000)).toBe(true);
    expect(isNearEndSkip(200_000, 200_000)).toBe(true);
    expect(isNearEndSkip(205_000, 200_000)).toBe(true); // a hair over duration: still counts
  });

  it("is always a real skip when the duration is unknown", () => {
    expect(isNearEndSkip(50_000, 0)).toBe(false);
  });
});
