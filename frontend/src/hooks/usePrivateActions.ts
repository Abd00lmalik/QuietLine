import { useCallback, useRef } from "react";
import { usePublicClient, useSignTypedData, useWalletClient } from "wagmi";
import {
  decodeEventLog,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  getAttestation,
  getConfig,
  submitDirect,
  waitForChainJob,
  waitForJob,
} from "../lib/api";
import {
  createActionDraft,
  decryptPrivateResponse,
  sealSignedAction,
  teePublicKeyFromInfo,
  type ActionDraft,
} from "../lib/crypto";
import type {
  PreparedPrivateAction,
  PrivateAccountView,
  PrivateQuote,
  PrivateStressView,
} from "../lib/privateTypes";
import { useQuietline } from "../store/useQuietline";
import { erc20Abi, quietVaultAbi } from "../web3/abis";

const instructionFee = BigInt(
  import.meta.env.VITE_FCC_INSTRUCTION_FEE_WEI ?? "1000000",
);

const directRoutes = {
  OPEN_ACCOUNT: "open-account",
  ACCOUNT_QUERY: "account",
  SET_MANDATE: "mandate",
  CANCEL_MANDATE: "mandate",
  QUOTE_REQUEST: "quote",
  APPLY_REPAYMENT: "repayment",
  STRESS_QUERY: "stress",
} as const;

type DirectAction = keyof typeof directRoutes;
type MutationTask<T> = () => Promise<T>;
let mutationQueue: Promise<unknown> = Promise.resolve();

export function usePrivateActions() {
  const { signTypedDataAsync } = useSignTypedData();
  const configRef = useRef<Awaited<ReturnType<typeof getConfig>>>();
  const teeKeyRef = useRef<Hex>();
  const address = useQuietline((state) => state.address);
  const token = useQuietline((state) => state.sessionToken);
  const hydrate = useQuietline((state) => state.hydratePrivateAccount);
  const incrementNonce = useQuietline((state) => state.incrementAccountNonce);

  const protocolContext = useCallback(async () => {
    const [config, teeKey] = await Promise.all([
      configRef.current ?? getConfig().then((value) => (configRef.current = value)),
      teeKeyRef.current ??
        getAttestation()
          .then(teePublicKeyFromInfo)
          .then((value) => (teeKeyRef.current = value)),
    ]);
    return { config, teeKey };
  }, []);

  const prepare = useCallback(
    async (
      action: string,
      payload: unknown,
      actionNonce = useQuietline.getState().accountNonce,
      account = address,
    ): Promise<PreparedPrivateAction> => {
      if (!account) throw new Error("Connect a wallet before using confidential compute");
      const { config, teeKey } = await protocolContext();
      const draft = createActionDraft({
        sender: account,
        nonce: actionNonce,
        action,
        payload,
        chainId: config.network.id,
        vault: config.vault,
      });
      const signature = await signDraft(draft, signTypedDataAsync);
      return {
        ciphertext: await sealSignedAction(draft, signature, teeKey),
        responsePrivateKey: draft.responsePrivateKey,
      };
    },
    [address, protocolContext, signTypedDataAsync],
  );

  const direct = useCallback(
    async <T,>(
      action: DirectAction,
      payload: unknown,
      options: {
        nonce?: number;
        address?: Address;
        token?: string;
      } = {},
    ): Promise<T> => {
      const activeAddress = options.address ?? address;
      const activeToken = options.token ?? token;
      if (!activeAddress || !activeToken) {
        throw new Error("Open a live Quietline session first");
      }
      const prepared = await prepare(
        action,
        payload,
        options.nonce ?? useQuietline.getState().accountNonce,
        activeAddress,
      );
      const job = await submitDirect(
        directRoutes[action],
        {
          account: activeAddress,
          ciphertext: prepared.ciphertext,
          ...(action === "SET_MANDATE" || action === "CANCEL_MANDATE"
            ? { command: action }
            : {}),
        },
        activeToken,
      );
      const completed = await waitForJob(job.id, activeToken);
      const ciphertext = completed.response?.ciphertext;
      if (!ciphertext) return undefined as T;
      return decryptPrivateResponse<T>(
        ciphertext,
        prepared.responsePrivateKey,
      );
    },
    [address, prepare, token],
  );

  const refreshAccount = useCallback(
    async (overrides: { address?: Address; token?: string; nonce?: number } = {}) => {
      const view = await direct<PrivateAccountView>(
        "ACCOUNT_QUERY",
        {},
        overrides,
      );
      hydrate(view);
      return view;
    },
    [direct, hydrate],
  );

  const openOrRefresh = useCallback(
    async (liveAddress: Address, liveToken: string) => {
      try {
        return await refreshAccount({
          address: liveAddress,
          token: liveToken,
          nonce: 0,
        });
      } catch (error) {
        if (!messageFor(error).includes("private account does not exist")) throw error;
      }
      await direct<void>(
        "OPEN_ACCOUNT",
        { operationId: crypto.randomUUID() },
        { address: liveAddress, token: liveToken, nonce: 0 },
      );
      incrementNonce();
      return refreshAccount({
        address: liveAddress,
        token: liveToken,
        nonce: 1,
      });
    },
    [direct, incrementNonce, refreshAccount],
  );

  const requestQuote = useCallback(
    (input: {
      amount: number;
      collateral: number;
      termDays: number;
      maxApr: number;
    }) =>
      direct<PrivateQuote>("QUOTE_REQUEST", {
        id: crypto.randomUUID(),
        borrower: address,
        amount: toUnits(input.amount),
        termDays: input.termDays,
        maxAprBps: Math.round(input.maxApr * 100),
        collateralFxrp: toUnits(input.collateral),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }),
    [address, direct],
  );

  const setMandate = useCallback(
    (input: {
      amount: number;
      minApr: number;
      terms: number[];
      perBorrowerCap: number;
    }) => serializeMutation(async () => {
      await direct<void>("SET_MANDATE", {
        mandateId: crypto.randomUUID(),
        amount: toUnits(input.amount),
        minAprBps: Math.round(input.minApr * 100),
        termMask: termMask(input.terms),
        perBorrowerCap: toUnits(input.perBorrowerCap),
      });
      incrementNonce();
      return refreshAccount({ nonce: useQuietline.getState().accountNonce });
    }),
    [direct, incrementNonce, refreshAccount],
  );

  const repay = useCallback(
    (amount: number) => serializeMutation(async () => {
      await direct<void>("APPLY_REPAYMENT", {
        amount: toUnits(amount),
        operationId: crypto.randomUUID(),
      });
      incrementNonce();
      return refreshAccount({ nonce: useQuietline.getState().accountNonce });
    }),
    [direct, incrementNonce, refreshAccount],
  );

  const stress = useCallback(
    (xrpUsd: number) =>
      direct<PrivateStressView>("STRESS_QUERY", {
        xrpUsdE6: toUnits(xrpUsd),
      }),
    [direct],
  );

  return {
    direct,
    openOrRefresh,
    prepare,
    protocolContext,
    refreshAccount,
    repay,
    requestQuote,
    setMandate,
    stress,
  };
}

export function useVaultActions() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const sessionToken = useQuietline((state) => state.sessionToken);
  const addPublicActivity = useQuietline((state) => state.addPublicActivity);
  const { prepare, protocolContext, refreshAccount } = usePrivateActions();

  const requireClients = useCallback(() => {
    if (!walletClient || !publicClient || !walletClient.account) {
      throw new Error("Connect a Coston2 wallet before submitting a transaction");
    }
    if (!sessionToken) throw new Error("Your private session is locked");
    return {
      wallet: walletClient,
      publicClient,
      account: walletClient.account.address,
      sessionToken,
    };
  }, [publicClient, sessionToken, walletClient]);

  const deposit = useCallback(
    async (
      asset: "FXRP" | "USDT0",
      amount: number,
      onStage?: (stage: "approving" | "depositing" | "confirming") => void,
    ) => {
      const clients = requireClients();
      const { config } = await protocolContext();
      const tokenAddress = config.assets[asset].address;
      const units = parseUnits(String(amount), config.assets[asset].decimals);
      onStage?.("approving");
      const approvalHash = await clients.wallet.writeContract({
        account: clients.account,
        chain: clients.wallet.chain,
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [config.vault, units],
      });
      await clients.publicClient.waitForTransactionReceipt({ hash: approvalHash });
      onStage?.("depositing");
      const depositHash = await clients.wallet.writeContract({
        account: clients.account,
        chain: clients.wallet.chain,
        address: config.vault,
        abi: quietVaultAbi,
        functionName: "deposit",
        args: [tokenAddress, units],
        value: instructionFee,
      });
      await clients.publicClient.waitForTransactionReceipt({ hash: depositHash });
      onStage?.("confirming");
      const requestId = requestIdFromReceipt(
        await clients.publicClient.getTransactionReceipt({ hash: depositHash }),
        "DepositSubmitted",
      );
      await waitForChainJob(requestId, clients.sessionToken);
      await refreshAccount();
      addPublicActivity({
        label: `${asset} deposit`,
        detail: `${amount.toFixed(4)} ${asset} moved to QuietVault`,
        status: "complete",
        txHash: depositHash,
      });
      return depositHash;
    },
    [addPublicActivity, protocolContext, refreshAccount, requireClients],
  );

  const acceptBorrow = useCallback(
    (
      quote: PrivateQuote,
      onStage?: (stage: "signing" | "submitting" | "computing" | "settling") => void,
    ) => serializeMutation(async () => {
      const clients = requireClients();
      const { config } = await protocolContext();
      onStage?.("signing");
      const prepared = await prepare("BORROW_ACCEPT", {
        quote,
        loanId: crypto.randomUUID(),
      });
      onStage?.("submitting");
      const requestHash = await clients.wallet.writeContract({
        account: clients.account,
        chain: clients.wallet.chain,
        address: config.vault,
        abi: quietVaultAbi,
        functionName: "requestBorrow",
        args: [prepared.ciphertext],
        value: instructionFee,
      });
      await clients.publicClient.waitForTransactionReceipt({ hash: requestHash });
      onStage?.("computing");
      const requestId = requestIdFromReceipt(
        await clients.publicClient.getTransactionReceipt({ hash: requestHash }),
        "ConfidentialRequestSubmitted",
      );
      await waitForChainJob(requestId, clients.sessionToken);
      onStage?.("settling");
      await refreshAfterNonceAdvance(refreshAccount);
      addPublicActivity({
        label: "USDT0 borrow payout",
        detail: `${(quote.amount / 1_000_000).toFixed(4)} USDT0 settled from QuietVault`,
        status: "complete",
        txHash: requestHash,
      });
      return requestHash;
    }),
    [addPublicActivity, prepare, protocolContext, refreshAccount, requireClients],
  );

  const withdraw = useCallback(
    async (
      asset: "FXRP" | "USDT0",
      amount: number,
      destination: Address,
      onStage?: (stage: "submitting" | "confirming") => void,
    ) => {
      return serializeMutation(async () => {
        const clients = requireClients();
        const { config } = await protocolContext();
        const tokenAddress = config.assets[asset].address;
        const units = parseUnits(String(amount), config.assets[asset].decimals);
        onStage?.("submitting");
        const requestHash = await clients.wallet.writeContract({
          account: clients.account,
          chain: clients.wallet.chain,
          address: config.vault,
          abi: quietVaultAbi,
          functionName: "requestWithdrawal",
          args: [tokenAddress, units, destination],
          value: instructionFee,
        });
        await clients.publicClient.waitForTransactionReceipt({ hash: requestHash });
        const requestId = requestIdFromReceipt(
          await clients.publicClient.getTransactionReceipt({ hash: requestHash }),
          "ConfidentialRequestSubmitted",
        );
        onStage?.("confirming");
        await waitForChainJob(requestId, clients.sessionToken);
        await refreshAfterNonceAdvance(refreshAccount);
        addPublicActivity({
          label: `${asset} withdrawal`,
          detail: `${amount.toFixed(4)} ${asset} settled to destination`,
          status: "complete",
          txHash: requestHash,
        });
        return requestHash;
      });
    },
    [
      addPublicActivity,
      protocolContext,
      refreshAccount,
      requireClients,
    ],
  );

  return { acceptBorrow, deposit, withdraw };
}

async function signDraft(
  draft: ActionDraft,
  sign: ReturnType<typeof useSignTypedData>["signTypedDataAsync"],
) {
  return sign({
    domain: draft.typedData.domain,
    types: draft.typedData.types,
    primaryType: draft.typedData.primaryType,
    message: draft.typedData.message,
  });
}

async function refreshAfterNonceAdvance(
  refresh: (overrides?: { nonce?: number }) => Promise<PrivateAccountView>,
) {
  const current = useQuietline.getState().accountNonce;
  useQuietline.getState().incrementAccountNonce();
  return refresh({ nonce: current + 1 });
}

function termMask(terms: number[]) {
  return terms.reduce(
    (mask, term) => mask | (term === 7 ? 1 : term === 14 ? 2 : term === 30 ? 4 : 0),
    0,
  );
}

function toUnits(amount: number) {
  return Math.round(amount * 1_000_000);
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function serializeMutation<T>(task: MutationTask<T>) {
  const next = mutationQueue.then(task, task);
  mutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function requestIdFromReceipt(
  receipt: Awaited<ReturnType<NonNullable<ReturnType<typeof usePublicClient>>["getTransactionReceipt"]>>,
  eventName: "DepositSubmitted" | "ConfidentialRequestSubmitted",
) {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: quietVaultAbi,
        data: log.data,
        topics: log.topics,
        eventName,
      });
      if (decoded.eventName === eventName && decoded.args.requestId) {
        return decoded.args.requestId as Hex;
      }
    } catch {
      // Ignore unrelated logs from the same transaction.
    }
  }
  throw new Error(`${eventName} event did not include a request id`);
}
