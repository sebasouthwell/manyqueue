import { describe, it, expect } from "vitest";
import { songRuleViolation, cooldownRemainingMs } from "./song-rules.js";

const open = { maxSongMin: null, explicit: true };

describe("songRuleViolation", () => {
  it("allows anything with no rules set", () => {
    expect(songRuleViolation({ durationMs: 900_000, explicit: true }, open)).toBeNull();
  });
  it("flags a 6-minute song when the max is 5", () => {
    expect(songRuleViolation({ durationMs: 360_000, explicit: false }, { ...open, maxSongMin: 5 })).toBe("too_long");
  });
  it("allows a song exactly at the max", () => {
    expect(songRuleViolation({ durationMs: 300_000, explicit: false }, { ...open, maxSongMin: 5 })).toBeNull();
  });
  it("flags explicit when explicit is off", () => {
    expect(songRuleViolation({ durationMs: 100_000, explicit: true }, { ...open, explicit: false })).toBe("explicit");
  });
  it("reports too_long before explicit when both apply", () => {
    expect(songRuleViolation({ durationMs: 999_000, explicit: true }, { maxSongMin: 5, explicit: false })).toBe("too_long");
  });
});

describe("cooldownRemainingMs", () => {
  it("is 0 with no previous add", () => expect(cooldownRemainingMs(null, 120, 1000)).toBe(0));
  it("counts down from the last add", () => {
    expect(cooldownRemainingMs(0, 120, 30_000)).toBe(90_000);
  });
  it("is 0 once elapsed", () => expect(cooldownRemainingMs(0, 120, 200_000)).toBe(0));
  it("is 0 when the cooldown is off", () => expect(cooldownRemainingMs(0, 0, 1)).toBe(0));
});
