import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("data/relayer.db"),
  SESSION_SECRET: z.string().min(32),
  OPERATIONS_API_KEY: z.string().min(32),
  FCC_PROXY_URL: z.string().url(),
  DIRECT_API_KEY: z.string().min(32),
  COSTON2_RPC_URL: z.string().url().default("https://coston2-api.flare.network/ext/C/rpc"),
  QUIET_VAULT: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  START_BLOCK: z.coerce.bigint(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2_000),
  RISK_TICK_INTERVAL_MS: z.coerce.number().int().min(30_000).default(60_000),
  FCC_INSTRUCTION_FEE_WEI: z.coerce.bigint().default(1_000_000n),
});

export type Config = z.infer<typeof envSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => envSchema.parse(env);
