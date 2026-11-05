import { describe, expect, it } from "vitest";
import { PARTY_NAME_MAX_LENGTH, cleanPartyName } from "./room-name";

describe("cleanPartyName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanPartyName("  Sam's   40th 🎂 ")).toEqual({ ok: true, name: "Sam's 40th 🎂" });
  });
  it("rejects empty, too long and rude names", () => {
    expect(cleanPartyName("   ")).toEqual({ ok: false, error: "empty" });
    expect(cleanPartyName(undefined)).toEqual({ ok: false, error: "empty" });
    expect(cleanPartyName("x".repeat(PARTY_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(cleanPartyName("x".repeat(PARTY_NAME_MAX_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
    expect(cleanPartyName("shit show")).toEqual({ ok: false, error: "profanity" });
  });
});
