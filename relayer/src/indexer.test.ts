import { describe, expect, it, vi } from "vitest";
import type { ChainClient } from "./chain.js";
import type { Store } from "./db.js";
import { Indexer } from "./indexer.js";
import type { Orchestrator } from "./orchestrator.js";

describe("Indexer", () => {
  it("respects the Coston2 RPC 30-block log range", async () => {
    let cursor = 1n;
    const ranges: Array<[bigint, bigint]> = [];
    const store = {
      getCursor: () => cursor,
      setCursor: (_name: string, value: bigint) => {
        cursor = value;
      },
    } as unknown as Store;
    const chain = {
      blockNumber: vi.fn(async () => 65n),
      events: vi.fn(async (fromBlock: bigint, toBlock: bigint) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      }),
    } as unknown as ChainClient;
    const orchestrator = {
      enqueueChain: vi.fn(),
    } as unknown as Orchestrator;

    const indexer = new Indexer(store, chain, orchestrator, 1n, 2_000, vi.fn());
    await indexer.poll();

    expect(ranges).toEqual([
      [1n, 30n],
      [31n, 60n],
      [61n, 65n],
    ]);
    expect(cursor).toBe(66n);
  });
});
