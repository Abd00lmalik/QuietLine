import {
  createPublicClient,
  createWalletClient,
  hexToString,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { COSTON2 } from "@quietline/protocol";
import type { Config } from "./config.js";

export type Anchor = {
  settlement: {
    protocolVersion: number;
    settlementType: number;
    account: Address;
    token: Address;
    amount: string | number | bigint;
    destination: Address;
    requestId: Hex;
    settlementId: Hex;
    previousSequence: number;
    nextSequence: number;
    previousRoot: Hex;
    nextRoot: Hex;
    deadline: number;
  };
  signature: Hex;
};

export type ChainInstruction = {
  externalKey: string;
  account: Address;
  requestId: Hex;
  command: string;
  blockNumber: bigint;
};

export type DepositRecord = {
  depositId: Hex;
  account: Address;
  token: Address;
  amount: string;
};

const abi = parseAbi([
  "function executeSettlement((uint8 protocolVersion,uint8 settlementType,address account,address token,uint256 amount,address destination,bytes32 requestId,bytes32 settlementId,uint64 previousSequence,uint64 nextSequence,bytes32 previousRoot,bytes32 nextRoot,uint64 deadline) settlement,bytes signature)",
  "function usedSettlementId(bytes32 settlementId) view returns (bool)",
  "function stateSequence() view returns (uint64)",
  "function stateRoot() view returns (bytes32)",
  "function activeTeeSigner() view returns (address)",
  "function currentXrpUsdPrice() view returns (uint64 priceE6,uint64 priceTimestamp)",
  "function requestRiskTick() payable returns (bytes32 requestId)",
]);
const erc20Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const teeManagerAbi = parseAbi([
  "function getActiveTeeMachines(uint256 extensionId) view returns (address[])",
  "function getTeeMachineStatus(address teeId) view returns (uint8)",
]);
const depositEvent = parseAbiItem(
  "event DepositSubmitted(bytes32 indexed depositId,address indexed account,address indexed token,uint256 amount,bytes32 requestId)",
);
const requestEvent = parseAbiItem(
  "event ConfidentialRequestSubmitted(bytes32 indexed requestId,bytes32 indexed command,address indexed account)",
);
const settlementEvent = parseAbiItem(
  "event SettlementExecuted(bytes32 indexed settlementId,uint8 indexed settlementType,address indexed account,uint64 sequence,bytes32 stateRoot)",
);

export class ChainClient {
  readonly publicClient;
  readonly walletClient;

  constructor(private cfg: Config) {
    this.publicClient = createPublicClient({
      chain: {
        id: COSTON2.id,
        name: COSTON2.name,
        nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
        rpcUrls: { default: { http: [cfg.COSTON2_RPC_URL] } },
      },
      transport: http(cfg.COSTON2_RPC_URL),
    });
    this.walletClient = createWalletClient({
      account: privateKeyToAccount(cfg.RELAYER_PRIVATE_KEY as Hex),
      chain: this.publicClient.chain,
      transport: http(cfg.COSTON2_RPC_URL),
    });
  }

  async execute(anchor: Anchor) {
    const s = anchor.settlement;
    const existing = await this.settlementTransaction(s.settlementId);
    if (existing) return existing;
    try {
      const hash = await this.walletClient.writeContract({
        address: this.cfg.QUIET_VAULT as Address,
        abi,
        functionName: "executeSettlement",
        args: [
          {
            ...s,
            amount: BigInt(s.amount),
            previousSequence: BigInt(s.previousSequence),
            nextSequence: BigInt(s.nextSequence),
            deadline: BigInt(s.deadline),
          },
          anchor.signature,
        ],
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`settlement transaction ${hash} reverted`);
      }
      return hash;
    } catch (error) {
      const recovered = await this.settlementTransaction(s.settlementId);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async settlementTransaction(settlementId: Hex) {
    const used = await this.publicClient.readContract({
      address: this.cfg.QUIET_VAULT as Address,
      abi,
      functionName: "usedSettlementId",
      args: [settlementId],
    });
    if (!used) return undefined;
    const logs = await this.publicClient.getLogs({
      address: this.cfg.QUIET_VAULT as Address,
      event: settlementEvent,
      args: { settlementId },
      fromBlock: this.cfg.START_BLOCK,
      toBlock: "latest",
    });
    const hash = logs.at(-1)?.transactionHash;
    if (!hash) {
      throw new Error(`settlement ${settlementId} is used but its event was not found`);
    }
    return hash;
  }

  async blockNumber() {
    return this.publicClient.getBlockNumber();
  }

  async anchorState() {
    const [sequence, root] = await Promise.all([
      this.publicClient.readContract({
        address: this.cfg.QUIET_VAULT as Address,
        abi,
        functionName: "stateSequence",
      }),
      this.publicClient.readContract({
        address: this.cfg.QUIET_VAULT as Address,
        abi,
        functionName: "stateRoot",
      }),
    ]);
    return { sequence: Number(sequence), root };
  }

  async activeTeeSigner() {
    return this.publicClient.readContract({
      address: this.cfg.QUIET_VAULT as Address,
      abi,
      functionName: "activeTeeSigner",
    });
  }

  async fccMachineState() {
    const active = await this.publicClient.readContract({
      address: this.cfg.TEE_MANAGER as Address,
      abi: teeManagerAbi,
      functionName: "getActiveTeeMachines",
      args: [BigInt(this.cfg.EXTENSION_ID)],
    });
    const statuses = await Promise.all(
      active.map((teeId) =>
        this.publicClient.readContract({
          address: this.cfg.TEE_MANAGER as Address,
          abi: teeManagerAbi,
          functionName: "getTeeMachineStatus",
          args: [teeId],
        }),
      ),
    );
    return {
      active: active.map((teeId, index) => ({
        teeId,
        status: Number(statuses[index]),
      })),
    };
  }

  async market() {
    const [price, liquidity] = await Promise.all([
      this.publicClient.readContract({
        address: this.cfg.QUIET_VAULT as Address,
        abi,
        functionName: "currentXrpUsdPrice",
      }),
      this.publicClient.readContract({
        address: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [this.cfg.QUIET_VAULT as Address],
      }),
    ]);
    return {
      xrpUsdE6: Number(price[0]),
      updatedAt: Number(price[1]),
      vaultUsdt0Balance: liquidity.toString(),
    };
  }

  async requestRiskTick() {
    const hash = await this.walletClient.writeContract({
      address: this.cfg.QUIET_VAULT as Address,
      abi,
      functionName: "requestRiskTick",
      value: this.cfg.FCC_INSTRUCTION_FEE_WEI,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`risk tick transaction ${hash} reverted`);
    }
    return hash;
  }

  async events(fromBlock: bigint, toBlock: bigint): Promise<ChainInstruction[]> {
    const address = this.cfg.QUIET_VAULT as Address;
    const [deposits, requests] = await Promise.all([
      this.publicClient.getLogs({ address, event: depositEvent, fromBlock, toBlock }),
      this.publicClient.getLogs({ address, event: requestEvent, fromBlock, toBlock }),
    ]);
    return [
      ...deposits.map((log) => ({
        externalKey: `chain:${log.args.requestId}`,
        account: log.args.account!,
        requestId: log.args.requestId!,
        command: "DEPOSIT",
        blockNumber: log.blockNumber,
      })),
      ...requests.map((log) => ({
        externalKey: `chain:${log.args.requestId}`,
        account: log.args.account!,
        requestId: log.args.requestId!,
        command: decodeBytes32(log.args.command!),
        blockNumber: log.blockNumber,
      })),
    ].sort((a, b) => Number(a.blockNumber - b.blockNumber));
  }

  async depositForRequest(requestId: Hex, blockNumber: bigint): Promise<DepositRecord> {
    const logs = await this.publicClient.getLogs({
      address: this.cfg.QUIET_VAULT as Address,
      event: depositEvent,
      fromBlock: blockNumber,
      toBlock: blockNumber,
    });
    const match = logs.find(
      (log) => log.args.requestId?.toLowerCase() === requestId.toLowerCase(),
    );
    if (
      !match?.args.depositId ||
      !match.args.account ||
      !match.args.token ||
      match.args.amount === undefined
    ) {
      throw new Error(`deposit record for request ${requestId} was not found on-chain`);
    }
    return {
      depositId: match.args.depositId,
      account: match.args.account,
      token: match.args.token,
      amount: match.args.amount.toString(),
    };
  }
}

function decodeBytes32(value: Hex) {
  return hexToString(value, { size: 32 }).replace(/\0+$/u, "");
}
