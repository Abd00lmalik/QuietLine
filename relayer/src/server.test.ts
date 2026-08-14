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
  TEE_MANAGER: "0x5555555555555555555555555555555555555555",
  EXTENSION_ID: 65_536,
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

describe("public configuration", () => {
  let store: Store;

  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    process.env.FRONTEND_ORIGIN = "https://quietline.vercel.app";
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
    delete process.env.LOG_LEVEL;
    delete process.env.FRONTEND_ORIGIN;
  });

  it("returns JSON-safe frontend configuration", async () => {
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: {} as never,
      orchestrator: {} as never,
      chain: {} as never,
    });

    const response = await app.inject({ method: "GET", url: "/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      network: { id: 114, name: "Coston2" },
      vault,
      policy: { termsDays: [7, 14, 30], quoteValiditySeconds: 300 },
    });
    await app.close();
  });

  it("allows the ngrok warning bypass header during browser preflight", async () => {
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: {} as never,
      orchestrator: {} as never,
      chain: {} as never,
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://quietline.vercel.app",
        "access-control-request-headers":
          "content-type, ngrok-skip-browser-warning",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://quietline.vercel.app",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "ngrok-skip-browser-warning",
    );
    await app.close();
  });

  it("reports a healthy FCC path only when the live and vault signers match", async () => {
    const signer = "0x3333333333333333333333333333333333333333";
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: { machineSigner: async () => signer } as never,
      orchestrator: {} as never,
      chain: {
        activeTeeSigner: async () => signer,
        fccMachineState: async () => ({
          active: [{ teeId: signer, status: 2 }],
        }),
      } as never,
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      services: { fcc: "ok" },
    });
    await app.close();
  });

  it("pauses confidential mutations when the live FCC signer changed", async () => {
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: {
        machineSigner: async () =>
          "0x3333333333333333333333333333333333333333",
      } as never,
      orchestrator: {} as never,
      chain: {
        activeTeeSigner: async () =>
          "0x4444444444444444444444444444444444444444",
        fccMachineState: async () => ({
          active: [{
            teeId: "0x4444444444444444444444444444444444444444",
            status: 2,
          }],
        }),
      } as never,
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "degraded",
      services: { fcc: "signer_mismatch" },
    });
    expect(response.json().detail).toContain("signer mismatch");
    await app.close();
  });

  it("pauses confidential mutations when duplicate production machines exist", async () => {
    const signer = "0x3333333333333333333333333333333333333333";
    const app = buildServer({
      config,
      store,
      auth: {} as never,
      fcc: { machineSigner: async () => signer } as never,
      orchestrator: {} as never,
      chain: {
        activeTeeSigner: async () => signer,
        fccMachineState: async () => ({
          active: [
            { teeId: signer, status: 2 },
            {
              teeId: "0x4444444444444444444444444444444444444444",
              status: 2,
            },
          ],
        }),
      } as never,
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.json()).toMatchObject({
      status: "degraded",
      services: { fcc: "signer_mismatch" },
      fccMachine: { activeCount: 2 },
    });
    expect(response.json().detail).toContain("exactly one production machine");
    await app.close();
  });
});

describe("mandate-scoped withdrawal route", () => {
  let store: Store;

  beforeEach(() => {
    process.env.LOG_LEVEL = "silent";
    store = new Store(":memory:");
  });

  afterEach(() => {
    store.close();
    delete process.env.LOG_LEVEL;
  });

  it("accepts the WITHDRAW_FROM_MANDATE command on /direct/mandate", async () => {
    const enqueued: unknown[] = [];
    const signer = "0x3333333333333333333333333333333333333333";
    const app = buildServer({
      config,
      store,
      auth: {
        verify: () => ({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600 }),
      } as never,
      fcc: { machineSigner: async () => signer } as never,
      orchestrator: {
        enqueueDirect: (address: string, command: string, ciphertext: string) => {
          enqueued.push({ address, command, ciphertext });
          return { id: "job-1" };
        },
      } as never,
      chain: {
        activeTeeSigner: async () => signer,
        fccMachineState: async () => ({
          active: [{ teeId: signer, status: 2 }],
        }),
      } as never,
    });
    const response = await app.inject({
      method: "POST",
      url: "/direct/mandate",
      headers: { authorization: "Bearer session-token" },
      payload: {
        account,
        command: "WITHDRAW_FROM_MANDATE",
        ciphertext: "0xabcd",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(enqueued).toEqual([
      { address: account, command: "WITHDRAW_FROM_MANDATE", ciphertext: "0xabcd" },
    ]);
    await app.close();
  });
});
