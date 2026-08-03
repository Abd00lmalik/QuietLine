import type { Address, Hex } from "viem";

const configuredBaseUrl = import.meta.env.VITE_RELAYER_URL?.trim();
const baseUrl = configuredBaseUrl
  ? configuredBaseUrl.replace(/\/+$/u, "")
  : "/api";

export type RelayerJob = {
  id: string;
  externalKey?: string;
  type: string;
  status:
    | "queued"
    | "submitted"
    | "processing"
    | "settling"
    | "confirming"
    | "confirmed"
    | "failed";
  account: Address;
  actionId?: Hex;
  txHash?: Hex;
  error?: string;
  response?: { ciphertext?: Hex; anchor?: unknown };
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

export async function getConfig() {
  return request<{
    vault: Address;
    network: {
      id: number;
      name: string;
      rpcUrl: string;
      explorerUrl: string;
      faucetUrl: string;
    };
    assets: {
      FXRP: { symbol: "FXRP"; address: Address; decimals: number };
      USDT0: { symbol: "USDT0"; address: Address; decimals: number };
    };
    policy: {
      termsDays: readonly number[];
      quoteValiditySeconds: number;
    };
    privacy: { private: string; public: string; trust: string };
  }>("/config");
}

export async function getAttestation() {
  return request<unknown>("/attestation");
}

export async function getMarket() {
  return request<{
    xrpUsdE6: number;
    updatedAt: number;
    vaultUsdt0Balance: string;
    termsDays: readonly number[];
  }>("/market");
}

export async function getHealth() {
  return request<{
    status: "ok" | "degraded";
    services: {
      api: "ok";
      database: "ok";
      fcc: "ok" | "unavailable";
    };
    network: string;
    timestamp: string;
  }>("/health");
}

export async function getChallenge(address: Address) {
  return request<{
    nonce: string;
    issuedAt: number;
    expiresAt: number;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, readonly { name: string; type: string }[]>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export async function verifyChallenge(input: {
  address: Address;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  signature: Hex;
}) {
  return request<{ token: string; expiresIn: number }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitDirect(
  route: string,
  input: { account: Address; ciphertext: Hex; command?: string },
  token: string,
) {
  return request<RelayerJob>(`/direct/${route}`, {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function getJob(id: string, token: string) {
  return request<RelayerJob>(`/jobs/${id}`, { token });
}

export async function listJobs(token: string) {
  return request<RelayerJob[]>("/jobs", { token });
}

export async function waitForJob(id: string, token: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await getJob(id, token);
    if (job.status === "confirmed") return job;
    if (job.status === "failed") throw new Error(job.error ?? "Confidential action failed");
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Quietline timed out waiting for confidential compute");
}

export async function waitForChainJob(
  requestId: Hex,
  token: string,
  timeoutMs = 120_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = await listJobs(token);
    const job = jobs.find(
      (candidate) =>
        candidate.externalKey === `chain:${requestId}`,
    );
    if (job) return waitForJob(job.id, token, timeoutMs - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Quietline timed out waiting for chain request ${requestId}`);
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Quietline API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}
