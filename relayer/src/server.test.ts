import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { buildServer } from "./server.js";

const account = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const operationsKey = "operations-key-that-is-at-least-32-bytes";

const config: Config = {
  PORT: 8787,
  HOST: "127.0.0.1",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "session-secret-that-is-at-least-32-bytes",
  OPERATIONS_API_KEY: operationsKey,
  FCC_PROXY_URL: "https://fcc.example",
  DIRECT_API_KEY: "direct-api-key-that-is-at-least-32-bytes",
  COSTON2_RPC_URL: "https://coston2-api.flare.network/ext/C/rpc",
  QUIET_VAULT: vault,
  RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  START_BLOCK: 1n,
  POLL_INTERVAL_MS: 2_000,
  RISK_TICK_INTERVAL_MS: 60_000,
  FCC_INSTRUCTION_FEE_WEI: 1_000_000n,
};

describe("operations job lookup", () => {
  let store: Store;

  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
    delete process.env.LOG_LEVEL;
  });

  it("rejects an incorrect operations key", async () => {
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: {} as never,
      orchestrator: {} as never,
      chain: {} as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/operations/job?externalKey=chain%3A0x01",
      headers: { "x-quietline-operations-key": `${operationsKey}-wrong` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "operations_auth_required" });
    await app.close();
  });

  it("returns only the job matching the exact external key", async () => {
    const expected = store.createJob("BACKSTOP_DEPOSIT", account, {}, "chain:0x01");
    store.createJob("BACKSTOP_DEPOSIT", account, {}, "chain:0x0100");
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: {} as never,
      orchestrator: {} as never,
      chain: {} as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/operations/job?externalKey=chain%3A0x01",
      headers: { "x-quietline-operations-key": operationsKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: expected.id,
      externalKey: "chain:0x01",
      type: "BACKSTOP_DEPOSIT",
    });
    await app.close();
  });
});
