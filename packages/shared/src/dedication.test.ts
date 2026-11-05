import { describe, expect, it } from "vitest";
import { DEDICATION_MAX_LENGTH, checkDedication, containsBlockedWord } from "./dedication";

describe("checkDedication", () => {
  it("accepts a normal dedication and trims it", () => {
    expect(checkDedication("  for Sam 🎂  ")).toEqual({ ok: true, text: "for Sam 🎂" });
    expect(checkDedication("Happy   birthday\nSam")).toEqual({ ok: true, text: "Happy birthday Sam" });
  });

  it("rejects empty and over-long", () => {
    expect(checkDedication("   ")).toEqual({ ok: false, error: "empty" });
    expect(checkDedication(undefined)).toEqual({ ok: false, error: "empty" });
    expect(checkDedication("a".repeat(DEDICATION_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(checkDedication("a".repeat(DEDICATION_MAX_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
  });

  it("counts emoji as one character each", () => {
    expect(checkDedication("🎂".repeat(DEDICATION_MAX_LENGTH))).toMatchObject({ ok: true });
  });

  it("does not censor dedications: they are the guest's own words (the host can hide any)", () => {
    for (const text of ["you are shit", "F U C K this", "happy birthday you old bastard 🎂"]) {
      expect(checkDedication(text), text).toMatchObject({ ok: true });
    }
  });

  // The word list still guards public names (party name, AI nicknames).
  it("blocked-word helper catches simple disguises", () => {
    for (const bad of ["you are shit", "F U C K this", "f.u.c.k", "sh1t", "fuuuuck", "B!TCH", "nazi party"]) {
      expect(containsBlockedWord(bad), bad).toBe(true);
    }
  });

  it("blocked-word helper does not flag innocent words that merely contain a listed one", () => {
    for (const fine of ["class of 2019", "Scunthorpe forever", "Dickens fan club", "assassin's creed", "shiitake mushrooms", "cocktail hour", "for Sam 🎂"]) {
      expect(containsBlockedWord(fine), fine).toBe(false);
    }
  });
});
