import type { Config } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Llm {
  /** Plain completion. */
  text(model: string, messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string>;
  /** Completion constrained to a JSON schema, parsed. */
  json<T>(model: string, messages: ChatMessage[], schema: Record<string, unknown>, opts?: { maxTokens?: number }): Promise<T>;
}

/** Venice (OpenAI-compatible chat completions). With LLM_STUB=1 a deterministic stub answers instead. */
export function makeLlm(cfg: Config, stub?: (model: string, messages: ChatMessage[], schema?: Record<string, unknown>) => string): Llm {
  async function call(model: string, messages: ChatMessage[], body: Record<string, unknown>): Promise<string> {
    if (cfg.venice.stub || !cfg.venice.apiKey) {
      if (!stub) throw new Error("LLM unavailable (no VENICE_API_KEY) and no stub");
      return stub(model, messages, body.response_format as Record<string, unknown> | undefined);
    }
    let lastErr: unknown;
    let disableThinking = !thinkingOnly.has(model);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${cfg.venice.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.venice.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            venice_parameters: { include_venice_system_prompt: false, ...(disableThinking ? { disable_thinking: true } : {}) },
            ...body,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) {
          const err = (await res.text()).slice(0, 300);
          // Some models only run with reasoning on; remember that and ask again without the switch.
          if (res.status === 400 && /thinking-only/i.test(err)) {
            thinkingOnly.add(model);
            disableThinking = false;
          }
          throw new Error(`venice ${res.status}: ${err}`);
        }
        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return stripThinking(data.choices[0]?.message.content ?? "");
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  return {
    text: (model, messages, opts = {}) =>
      call(model, messages, { max_tokens: opts.maxTokens ?? 1800, temperature: opts.temperature ?? 0.3 }),
    async json<T>(model: string, messages: ChatMessage[], schema: Record<string, unknown>, opts: { maxTokens?: number } = {}) {
      let maxTokens = opts.maxTokens ?? 2500;
      for (let attempt = 0; ; attempt++) {
        const out = await call(model, messages, {
          max_tokens: maxTokens,
          temperature: 0,
          response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema } },
        });
        try {
          return JSON.parse(extractJson(out)) as T;
        } catch (e) {
          // A truncated answer is retried once with more room; a second failure is an error, never a guess.
          if (attempt >= 1) throw e;
          maxTokens *= 2;
        }
      }
    },
  };
}

const thinkingOnly = new Set<string>();

function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}
