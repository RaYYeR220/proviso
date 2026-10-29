import { A2A_PROTOCOL_VERSION, type AgentCard } from "@a2a-js/sdk";
import { EXTENSIONS } from "@proviso/sdk";
import type { Ctx } from "../context.ts";

export interface CardInput {
  id: string;
  name: string;
  description: string;
  roles: string[];
  skills: { id: string; name: string; description: string; examples: string[] }[];
  payout?: string;
  priceUsd?: string;
}

export const a2aBase = (ctx: Ctx, id: string) => `${ctx.cfg.publicUrl}/a2a/${id}`;

/** A2A v1 AgentCard declaring the AP2 v0.1 extension (roles), the a2a-x402 extension and Proviso escrow terms. */
export function agentCard(ctx: Ctx, c: CardInput): AgentCard {
  return {
    name: c.name,
    description: c.description,
    supportedInterfaces: [{ url: a2aBase(ctx, c.id), protocolBinding: "JSONRPC", tenant: "", protocolVersion: A2A_PROTOCOL_VERSION }],
    provider: { organization: "Proviso", url: ctx.cfg.publicUrl },
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        { uri: EXTENSIONS.ap2, description: "AP2 mandates over A2A", required: true, params: { roles: c.roles } },
        { uri: EXTENSIONS.x402, description: "x402 v2 payment payloads inside AP2 mandates (HSP)", required: false, params: {} },
        {
          uri: EXTENSIONS.proviso,
          description: "Escrowed settlement: the cart's pay_to is a vault derived from the deal terms",
          required: false,
          params: {
            chainId: ctx.cfg.chainId,
            dealFactory: ctx.cfg.deployment.dealFactory,
            identityRegistry: ctx.cfg.deployment.identityRegistry,
            agentId: ctx.agents[c.id]?.agentId ?? null,
            merchantOfRecord: { name: ctx.cfg.hsp.merchantName, publicKeyPem: ctx.cfg.hsp.merchantPublicKeyPem },
            priceUsd: c.priceUsd ?? null,
          },
        },
      ],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/markdown"],
    skills: c.skills.map((s) => ({ ...s, tags: ["proviso", "ap2"], inputModes: [], outputModes: [], securityRequirements: [] })),
    documentationUrl: `${ctx.cfg.publicUrl}/docs`,
    signatures: [],
    iconUrl: "",
  } as AgentCard;
}

/** ERC-8004 registration file (the agentURI target) for a hosted agent. */
export function registrationFile(ctx: Ctx, c: CardInput) {
  const reg = ctx.agents[c.id];
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: c.name,
    description: c.description,
    image: `${ctx.cfg.publicUrl}/agents/${c.id}.svg`,
    services: [
      { name: "A2A", endpoint: `${a2aBase(ctx, c.id)}/.well-known/agent-card.json`, version: "1.0" },
      { name: "MCP", endpoint: `${ctx.cfg.publicUrl}/mcp`, version: "2025-06-18" },
      { name: "web", endpoint: `${ctx.cfg.publicUrl}/agents/${c.id}` },
    ],
    x402Support: true,
    active: true,
    registrations: reg ? [{ agentId: Number(reg.agentId), agentRegistry: `eip155:${ctx.cfg.chainId}:${ctx.cfg.deployment.identityRegistry}` }] : [],
    supportedTrust: ["reputation", "validation"],
    proviso: { roles: c.roles, payout: c.payout ?? null, priceUsd: c.priceUsd ?? null, skills: c.skills.map((s) => s.id) },
  };
}
