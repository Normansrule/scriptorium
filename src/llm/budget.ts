/**
 * Per-book spending cap and rate limiter.
 *
 * The cap is in tokens, not dollars, because token counts come back from the provider
 * exactly while prices change. The UI converts to dollars only if the user enters their
 * own per-million-token prices.
 *
 * Cap check before a call:   spent + maxTokens(request) ≤ cap
 * That is conservative: it assumes the reply could use every output token allowed.
 */

export class BudgetExceededError extends Error {}

export interface SpendEntry {
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  at: string;
}

export interface BudgetOptions {
  /** Maximum input + output tokens for the whole book. */
  capTokens: number;
  /** Maximum requests per minute. */
  requestsPerMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class Budget {
  readonly log: SpendEntry[] = [];
  #stamps: number[] = [];
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(readonly opts: BudgetOptions) {
    if (opts.capTokens <= 0) throw new Error('Spending cap must be positive.');
    if (opts.requestsPerMinute <= 0) throw new Error('Rate limit must be positive.');
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get spent(): number {
    return this.log.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
  }

  get remaining(): number {
    return Math.max(0, this.opts.capTokens - this.spent);
  }

  assertCanSpend(maxTokens: number, purpose: string): void {
    if (this.spent + maxTokens > this.opts.capTokens) {
      throw new BudgetExceededError(
        `Stopped before "${purpose}": it could use up to ${maxTokens.toLocaleString()} tokens but only ${this.remaining.toLocaleString()} remain under this book's cap of ${this.opts.capTokens.toLocaleString()}. Raise the cap in Settings to continue.`,
      );
    }
  }

  record(inputTokens: number, outputTokens: number, purpose: string): void {
    this.log.push({ purpose, inputTokens, outputTokens, at: new Date(this.#now()).toISOString() });
  }

  /** Sliding one-minute window. Resolves when another request is allowed. */
  async waitForSlot(): Promise<void> {
    for (;;) {
      const t = this.#now();
      this.#stamps = this.#stamps.filter((s) => t - s < 60_000);
      if (this.#stamps.length < this.opts.requestsPerMinute) {
        this.#stamps.push(t);
        return;
      }
      await this.#sleep(60_000 - (t - this.#stamps[0]!) + 5);
    }
  }

  /** Optional dollar estimate from user-supplied prices (USD per million tokens). */
  estimateUsd(inputPerM: number, outputPerM: number): number {
    const i = this.log.reduce((s, e) => s + e.inputTokens, 0);
    const o = this.log.reduce((s, e) => s + e.outputTokens, 0);
    return (i * inputPerM + o * outputPerM) / 1e6;
  }
}
