#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProvisoMcp } from "./server.ts";

const deskUrl = process.env.PROVISO_DESK_URL ?? "http://127.0.0.1:8788";
await createProvisoMcp({ deskUrl }).connect(new StdioServerTransport());
