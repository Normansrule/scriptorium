/**
 * Model providers. The only network call that carries the user's API key goes through
 * here, and only to the provider's own endpoint. The key is passed in per call and is
 * never stored by this module, logged, or included in thrown errors.
 */
import type { Budget } from './budget.ts';

export interface ChatRequest {
  system: string;
  /** The user turn. Untrusted material must already be wrapped by untrusted.ts. */
  prompt: string;
  maxTokens: number;
  /** Label for the spending log, e.g. "draft ch-1/sec-2". */
  purpose: string;
}

export interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  complete(req: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface AnthropicOptions {
  apiKey: string;
  /** See https://docs.claude.com/en/docs/about-claude/models/overview for current model ids. */
  model?: string;
  /** Set when calling straight from a browser (the GitHub Pages app). */
  browser?: boolean;
  fetchImpl?: typeof fetch;
}

/** Anthropic Messages API (https://docs.claude.com/en/api/messages). */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly #key: string; // private field: not enumerable, not serialized by JSON.stringify
  readonly #browser: boolean;
  readonly #fetch: typeof fetch;

  constructor(opts: AnthropicOptions) {
    if (!opts.apiKey?.trim()) throw new ProviderError('No API key set. Add one in Settings (it stays on this device).');
    this.#key = opts.apiKey.trim();
    this.model = opts.model ?? 'claude-sonnet-5-5';
    this.#browser = opts.browser ?? false;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  toJSON() {
    return { name: this.name, model: this.model }; // never the key
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.#key,
      'anthropic-version': '2023-06-01',
    };
    if (this.#browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';

    const res = await this.#fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });

    if (!res.ok) {
      const retry = Number(res.headers.get('retry-after'));
      // Read the provider's error message but never echo request headers back.
      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body.error?.message ?? '';
      } catch {
        /* ignore */
      }
      throw new ProviderError(`Model provider returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status, Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined);
    }

    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };
    return {
      text: body.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''),
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
      stopReason: body.stop_reason,
    };
  }
}

/**
 * Replays recorded responses. Used by tests, the demo mode, and CI — no key, no network.
 */
export class ReplayProvider implements Provider {
  readonly name = 'replay';
  readonly model = 'replay';
  #i = 0;
  constructor(private readonly responses: Array<string | ((req: ChatRequest) => string)>) {}
  async complete(req: ChatRequest): Promise<ChatResponse> {
    const r = this.responses[this.#i++ % this.responses.length]!;
    const text = typeof r === 'function' ? r(req) : r;
    return { text, inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4), outputTokens: Math.ceil(text.length / 4), stopReason: 'end_turn' };
  }
}

/**
 * Wraps a provider with the spending cap, the rate limiter and retries.
 * Every stage calls the model through this, never through a raw provider.
 */
export async function callModel(provider: Provider, budget: Budget, req: ChatRequest): Promise<ChatResponse> {
  budget.assertCanSpend(req.maxTokens, req.purpose);
  let attempt = 0;
  for (;;) {
    await budget.waitForSlot();
    try {
      const res = await provider.complete(req);
      budget.record(res.inputTokens, res.outputTokens, req.purpose);
      return res;
    } catch (e) {
      const err = e as ProviderError;
      const retryable = err.status === 429 || err.status === 529 || (err.status !== undefined && err.status >= 500);
      if (!retryable || attempt >= 3) throw err;
      const wait = err.retryAfterMs ?? 1000 * 2 ** attempt;
      attempt++;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
