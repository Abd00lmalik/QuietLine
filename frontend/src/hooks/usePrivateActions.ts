import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useSignTypedData, useWalletClient } from "wagmi";
import { parseUnits, type Address, type Hex } from "viem";
import {
  getMarket,
  getAttestation,
  getConfig,
  getHealth,
  listJobs,
  submitDirect,
  waitForChainJob,
  waitForJob,
} from "../lib/api";
import { assetSymbol } from "@quietline/protocol";
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
import { requestIdFromReceipt } from "../lib/receipts";
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
export type PrivateSessionStage =
  | "checking-account"
  | "creating-account"
  | "decrypting-account";
let mutationQueue: Promise<unknown> = Promise.resolve();

export function usePrivateActions() {
  const queryClient = useQueryClient();
  const { signTypedDataAsync } = useSignTypedData();
  const configRef = useRef<Awaited<ReturnType<typeof getConfig>>>();
  const teeKeyRef = useRef<Hex>();
  const address = useQuietline((state) => state.address);
  const token = useQuietline((state) => state.sessionToken);
  const hydrate = useQuietline((state) => state.hydratePrivateAccount);
  const incrementNonce = useQuietline((state) => state.incrementAccountNonce);
  const hydrateMarket = useQuietline((state) => state.hydrateMarket);
  const hydrateRelayerJobs = useQuietline((state) => state.hydrateRelayerJobs);

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

  const synchronizePublicState = useCallback(
    async (activeToken = token) => {
      const [marketResult, jobsResult] = await Promise.allSettled([
        getMarket(),
        activeToken ? listJobs(activeToken) : Promise.resolve([]),
      ]);
      if (marketResult.status === "fulfilled") {
        hydrateMarket(marketResult.value);
      }
      if (jobsResult.status === "fulfilled") {
        hydrateRelayerJobs(jobsResult.value);
      }
      await queryClient.invalidateQueries();
    },
    [hydrateMarket, hydrateRelayerJobs, queryClient, token],
  );

  const openOrRefresh = useCallback(
    async (
      liveAddress: Address,
      liveToken: string,
      onStage?: (stage: PrivateSessionStage) => void,
    ) => {
      try {
        onStage?.("checking-account");
        return await refreshAccount({
          address: liveAddress,
          token: liveToken,
          nonce: 0,
        });
      } catch (error) {
        if (!messageFor(error).includes("private account does not exist")) throw error;
      }
      onStage?.("creating-account");
      await direct<void>(
        "OPEN_ACCOUNT",
        { operationId: crypto.randomUUID() },
        { address: liveAddress, token: liveToken, nonce: 0 },
      );
      incrementNonce();
      onStage?.("decrypting-account");
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
      const view = await refreshAccount({
        nonce: useQuietline.getState().accountNonce,
      });
      await synchronizePublicState();
      return view;
    }),
    [direct, incrementNonce, refreshAccount, synchronizePublicState],
  );

  const repay = useCallback(
    (amount: number) => serializeMutation(async () => {
      await direct<void>("APPLY_REPAYMENT", {
        amount: toUnits(amount),
        operationId: crypto.randomUUID(),
      });
      incrementNonce();
      const view = await refreshAccount({
        nonce: useQuietline.getState().accountNonce,
      });
      await synchronizePublicState();
      return view;
    }),
    [direct, incrementNonce, refreshAccount, synchronizePublicState],
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
    synchronizePublicState,
  };
}

export function useVaultActions() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const sessionToken = useQuietline((state) => state.sessionToken);
  const addPublicActivity = useQuietline((state) => state.addPublicActivity);
  const {
    prepare,
    protocolContext,
    refreshAccount,
    synchronizePublicState,
  } = usePrivateActions();

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

  const assertLiveFcc = useCallback(async () => {
    const health = await getHealth();
    if (health.services.fcc !== "ok") {
      throw new Error(
        health.detail ??
          "Confidential compute is not ready. No token transaction was submitted.",
      );
    }
  }, []);

  const deposit = useCallback(
    async (
      asset: "FXRP" | "USDT0",
      amount: number,
      onStage?: (stage: "approving" | "depositing" | "confirming") => void,
    ) => {
      const clients = requireClients();
      await assertLiveFcc();
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
      const depositReceipt =
        await clients.publicClient.waitForTransactionReceipt({ hash: depositHash });
      onStage?.("confirming");
      const requestId = requestIdFromReceipt(
        depositReceipt,
        config.vault,
        "DepositSubmitted",
      );
      try {
        await waitForChainJob(requestId, clients.sessionToken);
      } catch (error) {
        await synchronizePublicState(clients.sessionToken);
        addPublicActivity({
          label: `${assetSymbol(asset)} deposit awaiting private credit`,
          detail: `${amount.toFixed(4)} ${assetSymbol(asset)} is in QuietVault, but FCC processing did not complete. Do not submit the deposit again.`,
          status: "warning",
          txHash: depositHash,
        });
        throw new Error(
          `QuietVault custody is confirmed in transaction ${depositHash}, but private credit did not complete: ${messageFor(error)}. Do not deposit again.`,
        );
      }
      await refreshAccount();
      await synchronizePublicState(clients.sessionToken);
      addPublicActivity({
        label: `${assetSymbol(asset)} deposit`,
        detail: `${amount.toFixed(4)} ${assetSymbol(asset)} moved to QuietVault`,
        status: "complete",
        txHash: depositHash,
      });
      return depositHash;
    },
    [
      addPublicActivity,
      assertLiveFcc,
      protocolContext,
      refreshAccount,
      requireClients,
      synchronizePublicState,
    ],
  );

  const acceptBorrow = useCallback(
    (
      quote: PrivateQuote,
      onStage?: (stage: "signing" | "submitting" | "computing" | "settling") => void,
    ) => serializeMutation(async () => {
      const clients = requireClients();
      await assertLiveFcc();
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
      const requestReceipt =
        await clients.publicClient.waitForTransactionReceipt({ hash: requestHash });
      onStage?.("computing");
      const requestId = requestIdFromReceipt(
        requestReceipt,
        config.vault,
        "ConfidentialRequestSubmitted",
      );
      await waitForChainJob(requestId, clients.sessionToken);
      onStage?.("settling");
      await refreshAfterNonceAdvance(refreshAccount);
      await synchronizePublicState(clients.sessionToken);
      addPublicActivity({
        label: `${assetSymbol("USDT0")} borrow payout`,
        detail: `${(quote.amount / 1_000_000).toFixed(4)} ${assetSymbol("USDT0")} settled from QuietVault`,
        status: "complete",
        txHash: requestHash,
      });
      return requestHash;
    }),
    [
      addPublicActivity,
      assertLiveFcc,
      prepare,
      protocolContext,
      refreshAccount,
      requireClients,
      synchronizePublicState,
    ],
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
        await assertLiveFcc();
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
        const requestReceipt =
          await clients.publicClient.waitForTransactionReceipt({ hash: requestHash });
        const requestId = requestIdFromReceipt(
          requestReceipt,
          config.vault,
          "ConfidentialRequestSubmitted",
        );
        onStage?.("confirming");
        await waitForChainJob(requestId, clients.sessionToken);
        await refreshAfterNonceAdvance(refreshAccount);
        await synchronizePublicState(clients.sessionToken);
        addPublicActivity({
          label: `${assetSymbol(asset)} withdrawal`,
          detail: `${amount.toFixed(4)} ${assetSymbol(asset)} settled to destination`,
          status: "complete",
          txHash: requestHash,
        });
        return requestHash;
      });
    },
    [
      addPublicActivity,
      assertLiveFcc,
      protocolContext,
      refreshAccount,
      requireClients,
      synchronizePublicState,
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
