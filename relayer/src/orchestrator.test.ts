import { stringToHex, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { Anchor, ChainClient } from "./chain.js";
import { Store } from "./db.js";
import type { FccClient } from "./fcc.js";
import { Orchestrator } from "./orchestrator.js";

const account = "0x1111111111111111111111111111111111111111" as Address;
const actionId = `0x${"a".repeat(64)}` as Hex;
const confirmationId = `0x${"b".repeat(64)}` as Hex;
const txHash = `0x${"c".repeat(64)}` as Hex;
const recoveryId = `0x${"1".repeat(64)}` as Hex;

const anchor: Anchor = {
  settlement: {
    protocolVersion: 2,
    settlementType: 2,
    account,
    token: "0x0000000000000000000000000000000000000000",
    amount: "0",
    destination: "0x0000000000000000000000000000000000000000",
    requestId: actionId,
    settlementId: `0x${"d".repeat(64)}`,
    previousSequence: 0,
    nextSequence: 1,
    previousRoot: `0x${"0".repeat(64)}`,
    nextRoot: `0x${"e".repeat(64)}`,
    deadline: 2_000_000_000,
  },
  signature: `0x${"f".repeat(130)}`,
};

describe("Orchestrator", () => {
  it("settles and confirms a mutating direct action", async () => {
    const store = new Store(":memory:");
    const fcc = {
      submitCiphertext: vi.fn().mockResolvedValue(actionId),
      submitJson: vi.fn().mockResolvedValue(confirmationId),
      poll: vi
        .fn()
        .mockResolvedValueOnce({
          result: {
            status: 1,
            log: "ok",
            data: stringToHex(JSON.stringify({ anchor, ciphertext: "0x1234" })),
          },
        })
        .mockResolvedValueOnce({ result: { status: 1, log: "ok" } }),
      decode: vi.fn((data: Hex) => JSON.parse(Buffer.from(data.slice(2), "hex").toString())),
    };
    const chain = { execute: vi.fn().mockResolvedValue(txHash) };
    const orchestrator = new Orchestrator(
      store,
      fcc as unknown as FccClient,
      chain as unknown as ChainClient,
    );

    const job = orchestrator.enqueueDirect(account, "OPEN_ACCOUNT", "0xdeadbeef");
    await orchestrator.idle();
    const completed = store.getJob(job.id);

    expect(completed?.status).toBe("confirmed");
    expect(completed?.txHash).toBe(txHash);
    expect(chain.execute).toHaveBeenCalledWith(anchor);
    expect(fcc.submitJson).toHaveBeenCalledWith("ANCHOR_CONFIRMED", {
      sequence: 1,
      root: anchor.settlement.nextRoot,
    });
    store.close();
  });

  it("records an FCC failure without submitting a settlement", async () => {
    const store = new Store(":memory:");
    const fcc = {
      submitCiphertext: vi.fn().mockResolvedValue(actionId),
      poll: vi.fn().mockResolvedValue({
        result: { status: 0, log: "error: account nonce mismatch" },
      }),
    };
    const chain = { execute: vi.fn() };
    const orchestrator = new Orchestrator(
      store,
      fcc as unknown as FccClient,
      chain as unknown as ChainClient,
    );

    const job = orchestrator.enqueueDirect(account, "SET_MANDATE", "0xdeadbeef");
    await orchestrator.idle();
    const failed = store.getJob(job.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("nonce mismatch");
    expect(chain.execute).not.toHaveBeenCalled();
    store.close();
  });

  it("recovers a prior checkpoint when FCC reports a pending anchor", async () => {
    const store = new Store(":memory:");
    const fcc = {
      submitJson: vi
        .fn()
        .mockResolvedValueOnce(recoveryId)
        .mockResolvedValueOnce(confirmationId),
      poll: vi
        .fn()
        .mockResolvedValueOnce({
          result: {
            status: 0,
            log: "error: previous confidential mutation is awaiting on-chain anchor",
          },
        })
        .mockResolvedValueOnce({
          result: {
            status: 1,
            log: "ok",
            data: stringToHex(JSON.stringify(anchor)),
          },
        })
        .mockResolvedValueOnce({ result: { status: 1, log: "ok" } }),
      decode: vi.fn((data: Hex) => JSON.parse(Buffer.from(data.slice(2), "hex").toString())),
    };
    const chain = {
      anchorState: vi.fn().mockResolvedValue({
        sequence: anchor.settlement.previousSequence,
        root: anchor.settlement.previousRoot,
      }),
      execute: vi.fn().mockResolvedValue(txHash),
    };
    const orchestrator = new Orchestrator(
      store,
      fcc as unknown as FccClient,
      chain as unknown as ChainClient,
    );

    const job = orchestrator.enqueueChain(
      account,
      "RISK_TICK",
      actionId,
      123n,
      `chain:${actionId}`,
    );
    await orchestrator.idle();
    const completed = store.getJob(job.id);

    expect(completed?.status).toBe("failed");
    expect(completed?.error).toContain("checkpoint was recovered");
    expect(fcc.submitJson).toHaveBeenNthCalledWith(1, "RECOVER_ANCHOR", {});
    expect(chain.execute).toHaveBeenCalledWith(anchor);
    expect(fcc.submitJson).toHaveBeenNthCalledWith(2, "ANCHOR_CONFIRMED", {
      sequence: anchor.settlement.nextSequence,
      root: anchor.settlement.nextRoot,
    });
    store.close();
  });

  it("confirms a recovered checkpoint that is already settled on-chain", async () => {
    const store = new Store(":memory:");
    const fcc = {
      submitJson: vi
        .fn()
        .mockResolvedValueOnce(recoveryId)
        .mockResolvedValueOnce(confirmationId),
      poll: vi
        .fn()
        .mockResolvedValueOnce({
          result: {
            status: 0,
            log: "error: previous confidential mutation is awaiting on-chain anchor",
          },
        })
        .mockResolvedValueOnce({
          result: {
            status: 1,
            log: "ok",
            data: stringToHex(JSON.stringify(anchor)),
          },
        })
        .mockResolvedValueOnce({ result: { status: 1, log: "ok" } }),
      decode: vi.fn((data: Hex) => JSON.parse(Buffer.from(data.slice(2), "hex").toString())),
    };
    const chain = {
      anchorState: vi.fn().mockResolvedValue({
        sequence: anchor.settlement.nextSequence,
        root: anchor.settlement.nextRoot,
      }),
      execute: vi.fn(),
    };
    const orchestrator = new Orchestrator(
      store,
      fcc as unknown as FccClient,
      chain as unknown as ChainClient,
    );

    const job = orchestrator.enqueueChain(
      account,
      "RISK_TICK",
      actionId,
      123n,
      `chain:${actionId}`,
    );
    await orchestrator.idle();

    expect(store.getJob(job.id)?.error).toContain("checkpoint was recovered");
    expect(chain.execute).not.toHaveBeenCalled();
    expect(fcc.submitJson).toHaveBeenNthCalledWith(2, "ANCHOR_CONFIRMED", {
      sequence: anchor.settlement.nextSequence,
      root: anchor.settlement.nextRoot,
    });
    store.close();
  });
});
