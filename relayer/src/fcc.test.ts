import { createServer } from "node:http";
import { hexToString, stringToHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { FccClient } from "./fcc.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("FccClient", () => {
  it("forwards ciphertext without JSON wrapping and decodes result data", async () => {
    let directBody: Record<string, string> | undefined;
    let polls = 0;
    const server = createServer((request, response) => {
      if (request.url === "/direct") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          directBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            string
          >;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: { id: `0x${"1".repeat(64)}` } }));
        });
        return;
      }
      polls++;
      if (polls === 1) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          result: {
            status: 1,
            log: "ok",
            data: stringToHex(JSON.stringify({ private: true })),
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");

    const client = new FccClient(
      `http://127.0.0.1:${address.port}`,
      "direct-api-key-that-is-at-least-32-bytes",
    );
    const ciphertext = "0xdeadbeef";
    const actionId = await client.submitCiphertext("ACCOUNT_QUERY", ciphertext);
    const result = await client.poll(actionId);

    expect(directBody?.message).toBe(ciphertext);
    expect(hexToString(directBody?.opCommand as `0x${string}`, { size: 32 })).toContain(
      "ACCOUNT_QUERY",
    );
    expect(client.decode(result.result.data)).toEqual({ private: true });
  });
});
