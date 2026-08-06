import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Address, Hex } from "viem";
import { assetSymbol, type AssetId } from "@quietline/protocol";
import type { RelayerJob } from "../lib/api";
import type {
  PrivateAccountView,
  PrivateLoan,
  PrivateMandate,
  PrivateTranche,
} from "../lib/privateTypes";

export type ActivityItem = {
  id: string;
  scope: "public" | "private";
  label: string;
  detail: string;
  status: "complete" | "pending" | "warning";
  timestamp: string;
  txHash?: Hex;
};

export type Position = {
  id: string;
  principal: number;
  accruedInterest: number;
  collateral: number;
  apr: number;
  termDays: number;
  maturesAt: number;
  maturity: string;
  ltv: number;
  healthFactor: number;
  liquidationPrice: number;
  warningPrice: number;
  tranches: PrivateTranche[];
  status: PrivateLoan["status"];
};

type QuietlineState = {
  hasHydrated: boolean;
  mode: "disconnected" | "live";
  address?: Address | undefined;
  sessionToken?: string | undefined;
  sessionExpiresAt?: number | undefined;
  accountNonce: number;
  privateUpdatedAt?: number | undefined;
  privateFxrp: number;
  privateUsdt0: number;
  lenderAllocated: number;
  lenderEarned: number;
  mandates: PrivateMandate[];
  marketPriceE6?: number | undefined;
  marketUpdatedAt?: number | undefined;
  vaultUsdt0Balance?: number | undefined;
  marketStatus: "loading" | "ready" | "unavailable";
  serviceHealth?: {
    status: "ok" | "degraded";
    services: {
      api: "ok" | "unavailable";
      database: "ok" | "unavailable";
      fcc: "ok" | "unavailable" | "signer_mismatch";
    };
    timestamp: string;
  };
  position?: Position | undefined;
  activities: ActivityItem[];
  notifications: { health: boolean; maturity24h: boolean; maturity1h: boolean; deposit: boolean; payout: boolean };
  connectLive: (address: Address, token: string, expiresAt: number) => void;
  hydratePrivateAccount: (view: PrivateAccountView) => void;
  incrementAccountNonce: () => void;
  addPublicActivity: (item: Omit<ActivityItem, "id" | "scope" | "timestamp">) => void;
  hydrateRelayerJobs: (jobs: RelayerJob[]) => void;
  hydrateMarket: (market: { xrpUsdE6: number; updatedAt: number; vaultUsdt0Balance: string }) => void;
  markMarketUnavailable: () => void;
  hydrateHealth: (health: NonNullable<QuietlineState["serviceHealth"]>) => void;
  lock: () => void;
  disconnect: () => void;
  toggleNotification: (key: keyof QuietlineState["notifications"]) => void;
  setHasHydrated: (value: boolean) => void;
};

const initialPrivateState = {
  mode: "disconnected" as const,
  accountNonce: 0,
  privateFxrp: 0,
  privateUsdt0: 0,
  lenderAllocated: 0,
  lenderEarned: 0,
  mandates: [] as PrivateMandate[],
  activities: [] as ActivityItem[],
  marketStatus: "loading" as const,
  notifications: {
    health: true,
    maturity24h: true,
    maturity1h: true,
    deposit: true,
    payout: true,
  },
};

export const useQuietline = create<QuietlineState>()(persist((set) => ({
  ...initialPrivateState,
  hasHydrated: false,
  connectLive: (address, sessionToken, sessionExpiresAt) =>
    set({
      mode: "live",
      address,
      sessionToken,
      sessionExpiresAt,
      accountNonce: 0,
      privateUpdatedAt: undefined,
      privateFxrp: 0,
      privateUsdt0: 0,
      lenderAllocated: 0,
      lenderEarned: 0,
      mandates: [],
      position: undefined,
      activities: [],
    }),
  hydratePrivateAccount: (view) =>
    set((state) => {
      const scale = 1_000_000;
      const account = view.account;
      const loan = view.loan;
      const privateActivities: ActivityItem[] = view.activities
        .slice()
        .reverse()
        .map((item) => ({
          id: item.id,
          scope: "private",
          label: privateActivityLabel(item.kind),
          detail: item.asset && item.amount !== undefined
            ? `${(item.amount / scale).toFixed(4)} ${assetSymbol(item.asset as AssetId)}`
            : "Confidential ledger state updated",
          status: "complete",
          timestamp: new Date(item.createdAt * 1000).toLocaleString(),
        }));
      const publicActivities = state.activities.filter((item) => item.scope === "public");
      return {
        accountNonce: account.nonce,
        privateUpdatedAt: Date.now(),
        privateFxrp: account.balances.FXRP.available / scale,
        privateUsdt0: account.balances.USDT0.available / scale,
        lenderAllocated: account.balances.USDT0.reserved / scale,
        lenderEarned: view.mandates.reduce(
          (total, mandate) => total + mandate.interestEarned / scale,
          0,
        ),
        mandates: view.mandates,
        position: loan ? positionFromView(loan, view.price.xrpUsdE6) : undefined,
        activities: [...privateActivities, ...publicActivities],
      };
    }),
  incrementAccountNonce: () =>
    set((state) => ({ accountNonce: state.accountNonce + 1 })),
  addPublicActivity: (item) =>
    set((state) => ({
      activities: [
        {
          ...item,
          id: crypto.randomUUID(),
          scope: "public",
          timestamp: "Just now",
        },
        ...state.activities,
      ],
    })),
  hydrateRelayerJobs: (jobs) =>
    set((state) => {
      const relayerRows = jobs
        .filter((job) => job.externalKey?.startsWith("chain:"))
        .map((job): ActivityItem => ({
          id: `relayer:${job.id}`,
          scope: "public",
          label: publicJobLabel(job.type),
          detail:
            job.status === "failed"
              ? job.error ?? "The relayer could not complete this instruction"
              : `FCC instruction ${job.status}`,
          status:
            job.status === "confirmed"
              ? "complete"
              : job.status === "failed"
                ? "warning"
                : "pending",
          timestamp: new Date(job.updatedAt).toLocaleString(),
          ...(job.txHash ? { txHash: job.txHash } : {}),
        }));
      const relayerIds = new Set(relayerRows.map((item) => item.id));
      const existing = state.activities.filter((item) => !relayerIds.has(item.id));
      return { activities: [...relayerRows, ...existing] };
    }),
  hydrateMarket: (market) =>
    set({
      marketPriceE6: market.xrpUsdE6,
      marketUpdatedAt: market.updatedAt,
      vaultUsdt0Balance: Number(market.vaultUsdt0Balance) / 1_000_000,
      marketStatus: "ready",
    }),
  markMarketUnavailable: () =>
    set({
      marketPriceE6: undefined,
      marketUpdatedAt: undefined,
      vaultUsdt0Balance: undefined,
      marketStatus: "unavailable",
    }),
  hydrateHealth: (serviceHealth) => set({ serviceHealth }),
  lock: () =>
    set((state) => ({
      mode: "disconnected",
      sessionToken: undefined,
      sessionExpiresAt: undefined,
      accountNonce: 0,
      privateUpdatedAt: undefined,
      privateFxrp: 0,
      privateUsdt0: 0,
      lenderAllocated: 0,
      lenderEarned: 0,
      mandates: [],
      position: undefined,
      activities: state.activities.filter((item) => item.scope === "public"),
    })),
  disconnect: () =>
    set({
      mode: "disconnected",
      address: undefined,
      sessionToken: undefined,
      sessionExpiresAt: undefined,
      privateUpdatedAt: undefined,
      privateFxrp: 0,
      privateUsdt0: 0,
      lenderAllocated: 0,
      lenderEarned: 0,
      mandates: [],
      position: undefined,
      activities: [],
    }),
  toggleNotification: (key) =>
    set((state) => ({
      notifications: { ...state.notifications, [key]: !state.notifications[key] },
    })),
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
}), {
  name: "quietline.private-session",
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({
    mode: state.mode,
    address: state.address,
    sessionToken: state.sessionToken,
    sessionExpiresAt: state.sessionExpiresAt,
    accountNonce: state.accountNonce,
    privateUpdatedAt: state.privateUpdatedAt,
    privateFxrp: state.privateFxrp,
    privateUsdt0: state.privateUsdt0,
    lenderAllocated: state.lenderAllocated,
    lenderEarned: state.lenderEarned,
    mandates: state.mandates,
    position: state.position,
    activities: state.activities,
    notifications: state.notifications,
  }),
  onRehydrateStorage: () => (state) => {
    state?.setHasHydrated(true);
    if (
      state?.sessionExpiresAt !== undefined &&
      state.sessionExpiresAt <= Date.now()
    ) {
      state.lock();
    }
  },
}));

function positionFromView(
  loan: PrivateAccountView["loan"] & {},
  priceE6: number,
): Position {
  const scale = 1_000_000;
  const principal = loan.principal / scale;
  const accruedInterest = loan.accruedInterestRay / scale / scale;
  const collateral = loan.collateralFxrp / scale;
  const price = priceE6 / scale;
  const debt = principal + accruedInterest;
  const collateralValue = collateral * price;
  const ltv = collateralValue > 0 ? (debt / collateralValue) * 100 : 100;
  const warningPrice =
    collateral > 0 ? debt / (collateral * 0.55) : 0;
  return {
    id: loan.id,
    principal,
    accruedInterest,
    collateral,
    apr: loan.borrowerAprBps / 100,
    termDays: loan.termDays,
    maturesAt: loan.maturesAt,
    maturity: new Date(loan.maturesAt * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    ltv,
    healthFactor: loan.lastHealthFactorBps / 10_000,
    liquidationPrice: loan.liquidationPriceE6 / scale,
    warningPrice,
    tranches: loan.tranches,
    status: loan.status,
  };
}

function privateActivityLabel(kind: string) {
  const labels: Record<string, string> = {
    deposit: "Deposit credited privately",
    withdrawal: "Private withdrawal authorized",
  };
  return labels[kind] ?? kind.replaceAll("_", " ").toLowerCase();
}

function publicJobLabel(type: string) {
  const labels: Record<string, string> = {
    DEPOSIT: "Vault deposit processed",
    BORROW_ACCEPT: "Borrow request settled",
    WITHDRAW_REQUEST: "Withdrawal settled",
    RISK_TICK: "Public risk tick anchored",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLowerCase();
}
