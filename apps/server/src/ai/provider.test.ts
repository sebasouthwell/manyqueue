import { describe, it, expect, afterEach } from "vitest";
import { aiProvider, isAiConfigured } from "./provider.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "AI_PROVIDER"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function env(anthropic: boolean, deepseek: boolean, pref?: string) {
  if (anthropic) process.env.ANTHROPIC_API_KEY = "a";
  else delete process.env.ANTHROPIC_API_KEY;
  if (deepseek) process.env.DEEPSEEK_API_KEY = "d";
  else delete process.env.DEEPSEEK_API_KEY;
  if (pref) process.env.AI_PROVIDER = pref;
  else delete process.env.AI_PROVIDER;
}

describe("aiProvider", () => {
  it("prefers Claude when both keys are set, unless AI_PROVIDER says otherwise", () => {
    env(true, true);
    expect(aiProvider()).toBe("anthropic");
    env(true, true, "deepseek");
    expect(aiProvider()).toBe("deepseek");
    env(true, true, "claude");
    expect(aiProvider()).toBe("anthropic");
  });
  it("uses whichever key exists, ignoring a preference whose key is missing", () => {
    env(false, true, "anthropic");
    expect(aiProvider()).toBe("deepseek");
    env(true, false, "deepseek");
    expect(aiProvider()).toBe("anthropic");
  });
  it("no key: AI features off", () => {
    env(false, false, "anthropic");
    expect(aiProvider()).toBeNull();
    expect(isAiConfigured()).toBe(false);
  });
});
