import { z } from "zod";

export const COSTON2 = {
  id: 114,
  name: "Coston2",
  rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
  explorerUrl: "https://coston2-explorer.flare.network",
  faucetUrl: "https://faucet.flare.network/coston2",
} as const;

export const ASSETS = {
  FXRP: {
    symbol: "FTestXRP",
    address: "0x0b6A3645c240605887a5532109323A3E12273dc7",
    decimals: 6,
  },
  USDT0: {
    symbol: "USD₮0",
    address: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
    decimals: 6,
  },
} as const;

export type AssetId = keyof typeof ASSETS;

export function assetSymbol(asset: AssetId) {
  return ASSETS[asset].symbol;
}

export const POLICY = {
  version: 1,
  initialLtvBps: 5_000,
  warningLtvBps: 5_500,
  liquidationLtvBps: 6_500,
  liquidationDiscountBps: 500,
  protocolSpreadBps: 50,
  lateSpreadBps: 300,
  termsDays: [7, 14, 30] as const,
  minBorrow: 1_000_000n,
  maxBorrow: 5_000_000n,
  globalDebtCap: 8_000_000n,
  quoteValiditySeconds: 300,
  settlementValiditySeconds: 600,
} as const;

export const actionSchema = z.enum([
  "OPEN_ACCOUNT",
  "DEPOSIT",
  "SET_MANDATE",
  "CANCEL_MANDATE",
  "QUOTE_REQUEST",
  "BORROW_ACCEPT",
  "APPLY_REPAYMENT",
  "WITHDRAW_REQUEST",
  "RISK_TICK",
  "ACCOUNT_QUERY",
  "STRESS_QUERY",
]);

export const settlementSchema = z.object({
  protocolVersion: z.literal(1),
  settlementType: z.enum(["BORROW_PAYOUT", "USER_WITHDRAWAL", "CHECKPOINT"]),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^\d+$/),
  destination: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlementId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  previousSequence: z.number().int().nonnegative(),
  nextSequence: z.number().int().positive(),
  previousRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  nextRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  deadline: z.number().int().positive(),
});

export const deploymentManifestSchema = z.object({
  network: z.literal("coston2"),
  chainId: z.literal(114),
  quietPolicy: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  quietVault: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  extensionId: z.number().int().min(65_536),
  teeSigner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  codeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  assets: z.object({ fxrp: z.literal(ASSETS.FXRP.address), usdt0: z.literal(ASSETS.USDT0.address) }),
});

export type Action = z.infer<typeof actionSchema>;
export type Settlement = z.infer<typeof settlementSchema>;
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
