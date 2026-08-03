import type { ChainClient } from "./chain.js";
import type { Store } from "./db.js";
import type { Orchestrator } from "./orchestrator.js";

const CURSOR = "quiet_vault";
const MAX_BLOCK_RANGE = 2_000n;

export class Indexer {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(
    private store: Store,
    private chain: ChainClient,
    private orchestrator: Orchestrator,
    private startBlock: bigint,
    private intervalMs: number,
    private onError: (error: unknown) => void,
  ) {}

  start() {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const latest = await this.chain.blockNumber();
      let cursor = this.store.getCursor(CURSOR, this.startBlock);
      while (cursor <= latest) {
        const toBlock =
          cursor + MAX_BLOCK_RANGE - 1n < latest
            ? cursor + MAX_BLOCK_RANGE - 1n
            : latest;
        const events = await this.chain.events(cursor, toBlock);
        for (const event of events) {
          this.orchestrator.enqueueChain(
            event.account,
            event.command,
            event.requestId,
            event.blockNumber,
            event.externalKey,
          );
        }
        cursor = toBlock + 1n;
        this.store.setCursor(CURSOR, cursor);
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.polling = false;
    }
  }
}
