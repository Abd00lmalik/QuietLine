import { describe, expect, it } from "vitest";
import {
  ASSETS,
  COSTON2,
  actionSchema,
  deploymentManifestSchema,
  settlementSchema,
} from "./index.js";

describe("protocol schemas", () => {
  it("accepts the supported Coston2 deployment manifest", () => {
    expect(
      deploymentManifestSchema.parse({
        network: "coston2",
        chainId: COSTON2.id,
        quietPolicy: "0x1111111111111111111111111111111111111111",
        quietVault: "0x2222222222222222222222222222222222222222",
        extensionId: 65_536,
        teeSigner: "0x3333333333333333333333333333333333333333",
        codeHash: `0x${"44".repeat(32)}`,
        assets: {
          fxrp: ASSETS.FXRP.address,
          usdt0: ASSETS.USDT0.address,
        },
      }),
    ).toBeTruthy();
  });

  it("rejects unsupported actions and malformed settlements", () => {
    expect(actionSchema.safeParse("PLAINTEXT_BALANCE").success).toBe(false);
    expect(
      settlementSchema.safeParse({
        protocolVersion: 1,
        settlementType: "BORROW_PAYOUT",
        account: "not-an-address",
      }).success,
    ).toBe(false);
  });
});
