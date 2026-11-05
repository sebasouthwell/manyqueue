import { describe, expect, it } from "vitest";
import { ANNOUNCEMENT_MAX_LENGTH, announcementCooldownLeft, checkAnnouncement } from "./announcement";

describe("checkAnnouncement", () => {
  it("trims and collapses whitespace", () => {
    expect(checkAnnouncement("  Pizza's here!  ")).toEqual({ ok: true, text: "Pizza's here!" });
    expect(checkAnnouncement("Last  call\nfor  shots")).toEqual({ ok: true, text: "Last call for shots" });
  });

  it("rejects empty or too-long text", () => {
    expect(checkAnnouncement("   ")).toEqual({ ok: false, error: "empty" });
    expect(checkAnnouncement(undefined)).toEqual({ ok: false, error: "empty" });
    expect(checkAnnouncement("a".repeat(ANNOUNCEMENT_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(checkAnnouncement("a".repeat(ANNOUNCEMENT_MAX_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
  });

  it("does not censor announcements: they're the guest's own words, and staff can take the ability away", () => {
    expect(checkAnnouncement("this party is shit")).toMatchObject({ ok: true, text: "this party is shit" });
  });
});

describe("announcementCooldownLeft", () => {
  it("is 0 with no prior announcement", () => {
    expect(announcementCooldownLeft(undefined, 1000)).toBe(0);
  });

  it("counts down and clears once the cooldown has passed", () => {
    expect(announcementCooldownLeft(1000, 1000)).toBe(60_000);
    expect(announcementCooldownLeft(1000, 30_000)).toBe(31_000);
    expect(announcementCooldownLeft(1000, 61_000)).toBe(0);
    expect(announcementCooldownLeft(1000, 90_000)).toBe(0);
  });
});
