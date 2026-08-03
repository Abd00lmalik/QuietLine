import { describe, expect, it } from "vitest";
import { Store } from "./db.js";

const account = "0x1111111111111111111111111111111111111111";

describe("Store", () => {
  it("consumes authentication challenges exactly once", () => {
    const store = new Store(":memory:");
    store.putChallenge(account, "nonce", 200);
    expect(store.consumeChallenge(account, "nonce", 100)).toBe(true);
    expect(store.consumeChallenge(account, "nonce", 100)).toBe(false);
    store.close();
  });

  it("deduplicates chain jobs by external key", () => {
    const store = new Store(":memory:");
    const first = store.createJob("DEPOSIT", account, { one: true }, "chain:0x01");
    const duplicate = store.createJob("DEPOSIT", account, { two: true }, "chain:0x01");
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.payload).toEqual({ one: true });
    store.close();
  });

  it("persists job transitions and only retries failures", () => {
    const store = new Store(":memory:");
    const job = store.createJob("ACCOUNT_QUERY", account, {});
    expect(() => store.resetForRetry(job.id)).toThrow("only failed jobs");
    store.updateJob(job.id, { status: "failed", error: "temporary failure" });
    const retried = store.resetForRetry(job.id);
    expect(retried.status).toBe("queued");
    expect(retried.error).toBeUndefined();
    store.close();
  });
});
