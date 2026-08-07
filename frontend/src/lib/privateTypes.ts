import type { Address, Hex } from "viem";

export type PrivateBalance = {
  available: number;
  reserved: number;
};

export type PrivateAccount = {
  owner: Address;
  nonce: number;
  balances: Record<"FXRP" | "USDT0", PrivateBalance>;
  loanId?: string;
};

export type PrivateTranche = {
  mandateId: string;
  lender: Address;
  principal: number;
  aprBps: number;
};

export type PrivateMandate = {
  id: string;
  lender: Address;
  available: number;
  minAprBps: number;
  termMask: number;
  perBorrowerCap: number;
  active: boolean;
  createdAt: number;
  allocatedPrincipal: number;
  interestEarned: number;
};

export type PrivateLoan = {
  id: string;
  borrower: Address;
  principal: number;
  interestPaid: number;
  collateralFxrp: number;
  borrowerAprBps: number;
  termDays: number;
  startedAt: number;
  maturesAt: number;
  lastAccruedAt: number;
  accruedInterestRay: number;
  tranches: PrivateTranche[];
  status: "healthy" | "restricted" | "warning" | "liquidatable" | "closed" | "liquidated";
  lastHealthFactorBps: number;
  liquidationPriceE6: number;
};

export type PrivateActivity = {
  id: string;
  account: Address;
  kind: string;
  amount?: number;
  asset?: "FXRP" | "USDT0";
  createdAt: number;
};

export type PrivateAccountView = {
  account: PrivateAccount;
  loan?: PrivateLoan;
  mandates: PrivateMandate[];
  activities: PrivateActivity[];
  price: {
    xrpUsdE6: number;
    updatedAt: number;
  };
};

export type PrivateQuote = {
  requestId: string;
  borrower: Address;
  amount: number;
  requestedAmount?: number;
  termDays: number;
  collateralFxrp: number;
  requestedCollateralFxrp?: number;
  partial?: boolean;
  lenderAprBps: number;
  borrowerAprBps: number;
  maxAprBps: number;
  tranches: PrivateTranche[];
  expiresAt: number;
  priceE6: number;
};

export type PrivateStressView = {
  xrpUsdE6: number;
  debt: number;
  collateralValue: number;
  ltvBps: number;
  healthFactorBps: number;
  status: "healthy" | "restricted" | "warning" | "liquidatable";
};

export type PreparedPrivateAction = {
  ciphertext: Hex;
  responsePrivateKey: Uint8Array;
};
