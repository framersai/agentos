import { describe, it, expect } from 'vitest';
import { MemoryTransplantPipeline } from '../MemoryTransplantPipeline.js';

function makeBrainJson(traces: Array<{ id: string; content: string; type?: string; tags?: string }>): string {
  return JSON.stringify({
    meta: { schema_version: '1' },
    traces: traces.map((t) => ({
      id: t.id,
      type: t.type ?? 'episodic',
      scope: 'user',
      content: t.content,
      strength: 1.0,
      created_at: Date.now(),
      retrieval_count: 0,
      tags: t.tags ?? '[]',
      emotions: '{}',
      metadata: '{}',
      deleted: 0,
    })),
    nodes: [],
    edges: [],
    documents: [],
    chunks: [],
    images: [],
    conversations: [],
    messages: [],
  });
}

describe('MemoryTransplantPipeline', () => {
  it('passes through player facts unchanged', async () => {
    const json = makeBrainJson([
      { id: 'mt_1', content: 'The player is a software engineer' },
    ]);

    const result = await MemoryTransplantPipeline.transform(json, {
      mode: 'heuristic',
      sourceIdentity: { name: 'Blackbeard' },
    });

    const parsed = JSON.parse(result.transformedJson);
    expect(parsed.traces).toHaveLength(1);
    expect(parsed.traces[0].content).toBe('The player is a software engineer');
    expect(result.transferred).toBe(1);
    expect(result.filtered).toBe(0);
  });

  it('filters self-referential traces', async () => {
    const json = makeBrainJson([
      { id: 'mt_1', content: 'I am a fearless pirate captain' },
      { id: 'mt_2', content: 'My name is Blackbeard and I sail the seas' },
      { id: 'mt_3', content: '[assistant] I was born on a ship' },
    ]);

    const result = await MemoryTransplantPipeline.transform(json, {
      mode: 'heuristic',
      sourceIdentity: { name: 'Blackbeard' },
    });

    const parsed = JSON.parse(result.transformedJson);
    expect(parsed.traces).toHaveLength(0);
    expect(result.filtered).toBe(3);
  });

  it('rewrites shared experiences in heuristic mode', async () => {
    const json = makeBrainJson([
      { id: 'mt_1', content: 'We discussed pineapple on pizza together' },
    ]);

    const result = await MemoryTransplantPipeline.transform(json, {
      mode: 'heuristic',
      sourceIdentity: { name: 'Blackbeard' },
    });

    const parsed = JSON.parse(result.transformedJson);
    expect(parsed.traces).toHaveLength(1);
    expect(parsed.traces[0].content).not.toContain('We ');
    expect(result.rewritten).toBe(1);
  });

  it('passes through world knowledge unchanged', async () => {
    const json = makeBrainJson([
      { id: 'mt_1', content: 'Paris is the capital of France', type: 'semantic' },
    ]);

    const result = await MemoryTransplantPipeline.transform(json, {
      mode: 'heuristic',
      sourceIdentity: { name: 'Blackbeard' },
    });

    const parsed = JSON.parse(result.transformedJson);
    expect(parsed.traces).toHaveLength(1);
    expect(parsed.traces[0].content).toBe('Paris is the capital of France');
  });

  it('adds transplant origin tags to surviving traces', async () => {
    const json = makeBrainJson([
      { id: 'mt_1', content: 'The player prefers dark mode', tags: '["preference"]' },
    ]);

    const result = await MemoryTransplantPipeline.transform(json, {
      mode: 'heuristic',
      sourceIdentity: { name: 'Blackbeard' },
    });

    const parsed = JSON.parse(result.transformedJson);
    const tags = JSON.parse(parsed.traces[0].tags);
    expect(tags).toContain('origin:transplant');
    expect(tags).toContain('source:companion-Blackbeard');
    expect(tags.some((t: string) => t.startsWith('transplanted_at:'))).toBe(true);
  });
});
