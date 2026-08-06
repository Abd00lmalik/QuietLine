import {
  decodeEventLog,
  isAddressEqual,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { quietVaultAbi } from "../web3/abis";

type QuietVaultEvent =
  | "DepositSubmitted"
  | "ConfidentialRequestSubmitted";

export function requestIdFromReceipt(
  receipt: { logs: readonly Log[] },
  vault: Address,
  eventName: QuietVaultEvent,
): Hex {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, vault)) continue;
    try {
      const decoded = decodeEventLog({
        abi: quietVaultAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (
        decoded.eventName === eventName &&
        !Array.isArray(decoded.args) &&
        "requestId" in decoded.args
      ) {
        return decoded.args.requestId as Hex;
      }
    } catch {
      // The vault may emit several event types in the same transaction.
    }
  }
  throw new Error(`${eventName} event did not include a request id`);
}
