import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGatewayHeaders,
  getHealth,
  waitForChainJob,
  waitForJob,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayer job polling", () => {
  it("returns a confirmed confidential job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-1",
            type: "ACCOUNT_QUERY",
            status: "confirmed",
            account: "0x1111111111111111111111111111111111111111",
            attempts: 1,
            createdAt: 1,
            updatedAt: 2,
            response: { ciphertext: "0x1234" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(waitForJob("job-1", "session", 100)).resolves.toMatchObject({
      status: "confirmed",
      response: { ciphertext: "0x1234" },
    });
  });

  it("surfaces the confidential engine failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-2",
            type: "SET_MANDATE",
            status: "failed",
            account: "0x1111111111111111111111111111111111111111",
            attempts: 1,
            createdAt: 1,
            updatedAt: 2,
            error: "insufficient private balance",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(waitForJob("job-2", "session", 100)).rejects.toThrow(
      "insufficient private balance",
    );
  });

  it("correlates a chain job by the emitted request id", async () => {
    const requestId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = String(input);
        const body = path.includes("/jobs/job-chain")
          ? {
              id: "job-chain",
              externalKey: `chain:${requestId}`,
              type: "DEPOSIT",
              status: "confirmed",
              account: "0x1111111111111111111111111111111111111111",
              attempts: 1,
              createdAt: 1,
              updatedAt: 2,
            }
          : [
              {
                id: "job-chain",
                externalKey: `chain:${requestId}`,
                type: "DEPOSIT",
                status: "confirmed",
                account: "0x1111111111111111111111111111111111111111",
                attempts: 1,
                createdAt: 1,
                updatedAt: 2,
              },
            ];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    await expect(waitForChainJob(requestId, "session", 100)).resolves.toMatchObject({
      id: "job-chain",
      externalKey: `chain:${requestId}`,
    });
  });
});

describe("relayer response validation", () => {
  it("bypasses the ngrok browser warning for the public relayer gateway", () => {
    expect(
      getGatewayHeaders("https://speculate-ipod-harmful.ngrok-free.dev/api"),
    ).toEqual({ "ngrok-skip-browser-warning": "quietline" });
    expect(getGatewayHeaders("https://relayer.quietline.app/api")).toEqual({});
  });

  it("classifies a same-origin SPA response as missing relayer infrastructure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>Quietline</title>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    await expect(getHealth()).rejects.toThrow(
      "Quietline received an invalid response from the configured relayer.",
    );
  });

  it("preserves a JSON API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "FCC is not reachable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(getHealth()).rejects.toThrow("FCC is not reachable");
  });
});
