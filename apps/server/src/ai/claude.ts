import Anthropic from "@anthropic-ai/sdk";
import { AI_MAX_TOKENS } from "@manyqueue/shared";
import { AiError, type AiCallResult } from "./deepseek.js";

/** Claude's model for the party features; ANTHROPIC_MODEL overrides it. */
const model = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";

let client: Anthropic | null = null;
let clientKey: string | null = null;
function getClient(key: string): Anthropic {
  if (!client || clientKey !== key) {
    // One SDK retry on 429/5xx/connection errors, the same budget as the DeepSeek path's own retry.
    client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 45_000 });
    clientKey = key;
  }
  return client;
}

/** A reply that came wrapped in a code fence still parses. */
function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text.trim();
}

/**
 * One JSON reply from Claude, for the same short party tasks as DeepSeek (nicknames, genre tags). Low
 * effort: these are quick, playful calls. Refusals fall back server-side ("default" fallbacks); a
 * refusal that still stands, an empty reply or an API error is an AiError, and the caller gives up
 * quietly as it does for DeepSeek.
 */
export async function claudeJsonCall(
  params: { system: string; user: string; purpose: string; maxTokens?: number },
  log: (obj: object, msg: string) => void,
): Promise<AiCallResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiError("no ANTHROPIC_API_KEY");
  try {
    const response = await getClient(key).beta.messages.create({
      model: model(),
      // Thinking is on for this model: leave room for it on top of the short JSON answer.
      max_tokens: Math.max(params.maxTokens ?? AI_MAX_TOKENS, 4_000),
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `${params.system}\n\nReply with a single JSON object only: no prose, no code fences.`,
      messages: [{ role: "user", content: params.user }],
    });
    if (response.stop_reason === "refusal") throw new AiError("Claude declined the request");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) throw new AiError("AI reply was empty");
    const result = {
      content: stripFence(text),
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };
    log({ purpose: params.purpose, provider: "anthropic", model: response.model, ...result, content: undefined }, "AI call");
    return result;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude API error ${err.status ?? ""}: ${err.message}`, err.status ?? undefined);
    throw new AiError((err as Error)?.message ?? "AI call failed");
  }
}
