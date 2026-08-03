import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyTypedData, type Address, type Hex } from "viem";
import type { Store } from "./db.js";

const sessionTypes = {
  QuietlineSession: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export class Auth {
  constructor(
    private store: Store,
    private secret: string,
    private vault: Address,
  ) {}

  challenge(address: Address) {
    const now = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(24).toString("hex");
    const expiresAt = now + 300;
    this.store.putChallenge(address, nonce, expiresAt);
    return {
      nonce,
      issuedAt: now,
      expiresAt,
      typedData: {
        domain: {
          name: "Quietline Session",
          version: "1",
          chainId: 114,
          verifyingContract: this.vault,
        },
        types: sessionTypes,
        primaryType: "QuietlineSession" as const,
        message: { wallet: address, nonce, issuedAt: now, expiresAt },
      },
    };
  }

  async createSession(
    address: Address,
    nonce: string,
    issuedAt: number,
    expiresAt: number,
    signature: Hex,
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (issuedAt > now + 30 || expiresAt <= now || expiresAt - issuedAt !== 300) {
      throw new Error("challenge timestamps are invalid");
    }
    if (!this.store.consumeChallenge(address, nonce, now)) {
      throw new Error("challenge is invalid or expired");
    }
    const valid = await verifyTypedData({
      address,
      domain: {
        name: "Quietline Session",
        version: "1",
        chainId: 114,
        verifyingContract: this.vault,
      },
      types: sessionTypes,
      primaryType: "QuietlineSession",
      message: {
        wallet: address,
        nonce,
        issuedAt: BigInt(issuedAt),
        expiresAt: BigInt(expiresAt),
      },
      signature,
    });
    if (!valid) throw new Error("session signature is invalid");
    return this.sign({ sub: address.toLowerCase(), exp: now + 1800 });
  }

  verify(token: string) {
    const [body, signature] = token.split(".");
    if (!body || !signature) throw new Error("invalid session token");
    const expected = this.mac(body);
    const a = Buffer.from(signature, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("invalid session token");
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      sub: string;
      exp: number;
    };
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("session expired");
    return payload;
  }

  private sign(payload: unknown) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  private mac(body: string) {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}
