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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${cfg.venice.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.venice.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            venice_parameters: { include_venice_system_prompt: false, disable_thinking: true },
            ...body,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`venice ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
      const out = await call(model, messages, {
        max_tokens: opts.maxTokens ?? 1200,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema } },
      });
      return JSON.parse(extractJson(out)) as T;
    },
  };
}

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
