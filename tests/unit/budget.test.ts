import { describe, expect, it } from 'vitest';
import { Budget, BudgetExceededError } from '../../src/llm/budget.ts';
import { AnthropicProvider, callModel, ProviderError, ReplayProvider } from '../../src/llm/provider.ts';

describe('spending cap and rate limit', () => {
  it('refuses a call that could exceed the cap (README worked example)', () => {
    const b = new Budget({ capTokens: 400_000, requestsPerMinute: 10 });
    b.record(300_000, 96_500, 'x');
    expect(() => b.assertCanSpend(6000, 'draft')).toThrow(BudgetExceededError);
    expect(() => b.assertCanSpend(3500, 'next')).not.toThrow();
  });

  it('waits when the per-minute limit is reached', async () => {
    let t = 0;
    const slept: number[] = [];
    const b = new Budget({ capTokens: 1e6, requestsPerMinute: 2, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    await b.waitForSlot();
    await b.waitForSlot();
    await b.waitForSlot();
    expect(slept.length).toBe(1);
    expect(slept[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('records tokens from the provider', async () => {
    const b = new Budget({ capTokens: 1e6, requestsPerMinute: 100 });
    await callModel(new ReplayProvider(['{"ok":true}']), b, { system: 's', prompt: 'p', maxTokens: 100, purpose: 't' });
    expect(b.log).toHaveLength(1);
    expect(b.spent).toBeGreaterThan(0);
  });
});

describe('API key handling', () => {
  it('never serializes the key', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-secret-123' });
    expect(JSON.stringify(p)).not.toContain('secret');
    expect(JSON.stringify({ p })).not.toContain('secret');
  });

  it('sends the key only to api.anthropic.com and keeps it out of errors', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 });
    }) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'sk-ant-secret-123', fetchImpl });
    const err = (await p.complete({ system: 's', prompt: 'p', maxTokens: 10, purpose: 't' }).catch((e) => e)) as ProviderError;
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(err.message).not.toContain('secret');
    expect(err.status).toBe(400);
  });
});
