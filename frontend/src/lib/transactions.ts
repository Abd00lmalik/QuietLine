import type { Hex } from "viem";

export type TransactionReceiptStatus = {
  status: string;
  transactionHash: Hex;
};

export function assertSuccessfulReceipt(
  receipt: TransactionReceiptStatus,
  label: string,
) {
  if (receipt.status !== "success") {
    throw new Error(
      `${label} reverted on Coston2 in transaction ${receipt.transactionHash}. No private balance was credited and no FCC job was created.`,
    );
  }
  return receipt;
}
