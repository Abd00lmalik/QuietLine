import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import type { Anchor, ChainClient } from "./chain.js";
import type { Job, Store } from "./db.js";
import type { FccClient, SubmissionTag } from "./fcc.js";

type DirectPayload = {
  source: "direct";
  command: string;
  ciphertext: Hex;
};

type ChainPayload = {
  source: "chain";
  command: string;
  requestId: Hex;
  blockNumber: string;
};

type SecureResponse = {
  anchor?: Anchor;
  ciphertext?: Hex;
};

type MutationResponse = {
  anchor?: Anchor;
  result?: unknown;
};

export type JobEvent = { type: "job.updated"; job: Job };

export class Orchestrator {
  readonly events = new EventEmitter();
  private running = false;
  private wakeRequested = false;

  constructor(
    private store: Store,
    private fcc: FccClient,
    private chain: ChainClient,
  ) {}

  enqueueDirect(account: Address, command: string, ciphertext: Hex) {
    const job = this.store.createJob(command, account, {
      source: "direct",
      command,
      ciphertext,
    } satisfies DirectPayload);
    this.wake();
    return job;
  }

  enqueueChain(
    account: Address,
    command: string,
    requestId: Hex,
    blockNumber: bigint,
    externalKey: string,
  ) {
    const job = this.store.createJob(
      command,
      account,
      {
        source: "chain",
        command,
        requestId,
        blockNumber: blockNumber.toString(),
      } satisfies ChainPayload,
      externalKey,
    );
    this.wake();
    return job;
  }

  retry(id: string) {
    const job = this.store.resetForRetry(id);
    this.emit(job);
    this.wake();
    return job;
  }

  wake() {
    this.wakeRequested = true;
    if (!this.running) void this.drain();
  }

  async idle() {
    while (this.running || this.wakeRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.wakeRequested = false;
        let job = this.store.nextRunnableJob();
        while (job) {
          await this.process(job);
          job = this.store.nextRunnableJob();
        }
      } while (this.wakeRequested);
    } finally {
      this.running = false;
    }
  }

  private async process(initial: Job) {
    let job = initial;
    try {
      job = this.update(job.id, {
        attempts: job.attempts + 1,
        error: undefined,
      });
      const payload = parsePayload(job.payload);
      const tag: SubmissionTag = payload.source === "direct" ? "submit" : "threshold";

      if (!job.actionId) {
        if (payload.source !== "direct") {
          job = this.update(job.id, { actionId: payload.requestId, status: "submitted" });
        } else {
          const actionId = await this.fcc.submitCiphertext(
            payload.command,
            payload.ciphertext,
          );
          job = this.update(job.id, { actionId, status: "submitted" });
        }
      }

      job = this.update(job.id, { status: "processing" });
      const action = await this.fcc.poll(job.actionId as Hex, tag);
      if (action.result.status !== 1) {
        throw new Error(action.result.log || `FCC action returned status ${action.result.status}`);
      }

      const response = action.result.data
        ? this.fcc.decode<SecureResponse | MutationResponse | Anchor>(action.result.data)
        : undefined;
      const anchor = findAnchor(response);
      job = this.update(job.id, { response });

      if (!anchor) {
        this.update(job.id, { status: "confirmed" });
        return;
      }

      job = this.update(job.id, { status: "settling" });
      const txHash = job.txHash ?? (await this.chain.execute(anchor));
      job = this.update(job.id, { txHash, status: "confirming" });

      const confirmationId = await this.fcc.submitJson("ANCHOR_CONFIRMED", {
        sequence: anchor.settlement.nextSequence,
        root: anchor.settlement.nextRoot,
      });
      const confirmation = await this.fcc.poll(confirmationId, "submit");
      if (confirmation.result.status !== 1) {
        throw new Error(
          confirmation.result.log ||
            `anchor confirmation returned status ${confirmation.result.status}`,
        );
      }
      this.update(job.id, { status: "confirmed" });
    } catch (error) {
      this.update(job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private update(id: string, patch: Parameters<Store["updateJob"]>[1]) {
    const job = this.store.updateJob(id, patch);
    this.emit(job);
    return job;
  }

  private emit(job: Job) {
    this.events.emit("job.updated", { type: "job.updated", job } satisfies JobEvent);
  }
}

function parsePayload(value: unknown): DirectPayload | ChainPayload {
  if (!value || typeof value !== "object" || !("source" in value)) {
    throw new Error("job payload is invalid");
  }
  return value as DirectPayload | ChainPayload;
}

function findAnchor(value: SecureResponse | MutationResponse | Anchor | undefined) {
  if (!value || typeof value !== "object") return undefined;
  if ("settlement" in value && "signature" in value) return value as Anchor;
  if ("anchor" in value && value.anchor) return value.anchor;
  return undefined;
}
