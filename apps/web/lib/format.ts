export const HSP_RELAYER = "0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea";

export function explorerBase(chainId: number): string | null {
  if (chainId === 177) return "https://hsk.blockscout.com";
  if (chainId === 133) return "https://testnet-explorer.hskchain.net";
  return null;
}

export function txUrl(chainId: number, tx: string): string | null {
  const b = explorerBase(chainId);
  return b ? `${b}/tx/${tx}` : null;
}

export function addressUrl(chainId: number, a: string): string | null {
  const b = explorerBase(chainId);
  return b ? `${b}/address/${a}` : null;
}

export const short = (s?: string | null, n = 6) => (!s ? "" : s.length <= 2 * n + 2 ? s : `${s.slice(0, n + 2)}…${s.slice(-n)}`);

export function usd(baseUnits: string | number | bigint | undefined | null, decimals = 6): string {
  if (baseUnits === undefined || baseUnits === null) return "";
  const v = Number(BigInt(baseUnits)) / 10 ** decimals;
  return `$${v.toFixed(v < 1 ? 3 : 2)}`;
}

export function ago(tsMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const RAIL_LABEL: Record<string, string> = {
  "hsp-gateway": "HSP gateway",
  "self-relay": "Self-relayed",
  direct: "Direct transfer",
};

export const STAGE_LABEL: Record<string, string> = {
  "awaiting-payment": "Awaiting payment",
  funded: "Funded",
  delivered: "Delivered",
  disputed: "In court",
  released: "Released",
  refunded: "Refunded",
  resolved: "Ruled",
  settled: "Settled",
  "expired-unpaid": "Never paid",
};

/** Human copy for each timeline event the desk records. */
export function describe(kind: string, d: Record<string, any> | null): { title: string; body?: string; tone?: "ok" | "warn" | "bad" | "muted" } {
  const x = d ?? {};
  switch (kind) {
    case "intent-signed":
      return { title: "User signed the intent mandate", body: `Refunds required. Caps: ${usd(x.maxPerDeal)} per deal, ${usd(x.budgetTotal)} in total, provider reputation ≥ ${x.minProviderReputation ?? 40}.` };
    case "a2a-request":
      return { title: `Asked the ${x.provider} agent over A2A`, body: `Skill: ${x.skill}` };
    case "cart-issued":
      return { title: "Proviso issued the Cart Mandate", body: `pay_to is the escrow, not the provider's wallet. Rail: ${RAIL_LABEL[x.rail] ?? x.rail}.`, tone: "muted" };
    case "cart-received":
      return { title: `Cart received from ${x.merchant}`, body: `${x.total?.value ?? ""} ${x.total?.currency ?? ""} to ${short(x.payTo)}` };
    case "tampered-in-transit":
      return { title: "Cart tampered in transit", body: `pay_to swapped to ${short(x.payTo)}`, tone: "warn" };
    case "refused":
      return { title: `Refused: ${x.code}`, body: `${x.detail}. Nothing was signed; no money moved.`, tone: "bad" };
    case "cart-verified":
      return { title: "Cart verified", body: `pay_to = escrow derived from the terms. Provider settles at ${x.providerReputation?.average ?? 0}/100 over ${x.providerReputation?.count ?? 0} deals.`, tone: "ok" };
    case "payment-mandate-signed":
      return { title: "Payment Mandate signed", body: x.protocol === "eip3009" ? "EIP-3009 authorization whose recipient is the escrow" : "Permit2 authorization" };
    case "hsp-submitted":
      return { title: "Submitted to the HSP gateway", body: x.status ? `Gateway status: ${x.status}` : undefined };
    case "payment-relayed":
      return { title: "Payment relayed", body: "Self-relay rail: the same authorization, broadcast by Proviso", tone: "muted" };
    case "hsp-status":
      return { title: `HSP: ${x.status}` };
    case "funded":
      return { title: `Escrow funded ${usd(x.amount)}`, body: `Funding tx sent by ${x.sender?.toLowerCase() === HSP_RELAYER.toLowerCase() ? "the HSP gateway relayer" : short(x.sender)} (${RAIL_LABEL[x.rail] ?? x.rail})`, tone: "ok" };
    case "vault-opened":
      return { title: "Vault deployed at its predicted address", tone: "muted" };
    case "quote-confirmed":
      return { title: "Provider signed the quote", body: "EIP-712 acknowledgement of these exact terms; only now can the deal affect its reputation", tone: "muted" };
    case "payment-mandate-received":
      return { title: "Provider received the Payment Mandate", tone: "muted" };
    case "provider-silent":
      return { title: "Provider went silent", tone: "warn" };
    case "delivered":
      return { title: "Deliverable committed on chain", body: `hash ${short(x.deliveryHash, 8)}` };
    case "acceptance-checked":
      return { title: x.accept ? `Acceptance check passed (${x.score}/100)` : `Acceptance check failed (${x.score}/100)`, body: (x.reasons ?? []).slice(0, 2).join(" · "), tone: x.accept ? "ok" : "bad" };
    case "accepted":
      return { title: "Accepted: escrow released to the provider", tone: "ok" };
    case "disputed":
      return { title: "Disputed", body: (x.reasons ?? []).slice(0, 2).join(" · "), tone: "warn" };
    case "court-bundle":
      return { title: "Evidence bundle assembled", body: "Every file hash-committed on chain", tone: "muted" };
    case "validation-requested":
      return { title: `Validation requested from validator ${["A", "B", "C"][x.index] ?? x.index}`, tone: "muted" };
    case "validator-voted":
      return { title: `${x.validator} (${x.model}) voted ${x.bucket}%`, body: x.reasoning };
    case "resolved":
      return { title: `Court ruled: provider gets ${x.bucket}%`, body: `Majority: ${(x.majority ?? []).map((i: number) => ["A", "B", "C"][i]).join(", ")}`, tone: x.bucket === 0 ? "warn" : "ok" };
    case "finalized":
      return { title: x.from === "Delivered" ? "Challenge window ended: released" : x.from === "Disputed" ? "No quorum: refunded" : "Deadline passed: refunded", tone: x.from === "Delivered" ? "ok" : "warn" };
    case "no-delivery":
      return { title: "No delivery", body: "The escrow refunds after the deadline", tone: "warn" };
    case "reputation-written":
      return { title: "Settlement-backed reputation written (ERC-8004)", body: `Outcome: ${x.outcome?.status}${x.outcome?.providerSharePct !== undefined ? `, provider ${x.outcome.providerSharePct}%` : ""}`, tone: "ok" };
    case "expired-unpaid":
      return { title: "Cart expired unpaid", body: "No money was ever sent", tone: "muted" };
    case "job-finished":
      return { title: `Job ${x.status}`, tone: "muted" };
    case "job-error":
    case "keeper-error":
      return { title: kind === "job-error" ? "Job error" : "Keeper retrying", body: x.message, tone: "bad" };
    default:
      return { title: kind };
  }
}
