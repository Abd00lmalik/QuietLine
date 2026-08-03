import type { ChainClient } from "./chain.js";

export class RiskKeeper {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private chain: ChainClient,
    private intervalMs: number,
    private onError: (error: unknown) => void,
  ) {}

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.chain.requestRiskTick();
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
    }
  }
}
