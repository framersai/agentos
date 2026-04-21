/**
 * @file SessionSummarizer.spec.ts
 * @description Unit tests for {@link SessionSummarizer}. Pins:
 *   - LLM invoker called exactly once per unique session (cache hits on re-call)
 *   - Disk cache survives across instances
 *   - Cache invalidates when model or template version changes
 *   - Content-addressed: same text → same cache key regardless of sessionKey label
 *   - Concurrent writes don't tear (EEXIST is handled)
 *   - Empty session text returns empty string without hitting LLM
 *   - Cost tracker hook fires only on uncached calls
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionSummarizer } from '../SessionSummarizer.js';

interface MockInvokerOptions {
  response?: string;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
}

function createMockInvoker(opts: MockInvokerOptions = {}) {
  const calls: Array<{ system: string; user: string }> = [];
  const response = opts.response ?? 'User discussed mortgage pre-approval with Wells Fargo for $350k.';
  const invoker = async (system: string, user: string) => {
    calls.push({ system, user });
    return {
      text: response,
      tokensIn: opts.tokensIn ?? 100,
      tokensOut: opts.tokensOut ?? 40,
      model: opts.model ?? 'gpt-5-mini',
    };
  };
  return { invoker, calls };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'session-summarizer-spec-'));
}

async function rmTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

describe('SessionSummarizer', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await makeTempDir();
  });
  afterEach(async () => {
    await rmTempDir(cacheDir);
  });

  describe('LLM invocation', () => {
    it('calls the invoker once and returns its output', async () => {
      const { invoker, calls } = createMockInvoker();
      const summarizer = new SessionSummarizer({ invoker, modelId: 'gpt-5-mini' });
      const summary = await summarizer.summarize('s1', 'user: hi\nassistant: hello');
      expect(summary).toBe('User discussed mortgage pre-approval with Wells Fargo for $350k.');
      expect(calls).toHaveLength(1);
      expect(summarizer.stats.misses).toBe(1);
      expect(summarizer.stats.hits).toBe(0);
    });

    it('trims whitespace from the LLM output', async () => {
      const { invoker } = createMockInvoker({ response: '\n  Session summary text.  \n' });
      const summarizer = new SessionSummarizer({ invoker, modelId: 'gpt-5-mini' });
      const summary = await summarizer.summarize('s1', 'text');
      expect(summary).toBe('Session summary text.');
    });

    it('returns empty string on empty input without calling the invoker', async () => {
      const { invoker, calls } = createMockInvoker();
      const summarizer = new SessionSummarizer({ invoker, modelId: 'gpt-5-mini' });
      expect(await summarizer.summarize('s1', '')).toBe('');
      expect(await summarizer.summarize('s2', '   \n\t ')).toBe('');
      expect(calls).toHaveLength(0);
    });
  });

  describe('disk cache', () => {
    it('reuses cached summary on re-call with same content', async () => {
      const { invoker, calls } = createMockInvoker();
      const summarizer = new SessionSummarizer({
        invoker,
        cacheDir,
        modelId: 'gpt-5-mini',
      });

      const text = 'user: I need a hotel in Miami\nassistant: what is your budget';
      const s1 = await summarizer.summarize('s1', text);
      const s2 = await summarizer.summarize('s1-again', text);

      expect(s1).toBe(s2);
      expect(calls).toHaveLength(1);
      expect(summarizer.stats.hits).toBe(1);
      expect(summarizer.stats.misses).toBe(1);
      expect(summarizer.stats.writes).toBe(1);
    });

    it('disk cache survives a new summarizer instance', async () => {
      const { invoker: invoker1, calls: calls1 } = createMockInvoker();
      const first = new SessionSummarizer({
        invoker: invoker1,
        cacheDir,
        modelId: 'gpt-5-mini',
      });
      await first.summarize('s1', 'session content');

      const { invoker: invoker2, calls: calls2 } = createMockInvoker({
        response: 'THIS SHOULD NOT APPEAR',
      });
      const second = new SessionSummarizer({
        invoker: invoker2,
        cacheDir,
        modelId: 'gpt-5-mini',
      });
      const summary = await second.summarize('s1-again', 'session content');

      expect(summary).toBe('User discussed mortgage pre-approval with Wells Fargo for $350k.');
      expect(calls1).toHaveLength(1);
      expect(calls2).toHaveLength(0);
      expect(second.stats.hits).toBe(1);
    });

    it('invalidates cache when modelId changes', async () => {
      const { invoker: inv1, calls: calls1 } = createMockInvoker({ response: 'mini summary' });
      await new SessionSummarizer({
        invoker: inv1,
        cacheDir,
        modelId: 'gpt-5-mini',
      }).summarize('s1', 'content');

      const { invoker: inv2, calls: calls2 } = createMockInvoker({ response: 'haiku summary' });
      const summary = await new SessionSummarizer({
        invoker: inv2,
        cacheDir,
        modelId: 'claude-haiku-3',
      }).summarize('s1', 'content');

      expect(summary).toBe('haiku summary');
      expect(calls1).toHaveLength(1);
      expect(calls2).toHaveLength(1);
    });

    it('invalidates cache when templateVersion changes', async () => {
      const { invoker: inv1, calls: calls1 } = createMockInvoker({ response: 'v1 summary' });
      await new SessionSummarizer({
        invoker: inv1,
        cacheDir,
        modelId: 'gpt-5-mini',
        templateVersion: 'v1',
      }).summarize('s1', 'content');

      const { invoker: inv2, calls: calls2 } = createMockInvoker({ response: 'v2 summary' });
      const summary = await new SessionSummarizer({
        invoker: inv2,
        cacheDir,
        modelId: 'gpt-5-mini',
        templateVersion: 'v2',
      }).summarize('s1', 'content');

      expect(summary).toBe('v2 summary');
      expect(calls1).toHaveLength(1);
      expect(calls2).toHaveLength(1);
    });

    it('cache key is content-addressed, sessionKey argument is cosmetic', async () => {
      const { invoker, calls } = createMockInvoker();
      const summarizer = new SessionSummarizer({
        invoker,
        cacheDir,
        modelId: 'gpt-5-mini',
      });

      await summarizer.summarize('conv-26-s0', 'identical session text');
      await summarizer.summarize('conv-99-s42', 'identical session text');

      expect(calls).toHaveLength(1);
      expect(summarizer.stats.hits).toBe(1);
    });

    it('different content produces different cache keys', async () => {
      const { invoker } = createMockInvoker();
      const summarizer = new SessionSummarizer({
        invoker,
        cacheDir,
        modelId: 'gpt-5-mini',
      });
      const key1 = summarizer.computeCacheKey('session A');
      const key2 = summarizer.computeCacheKey('session B');
      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('works without cacheDir — every call hits the LLM', async () => {
      const { invoker, calls } = createMockInvoker();
      const summarizer = new SessionSummarizer({ invoker, modelId: 'gpt-5-mini' });
      await summarizer.summarize('s1', 'content');
      await summarizer.summarize('s2', 'content');
      expect(calls).toHaveLength(2);
      expect(summarizer.stats.writes).toBe(0);
    });
  });

  describe('cost tracking', () => {
    it('fires onCallCost hook only on uncached calls', async () => {
      const { invoker } = createMockInvoker({ tokensIn: 200, tokensOut: 50, model: 'gpt-5-mini' });
      const costCalls: Array<{ tokensIn: number; tokensOut: number; model: string }> = [];
      const summarizer = new SessionSummarizer({
        invoker,
        cacheDir,
        modelId: 'gpt-5-mini',
        onCallCost: (tokensIn, tokensOut, model) => costCalls.push({ tokensIn, tokensOut, model }),
      });

      await summarizer.summarize('s1', 'new content A');
      await summarizer.summarize('s2', 'new content A'); // cache hit — should NOT fire
      await summarizer.summarize('s3', 'new content B');

      expect(costCalls).toHaveLength(2);
      expect(costCalls[0]).toEqual({ tokensIn: 200, tokensOut: 50, model: 'gpt-5-mini' });
      expect(summarizer.stats.tokensIn).toBe(400);
      expect(summarizer.stats.tokensOut).toBe(100);
    });
  });

  describe('concurrency safety', () => {
    it('two concurrent summarize() calls with same content do not corrupt cache', async () => {
      const { invoker } = createMockInvoker();
      const summarizer = new SessionSummarizer({
        invoker,
        cacheDir,
        modelId: 'gpt-5-mini',
      });

      const [s1, s2] = await Promise.all([
        summarizer.summarize('s1', 'concurrent text'),
        summarizer.summarize('s2', 'concurrent text'),
      ]);

      expect(s1).toBe(s2);
      // At least one write succeeded. Cache file must exist and be readable.
      const cacheKey = summarizer.computeCacheKey('concurrent text');
      const cacheFile = path.join(cacheDir, `${cacheKey}.txt`);
      const contents = await fs.readFile(cacheFile, 'utf8');
      expect(contents).toBe('User discussed mortgage pre-approval with Wells Fargo for $350k.');
    });
  });
});
