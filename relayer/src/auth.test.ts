import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { Auth } from "./auth.js";
import { Store } from "./db.js";

const privateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const vault = "0x2222222222222222222222222222222222222222";

describe("Auth", () => {
  it("verifies a wallet challenge and issues a bounded session", async () => {
    const store = new Store(":memory:");
    const account = privateKeyToAccount(privateKey);
    const auth = new Auth(store, "a".repeat(32), vault);
    const challenge = auth.challenge(account.address);
    const signature = await account.signTypedData({
      ...challenge.typedData,
      message: {
        ...challenge.typedData.message,
        issuedAt: BigInt(challenge.issuedAt),
        expiresAt: BigInt(challenge.expiresAt),
      },
    });
    const token = await auth.createSession(
      account.address,
      challenge.nonce,
      challenge.issuedAt,
      challenge.expiresAt,
      signature,
    );
    expect(auth.verify(token).sub).toBe(account.address.toLowerCase());
    await expect(
      auth.createSession(
        account.address,
        challenge.nonce,
        challenge.issuedAt,
        challenge.expiresAt,
        signature,
      ),
    ).rejects.toThrow("invalid or expired");
    store.close();
  });
});
