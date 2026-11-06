import { aiJsonCall as deepseekJsonCall, setAiLogger as setDeepseekLogger, type AiCallResult } from "./deepseek.js";
import { claudeJsonCall } from "./claude.js";

export { AiError, type AiCallResult } from "./deepseek.js";

/**
 * Which AI service the party features use (nicknames, genre tags):
 * - `AI_PROVIDER=anthropic|claude|deepseek` picks one, if its key is set;
 * - otherwise Claude when `ANTHROPIC_API_KEY` is set, else DeepSeek when `DEEPSEEK_API_KEY` is set;
 * - with neither, the AI features switch themselves off (no AI nicknames or genre tags).
 */
export type AiProvider = "anthropic" | "deepseek";

export function aiProvider(): AiProvider | null {
  const has = {
    anthropic: !!process.env.ANTHROPIC_API_KEY?.trim(),
    deepseek: !!process.env.DEEPSEEK_API_KEY?.trim(),
  };
  const pref = process.env.AI_PROVIDER?.trim().toLowerCase();
  const wanted: AiProvider | null = pref === "anthropic" || pref === "claude" ? "anthropic" : pref === "deepseek" ? "deepseek" : null;
  if (wanted && has[wanted]) return wanted;
  if (has.anthropic) return "anthropic";
  if (has.deepseek) return "deepseek";
  return null;
}

export function isAiConfigured(): boolean {
  return aiProvider() !== null;
}

interface AiLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}
let logger: AiLogger = {
  info: (obj, msg) => console.info(`[ai] ${msg ?? ""}`, JSON.stringify(obj)),
  warn: (obj, msg) => console.warn(`[ai] ${msg ?? ""}`, JSON.stringify(obj)),
};
export function setAiLogger(l: AiLogger): void {
  logger = l;
  setDeepseekLogger(l);
}

/** One JSON reply from whichever provider is active (see aiProvider). */
export async function aiJsonCall(params: {
  system: string;
  user: string;
  purpose: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<AiCallResult> {
  const provider = aiProvider();
  if (provider === "anthropic") {
    try {
      return await claudeJsonCall(params, (obj, msg) => logger.info(obj, msg));
    } catch (err) {
      logger.warn({ purpose: params.purpose, provider, error: (err as Error).message }, "AI call failed");
      throw err;
    }
  }
  return deepseekJsonCall(params);
}
