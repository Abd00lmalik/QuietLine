import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { timingSafeEqual } from "node:crypto";
import { ASSETS, COSTON2, POLICY } from "@quietline/protocol";
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Auth } from "./auth.js";
import type { Config } from "./config.js";
import type { Job, Store } from "./db.js";
import type { FccClient } from "./fcc.js";
import type { Orchestrator } from "./orchestrator.js";

const addressSchema = z.string().refine(isAddress, "invalid EVM address");
const hexSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const challengeSchema = z.object({ address: addressSchema });
const verifySchema = z.object({
  address: addressSchema,
  nonce: z.string().length(48),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});
const directSchema = z.object({
  account: addressSchema,
  ciphertext: hexSchema,
  command: z.string().optional(),
});

const directCommands: Record<string, string | readonly string[]> = {
  "open-account": "OPEN_ACCOUNT",
  account: "ACCOUNT_QUERY",
  activity: "ACCOUNT_QUERY",
  mandate: ["SET_MANDATE", "CANCEL_MANDATE", "WITHDRAW_FROM_MANDATE"],
  quote: "QUOTE_REQUEST",
  repayment: "APPLY_REPAYMENT",
  stress: "STRESS_QUERY",
  export: "ACCOUNT_QUERY",
};

type Dependencies = {
  config: Config;
  store: Store;
  auth: Auth;
  fcc: FccClient;
  orchestrator: Orchestrator;
  chain: import("./chain.js").ChainClient;
};

class FccReadinessError extends Error {}

export function buildServer(deps: Dependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.x-quietline-operations-key",
        "req.query.session",
        "req.body.ciphertext",
      ],
    },
    bodyLimit: 64 * 1024,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
    const origin = request.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header(
        "access-control-allow-headers",
        "authorization, content-type, ngrok-skip-browser-warning",
      );
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    if (request.method === "OPTIONS") return reply.status(204).send();
  });

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      error instanceof z.ZodError
        ? 400
        : error instanceof FccReadinessError
          ? 503
          : message.includes("session")
            ? 401
            : 500;
    if (statusCode === 500) {
      request.log.error({ error }, "request failed");
    }
    reply.status(statusCode).send({
      error: statusCode === 500 ? "request_failed" : "invalid_request",
      message: statusCode === 500 ? "Quietline could not complete the request." : message,
    });
  });

  app.get("/health", async () => {
    let fcc: "ok" | "unavailable" | "signer_mismatch" = "ok";
    let detail: string | undefined;
    try {
      await assertFccReady(deps);
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      fcc = error instanceof FccReadinessError ? "signer_mismatch" : "unavailable";
    }
    const machineState = await deps.chain.fccMachineState().catch(() => undefined);
    return {
      status: fcc === "ok" ? "ok" : "degraded",
      services: { api: "ok", database: "ok", fcc },
      fccMachine: {
        activeCount: machineState?.active.length ?? 0,
        activeSigners: machineState?.active.map((machine) => machine.teeId) ?? [],
      },
      ...(detail ? { detail } : {}),
      network: COSTON2.name,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/config", async () => ({
    network: COSTON2,
    vault: deps.config.QUIET_VAULT,
    assets: ASSETS,
    policy: {
      termsDays: POLICY.termsDays,
      quoteValiditySeconds: POLICY.quoteValiditySeconds,
    },
    privacy: {
      private:
        "Balances, credit requests, lender mandates, loan terms, debt, health, and risk calculations.",
      public:
        "Wallet addresses, deposits, payouts, withdrawals, transaction timing, and state commitments.",
      trust:
        "The active Flare confidential environment sees plaintext while computing.",
    },
  }));

  app.get("/market", async () => ({
    ...(await deps.chain.market()),
    termsDays: POLICY.termsDays,
  }));

  app.get("/attestation", async () => deps.fcc.info());

  app.get(
    "/operations/job",
    { preHandler: operationsAuthenticated(deps.config.OPERATIONS_API_KEY) },
    async (request, reply) => {
      const query = z.object({ externalKey: z.string().min(1).max(256) }).parse(request.query);
      const job = deps.store.getJobByExternalKey(query.externalKey);
      if (!job) return reply.status(404).send({ error: "job_not_found" });
      return publicJob(job, false);
    },
  );

  app.post("/auth/challenge", async (request) => {
    const body = challengeSchema.parse(request.body);
    return deps.auth.challenge(body.address as Address);
  });

  app.post("/auth/verify", async (request) => {
    const body = verifySchema.parse(request.body);
    const token = await deps.auth.createSession(
      body.address as Address,
      body.nonce,
      body.issuedAt,
      body.expiresAt,
      body.signature as Hex,
    );
    return { token, expiresIn: 1800 };
  });

  for (const [route, allowed] of Object.entries(directCommands)) {
    app.post(
      `/direct/${route}`,
      { preHandler: authenticated(deps.auth) },
      async (request, reply) => {
        await assertFccReady(deps);
        const session = sessionFor(request);
        const body = directSchema.parse(request.body);
        if (body.account.toLowerCase() !== session.sub) {
          return reply.status(403).send({
            error: "account_mismatch",
            message: "The encrypted request account must match the active session.",
          });
        }
        const command = resolveCommand(allowed, body.command);
        const job = deps.orchestrator.enqueueDirect(
          body.account as Address,
          command,
          body.ciphertext as Hex,
        );
        return reply.status(202).send(publicJob(job, true));
      },
    );
  }

  app.get(
    "/jobs/:jobId",
    { preHandler: authenticated(deps.auth) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = deps.store.getJob(jobId);
      if (!job) return reply.status(404).send({ error: "job_not_found" });
      if (job.account !== sessionFor(request).sub) {
        return reply.status(403).send({ error: "job_account_mismatch" });
      }
      return publicJob(job, true);
    },
  );

  app.get("/jobs", { preHandler: authenticated(deps.auth) }, async (request) => {
    return deps.store.listJobs(sessionFor(request).sub).map((job) => publicJob(job, false));
  });

  app.post(
    "/relay/retry/:jobId",
    { preHandler: authenticated(deps.auth) },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = deps.store.getJob(jobId);
      if (!job) return reply.status(404).send({ error: "job_not_found" });
      if (job.account !== sessionFor(request).sub) {
        return reply.status(403).send({ error: "job_account_mismatch" });
      }
      return reply.status(202).send(publicJob(deps.orchestrator.retry(jobId), false));
    },
  );

  app.get("/events", async (request, reply) => {
    const query = z.object({ session: z.string().min(1) }).parse(request.query);
    const session = deps.auth.verify(query.session);
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ account: session.sub })}\n\n`);
    const listener = (event: { job: Job }) => {
      if (event.job.account === session.sub) {
        response.write(`event: job.updated\ndata: ${JSON.stringify(publicJob(event.job, false))}\n\n`);
      }
    };
    deps.orchestrator.events.on("job.updated", listener);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      deps.orchestrator.events.off("job.updated", listener);
    });
  });

  return app;
}

async function assertFccReady(deps: Pick<Dependencies, "fcc" | "chain">) {
  const [machineSigner, activeSigner, machineState] = await Promise.all([
    deps.fcc.machineSigner(),
    deps.chain.activeTeeSigner(),
    deps.chain.fccMachineState(),
  ]);
  if (machineSigner.toLowerCase() !== activeSigner.toLowerCase()) {
    throw new FccReadinessError(
      "FCC signer mismatch. Confidential mutations are paused until the active machine is registered.",
    );
  }
  const active = machineState.active.filter((machine) => machine.status === 2);
  if (
    active.length !== 1 ||
    active[0]?.teeId.toLowerCase() !== activeSigner.toLowerCase()
  ) {
    throw new FccReadinessError(
      `FCC registry must contain exactly one production machine for this extension; found ${active.length}.`,
    );
  }
}

function authenticated(auth: Auth) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "session_required" });
    }
    try {
      (request as FastifyRequest & { quietlineSession: { sub: string; exp: number } })
        .quietlineSession = auth.verify(header.slice(7));
    } catch (error) {
      return reply.status(401).send({
        error: "invalid_session",
        message: error instanceof Error ? error.message : "Session is invalid.",
      });
    }
  };
}

function operationsAuthenticated(expected: string) {
  const expectedBytes = Buffer.from(expected);
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const supplied = request.headers["x-quietline-operations-key"];
    const suppliedValue = Array.isArray(supplied) ? supplied[0] : supplied;
    if (
      !suppliedValue ||
      Buffer.byteLength(suppliedValue) !== expectedBytes.length ||
      !timingSafeEqual(Buffer.from(suppliedValue), expectedBytes)
    ) {
      return reply.status(401).send({ error: "operations_auth_required" });
    }
  };
}

function sessionFor(request: FastifyRequest) {
  return (
    request as FastifyRequest & {
      quietlineSession: { sub: string; exp: number };
    }
  ).quietlineSession;
}

function resolveCommand(allowed: string | readonly string[], requested?: string) {
  if (typeof allowed === "string") {
    if (requested && requested !== allowed) throw new Error("direct command is not allowed");
    return allowed;
  }
  if (!requested || !allowed.includes(requested)) {
    throw new Error(`direct command must be one of: ${allowed.join(", ")}`);
  }
  return requested;
}

function publicJob(job: Job, includeResponse: boolean) {
  return {
    id: job.id,
    externalKey: job.externalKey,
    type: job.type,
    status: job.status,
    account: job.account,
    actionId: job.actionId,
    txHash: job.txHash,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(includeResponse && job.response !== undefined ? { response: job.response } : {}),
  };
}

function isAllowedOrigin(origin: string) {
  if (process.env.FRONTEND_ORIGIN) return origin === process.env.FRONTEND_ORIGIN;
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(origin);
}
