import { resolve } from "node:path";
import type { Address } from "viem";
import { Auth } from "./auth.js";
import { ChainClient } from "./chain.js";
import { loadConfig } from "./config.js";
import { Store } from "./db.js";
import { FccClient } from "./fcc.js";
import { Indexer } from "./indexer.js";
import { RiskKeeper } from "./keeper.js";
import { Orchestrator } from "./orchestrator.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const databasePath = resolve(process.cwd(), config.DATABASE_PATH);
const store = new Store(databasePath);
const fcc = new FccClient(config.FCC_PROXY_URL, config.DIRECT_API_KEY);
const chain = new ChainClient(config);
const auth = new Auth(store, config.SESSION_SECRET, config.QUIET_VAULT as Address);
const orchestrator = new Orchestrator(store, fcc, chain);
const app = buildServer({ config, store, auth, fcc, orchestrator, chain });
const indexer = new Indexer(
  store,
  chain,
  orchestrator,
  config.START_BLOCK,
  config.POLL_INTERVAL_MS,
  (error) => app.log.error({ error }, "vault indexer poll failed"),
);
const keeper = new RiskKeeper(
  chain,
  config.RISK_TICK_INTERVAL_MS,
  (error) => app.log.error({ error }, "risk keeper tick failed"),
);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutting down");
  keeper.stop();
  indexer.stop();
  await app.close();
  store.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(
  {
    address: `http://${config.HOST}:${config.PORT}`,
    vault: config.QUIET_VAULT,
  },
  "Quietline relayer listening",
);
orchestrator.wake();
indexer.start();
keeper.start();
