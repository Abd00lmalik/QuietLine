import { describe, expect, it } from "vitest";
import { assertSuccessfulReceipt } from "./transactions";

const transactionHash =
  "0xae57643a1cd8aa1c9f538af69a087725550271ba3ea9eaa5a3e467488beeeafa";

describe("assertSuccessfulReceipt", () => {
  it("returns successful receipts", () => {
    const receipt = { status: "success", transactionHash } as const;
    expect(assertSuccessfulReceipt(receipt, "QuietVault deposit")).toBe(receipt);
  });

  it("reports reverted vault transactions before event parsing", () => {
    expect(() =>
      assertSuccessfulReceipt(
        { status: "reverted", transactionHash },
        "QuietVault deposit",
      ),
    ).toThrow(
      `QuietVault deposit reverted on Coston2 in transaction ${transactionHash}. No private balance was credited and no FCC job was created.`,
    );
  });
});
