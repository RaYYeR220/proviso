import type { ChatMessage } from "./llm.ts";

/**
 * Deterministic stand-in for the language model, used by tests and by local runs without an API key
 * (LLM_STUB=1). It never decides money on its own: every gate it feeds also has a deterministic floor.
 */
export function stubLlm(_model: string, messages: ChatMessage[], format?: Record<string, unknown>): string {
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const schemaName = JSON.stringify(format ?? {});
  const filler = /lorem ipsum/i.test(user);

  if (schemaName.includes('"bucket"')) {
    return JSON.stringify({ bucket: filler ? 0 : 100, reasoning: filler ? "The deliverable is filler and does not address the task." : "The deliverable meets the task." });
  }
  if (schemaName.includes('"score"')) {
    return JSON.stringify({ score: filler ? 10 : 85, reasons: [filler ? "filler content" : "meets the acceptance criterion"] });
  }
  if (schemaName.includes('"findings"')) {
    return JSON.stringify({
      summary: "TipJar.withdraw sends ETH before updating the balance, so a caller can re-enter and drain the contract; sweep() has no access control.",
      findings: [
        { severity: "critical", title: "Reentrancy in withdraw", location: "TipJar.withdraw", detail: "External call precedes the balance update.", recommendation: "Update the balance before the call or use a reentrancy guard." },
        { severity: "high", title: "Unprotected sweep", location: "TipJar.sweep", detail: "Anyone can move the whole balance.", recommendation: "Restrict sweep to an owner." },
      ],
    });
  }
  if (/Hindi/i.test(sys)) return "TipJar.withdraw में reentrancy की गंभीर समस्या है: बैलेंस अपडेट से पहले ETH भेजा जाता है। sweep() पर कोई access control नहीं है।";
  if (/market analyst/i.test(sys)) return "## HSK/USDT\n\nPool price 0.0880 USD, oracle 0.0878 USD, deviation 23 bps. Reserves 5,000,000 HSK / 440,000 USDT. Oracle updated 4 hours ago.";
  return "ok";
}
