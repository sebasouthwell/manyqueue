import { describe, expect, it } from "vitest";
import { AI_MAX_CALLS_PER_NIGHT, AiReplySchema, countEmoji, shouldChangeNickname, shouldRunBatch, validateAiNickname } from "./ai-nickname";

describe("validateAiNickname", () => {
  it("accepts a playful nickname with one emoji", () => {
    expect(validateAiNickname("The Reggaeton Menace 🐰", "Queued four in a row.")).toEqual({ ok: true, nickname: "The Reggaeton Menace 🐰", why: "Queued four in a row." });
  });
  it("counts emoji properly, including ones with variation selectors", () => {
    expect(countEmoji("Sad Boy Hours 🕵️")).toBe(1);
    expect(countEmoji("Two 🔥🔥")).toBe(2);
    expect(countEmoji("None")).toBe(0);
  });
  it("needs exactly one emoji", () => {
    expect(validateAiNickname("No Emoji Here", "x")).toMatchObject({ ok: false, reason: "emoji_count" });
    expect(validateAiNickname("Too Many 🔥💀", "x")).toMatchObject({ ok: false, reason: "emoji_count" });
  });
  it("caps length at 32 characters and words at 4", () => {
    expect(validateAiNickname("The Extremely Long Nickname Of Doom Indeed 🎉", "x")).toMatchObject({ ok: false });
    expect(validateAiNickname("One Two Three Four Five 🎉", "x")).toMatchObject({ ok: false, reason: "word_count" });
  });
  it("rejects anything on the profanity list, in the nickname or the reason", () => {
    expect(validateAiNickname("Absolute Shit Taste 💩", "x")).toMatchObject({ ok: false, reason: "profanity" });
    expect(validateAiNickname("Chart Topper 🎉", "queued a shit ton")).toMatchObject({ ok: false, reason: "profanity" });
  });
  it("rejects a nickname that contains a real guest name", () => {
    expect(validateAiNickname("Not Maya 🎉", "x", ["Maya", "Sam"])).toMatchObject({ ok: false, reason: "real_name" });
    expect(validateAiNickname("Disco Goblin 🎉", "x", ["Maya"])).toMatchObject({ ok: true });
  });
  it("rejects non-strings and empty", () => {
    expect(validateAiNickname(5, "x")).toMatchObject({ ok: false });
    expect(validateAiNickname("   ", "x")).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("AiReplySchema", () => {
  it("parses the expected shape and rejects junk", () => {
    expect(AiReplySchema.safeParse({ g1: { nickname: "A 🎉", why: "b" } }).success).toBe(true);
    expect(AiReplySchema.safeParse({ g1: { nickname: 3 } }).success).toBe(false);
    expect(AiReplySchema.safeParse([]).success).toBe(false);
  });
});

describe("cadence", () => {
  it("runs every 8 finished songs while the budget lasts", () => {
    expect([0, 4, 8, 12, 16].filter((n) => shouldRunBatch(n, 0))).toEqual([8, 16]);
    expect(shouldRunBatch(8, AI_MAX_CALLS_PER_NIGHT)).toBe(false);
  });
  it("changes a nickname only if different and 16 songs later", () => {
    expect(shouldChangeNickname(null, "New 🎉", 8)).toBe(true);
    expect(shouldChangeNickname({ nickname: "Old 🎉", atFinished: 8 }, "old 🎉", 40)).toBe(false);
    expect(shouldChangeNickname({ nickname: "Old 🎉", atFinished: 8 }, "New 🎉", 23)).toBe(false);
    expect(shouldChangeNickname({ nickname: "Old 🎉", atFinished: 8 }, "New 🎉", 24)).toBe(true);
  });
});

import { cleanGenreTags, anonymiseIds } from "./ai-nickname";

describe("genre tags", () => {
  it("keeps up to three tidy lowercase tags", () => {
    expect(cleanGenreTags(["Pop", " Dance  Pop ", "R&B", "hip hop"])).toEqual(["pop", "dance pop", "r&b"]);
  });
  it("drops junk, duplicates and long tags", () => {
    expect(cleanGenreTags(["pop", "POP", "", 5, "x".repeat(30), "<script>", "fuck"])).toEqual(["pop"]);
  });
});

describe("anonymiseIds", () => {
  it("numbers guests g1..gN and maps back", () => {
    const { toAnon, fromAnon } = anonymiseIds(["u-a", "u-b"]);
    expect(toAnon.get("u-b")).toBe("g2");
    expect(fromAnon.get("g1")).toBe("u-a");
  });
});
