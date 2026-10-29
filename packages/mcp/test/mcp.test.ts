import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProvisoMcp } from "../src/server.ts";

describe("proviso mcp", () => {
  it("lists its tools", async () => {
    const server = createProvisoMcp({ deskUrl: "http://127.0.0.1:1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["agent_reputation", "deal_status", "find_agents", "hire", "job_status", "predict_vault", "verify_cart"].sort(),
    );
  });
});
