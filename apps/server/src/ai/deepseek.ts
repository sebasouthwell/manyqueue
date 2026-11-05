import { AI_MAX_TOKENS, AI_TIMEOUT_MS } from "@manyqueue/shared";

/** Where AI calls are logged (index.ts hands over the Fastify/pino logger). */
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
}

/** The feature is optional: without a key the nickname UI and calls switch themselves off. */
export function isAiConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY?.trim();
}

// DeepSeek speaks OpenAI's chat-completions format. Base URL and model can be overridden (tests point
// the base URL at a local fake).
const baseUrl = () => (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
const model = () => process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

export interface AiCallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiError";
  }
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * One JSON-mode chat call. 15s timeout, and one retry after a timeout, a network error, a 429 or a 5xx.
 * Every attempt's token use is logged. The caller decides what a failure means (nicknames just give up
 * quietly and keep whatever the guest had).
 */
export async function aiJsonCall(params: {
  system: string;
  user: string;
  purpose: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<AiCallResult> {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) throw new AiError("no DEEPSEEK_API_KEY");

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(params.timeoutMs ?? AI_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: model(),
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
          response_format: { type: "json_object" },
          max_tokens: params.maxTokens ?? AI_MAX_TOKENS,
          temperature: 1.1,
        }),
      });
      if (res.status === 429 || res.status >= 500) throw new AiError(`AI service answered ${res.status}`, res.status);
      if (!res.ok) throw new AiError(`AI request refused (${res.status})`, res.status); // won't improve on retry
      const data = (await res.json()) as ChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new AiError("AI reply was empty");
      const result = { content, promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 };
      logger.info({ purpose: params.purpose, attempt, model: model(), promptTokens: result.promptTokens, completionTokens: result.completionTokens }, "AI call");
      return result;
    } catch (err) {
      lastError = err;
      const retryable = !(err instanceof AiError) || err.status === undefined || err.status === 429 || err.status >= 500;
      logger.warn({ purpose: params.purpose, attempt, error: (err as Error).message, retrying: retryable && attempt < 2 }, "AI call failed");
      if (!retryable) break;
    }
  }
  throw lastError instanceof AiError ? lastError : new AiError((lastError as Error)?.message ?? "AI call failed");
}
