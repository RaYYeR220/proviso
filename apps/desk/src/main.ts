import { loadConfig } from "./config.ts";
import { loadAgents, type Ctx } from "./context.ts";
import { openDb } from "./db.ts";
import { makeChain } from "./chain.ts";
import { makeLlm } from "./llm.ts";
import { Keeper } from "./keeper.ts";
import { createServer } from "./server.ts";
import { runValidator } from "./agents/validator.ts";
import { stubLlm } from "./stub.ts";

const cfg = loadConfig();
const ctx: Ctx = {
  cfg,
  db: openDb(cfg.dataDir),
  chain: makeChain(cfg),
  llm: makeLlm(cfg, stubLlm),
  agents: loadAgents(cfg.chainId),
};
const keeper = new Keeper(ctx);
const app = createServer(ctx, keeper);

app.listen(cfg.port, () => {
  console.log(`proviso desk on :${cfg.port} chain=${cfg.chainId} hsp=${cfg.hspMode} public=${cfg.publicUrl}`);
});

setInterval(() => void keeper.tick(), cfg.timing.keeperIntervalMs);
let judging = false;
setInterval(async () => {
  if (judging) return;
  judging = true;
  try {
    for (const v of cfg.validators) await runValidator(ctx, v).catch((e) => console.error(`[${v.name}]`, (e as Error).message));
  } finally {
    judging = false;
  }
}, 5000);
