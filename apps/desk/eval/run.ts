/**
 * Runs the pre-registered validator eval: every case through each panel validator's model, the 2-of-3 quorum
 * the vault would compute, and the negative controls through the integrity check. Writes eval/results.json.
 * usage: VENICE_API_KEY=... tsx eval/run.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { predictVault, termsToJson, type Terms } from "@proviso/sdk";
import { makeLlm } from "../src/llm.ts";
import { bundleIntegrity, judgeOnMerits } from "../src/agents/validator.ts";
import { evidenceHash } from "../src/evidence.ts";
import type { Config } from "../src/config.ts";

const dir = new URL(".", import.meta.url);
const data = JSON.parse(readFileSync(new URL("cases.json", dir), "utf8"));
const key = JSON.parse(readFileSync(new URL("answer-key.json", dir), "utf8")) as Record<string, [number, number]>;
const models = (process.env.VALIDATOR_MODELS ?? "gemini-3-8-flash,qwen-3-8-flash,z-ai-glm-5-3-flash").split(",");
const llm = makeLlm({ venice: { apiKey: process.env.VENICE_API_KEY, baseUrl: "https://api.venice.ai/api/v1", stub: false } } as Config);

const inRange = (id: string, v: number) => v >= key[id]![0] && v <= key[id]![1];
const quorum = (votes: number[]): number => {
  for (const b of [0, 25, 50, 75, 100]) if (votes.filter((v) => v === b).length >= 2) return b;
  return 0; // no quorum: the vault refunds
};

const rows: { id: string; votes: number[]; quorum: number; expected: [number, number]; validatorsCorrect: boolean[]; quorumCorrect: boolean; reasoning: string[] }[] = [];
for (const c of data.cases) {
  const spec = data.specs[c.spec];
  const out = await Promise.all(models.map((m) => judgeOnMerits(llm, m, { spec, deliverable: c.deliverable, reason: c.reason }).catch((e) => ({ bucket: -1, reasoning: `error: ${e.message}` }))));
  const votes = out.map((o) => o.bucket);
  const q = quorum(votes);
  rows.push({
    id: c.id,
    votes,
    quorum: q,
    expected: key[c.id]!,
    validatorsCorrect: votes.map((v) => inRange(c.id, v)),
    quorumCorrect: inRange(c.id, q),
    reasoning: out.map((o) => o.reasoning.slice(0, 280)),
  });
  console.log(`${c.id.padEnd(3)} votes ${votes.map((v) => String(v).padStart(3)).join(" ")}  quorum ${String(q).padStart(3)}  expected ${key[c.id]!.join("-").padEnd(7)} ${inRange(c.id, q) ? "ok" : "MISS"}`);
}

// Negative controls: a consistent bundle, then one commitment broken at a time. The model is never asked.
const terms: Terms = {
  payer: "0x9A712cb6353C84A7893b0A5Fd0702663a2032C21",
  provider: "0x61746547653766aFE7cB718935010a42710f193E",
  token: "0x054ed45810DbBAb8B27668922D110669c9D88D0a",
  amount: 50000n,
  deliverBy: 1_900_000_000n,
  challengeWindow: 120,
  courtWindow: 600,
  feeBps: 100,
  courtFeeBps: 300,
  validators: ["0x66770264c966fa2dC78c015820dfDc0098ECA1A6", "0x7c2135d26C4527EBfD253A84E4c93852a9c60090", "0x9b601ebD0be1E6D990EDBB788cFa58B20604bE2b"],
  providerAgentId: 4n,
  payerAgentId: 5n,
  specHash: "0x" as Hex,
  intentHash: keccak256(toHex("intent")),
  salt: keccak256(toHex("deal-eval")),
};
const specFile = { type: "proviso.task-spec", ...data.specs.audit };
terms.specHash = evidenceHash(specFile);
const deliveryFile = { type: "proviso.delivery", content: data.cases[0].deliverable };
const disputeFile = { type: "proviso.dispute", reason: "eval" };
const deployment = { dealFactory: getAddress("0x5102481bB8b769231Edc468A6AAe610becCA0292"), vaultImpl: getAddress("0x7B0Dd4D1bB08b15B5D34d2C2C2d9D0F3Af139125") };
const vault = predictVault({ ...deployment, terms });
const bundle = { terms: termsToJson(terms), specFile, deliveryFile, disputeFile };
const chain = { vault, predicted: vault, deliveryHash: evidenceHash(deliveryFile), reasonHash: evidenceHash(disputeFile), status: "Disputed" };
const baseline = bundleIntegrity(bundle, chain).every((c) => c.ok);
const controls = data.negativeControls.map((n: { id: string; tamper: string }) => {
  const b = structuredClone(bundle);
  const ch = { ...chain };
  if (n.tamper === "deliveryHash") b.deliveryFile = { ...b.deliveryFile, content: "{\"summary\":\"swapped\"}" };
  if (n.tamper === "reasonHash") b.disputeFile = { ...b.disputeFile, reason: "a different reason" };
  if (n.tamper === "specHash") b.specFile = { ...b.specFile, acceptance: "anything goes" };
  if (n.tamper === "vault") ch.vault = "0x000000000000000000000000000000000000dEaD" as Address;
  const failed = bundleIntegrity(b, ch).filter((c) => !c.ok).map((c) => c.check);
  const ruling = failed.length ? 0 : 100;
  console.log(`${n.id}  integrity ${failed.length ? "FAILS" : "passes"} -> ${ruling}  ${inRange(n.id, ruling) ? "ok" : "MISS"}  (${failed.join("; ")})`);
  return { id: n.id, tamper: n.tamper, failedChecks: failed, ruling, correct: inRange(n.id, ruling) };
});

const perValidator = models.map((m, i) => ({ model: m, correct: rows.filter((r) => r.validatorsCorrect[i]).length, of: rows.length }));
const summary = {
  ranAt: new Date().toISOString(),
  models,
  cases: rows.length,
  quorumCorrect: rows.filter((r) => r.quorumCorrect).length,
  perValidator,
  negativeControls: { baselinePasses: baseline, correct: controls.filter((c: { correct: boolean }) => c.correct).length, of: controls.length },
  injectionCases: rows.filter((r) => ["A6", "R1"].includes(r.id)).map((r) => ({ id: r.id, quorum: r.quorum, correct: r.quorumCorrect })),
};
console.log(JSON.stringify(summary, null, 2));
writeFileSync(new URL("results.json", dir), JSON.stringify({ summary, rows, controls }, null, 2) + "\n");
