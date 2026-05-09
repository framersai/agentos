import { describe, it, expect, vi } from 'vitest';
import { FactExtractor, type FactExtractorSession } from '../FactExtractor.js';

function session(turns: FactExtractorSession['turns']): FactExtractorSession {
  return { sessionId: 's1', date: '2026-04-15', turns };
}

describe('FactExtractor', () => {
  it('calls the LLM once per session + parses valid JSON output', async () => {
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify([
        { subject: 'user', predicate: 'livesIn', object: 'Berlin', sourceSpan: 'I moved to Berlin' },
      ]),
    );
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([
      { role: 'user', content: 'I moved to Berlin in March.' },
    ]));
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.subject).toBe('user');
    expect(facts[0]!.predicate).toBe('livesIn');
    expect(facts[0]!.object).toBe('Berlin');
  });

  it('drops facts with predicates outside the schema', async () => {
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify([
        { subject: 'user', predicate: 'mentioned', object: 'stuff', sourceSpan: '...' },
        { subject: 'user', predicate: 'prefers', object: 'tea', sourceSpan: 'I prefer tea' },
      ]),
    );
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([
      { role: 'user', content: 'I prefer tea.' },
    ]));
    expect(facts).toHaveLength(1);
    expect(facts[0]!.predicate).toBe('prefers');
  });

  it('preserves literal object tokens (no paraphrase)', async () => {
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify([
        { subject: 'user', predicate: 'purchased', object: '$350,000 home', sourceSpan: 'bought a $350,000 home' },
      ]),
    );
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([
      { role: 'user', content: 'I bought a $350,000 home.' },
    ]));
    expect(facts[0]!.object).toBe('$350,000 home');
  });

  it('tolerates code-fenced JSON', async () => {
    const invoker = vi.fn().mockResolvedValue(
      '```json\n[{"subject":"user","predicate":"prefers","object":"tea","sourceSpan":"I prefer tea"}]\n```',
    );
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([{ role: 'user', content: 'anything' }]));
    expect(facts).toHaveLength(1);
    expect(facts[0]!.object).toBe('tea');
  });

  it('returns [] on malformed LLM output rather than throwing', async () => {
    const invoker = vi.fn().mockResolvedValue('not valid json at all');
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([{ role: 'user', content: 'anything' }]));
    expect(facts).toEqual([]);
  });

  it('caches by session content + fingerprint', async () => {
    const invoker = vi.fn().mockResolvedValue(JSON.stringify([]));
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const s = session([{ role: 'user', content: 'deterministic' }]);
    await ex.extract(s);
    await ex.extract(s);
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('cache invalidates when fingerprint changes', async () => {
    const invoker = vi.fn().mockResolvedValue(JSON.stringify([]));
    const s = session([{ role: 'user', content: 'deterministic' }]);
    const exV1 = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    await exV1.extract(s);
    const exV2 = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v2-test' });
    await exV2.extract(s);
    expect(invoker).toHaveBeenCalledTimes(2);
  });

  it('drops items missing required fields', async () => {
    const invoker = vi.fn().mockResolvedValue(
      JSON.stringify([
        { subject: 'user', predicate: 'prefers' }, // missing object + sourceSpan
        { predicate: 'prefers', object: 'tea', sourceSpan: 'I prefer tea' }, // missing subject
        { subject: 'user', predicate: 'prefers', object: 'coffee', sourceSpan: 'I prefer coffee' }, // ok
      ]),
    );
    const ex = new FactExtractor({ llmInvoker: invoker, cacheFingerprint: 'v1-test' });
    const facts = await ex.extract(session([{ role: 'user', content: 'x' }]));
    expect(facts).toHaveLength(1);
    expect(facts[0]!.object).toBe('coffee');
  });
});
