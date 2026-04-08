import { describe, it, expect, vi } from 'vitest';
import { MemoryReflector } from '../MemoryReflector.js';
import type { ObservationNote } from '../MemoryObserver.js';

describe('MemoryReflector', () => {
  const defaultTraits = {
    honesty: 0.5,
    emotionality: 0.8,
    extraversion: 0.5,
    agreeableness: 0.5,
    conscientiousness: 0.5,
    openness: 0.5,
  };

  function makeNote(overrides: Partial<ObservationNote> = {}): ObservationNote {
    return {
      id: `obs_${Date.now()}_${Math.random()}`,
      type: 'emotional',
      content: 'User shared they are feeling vulnerable about their job situation',
      importance: 0.8,
      entities: ['user'],
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it('produces relational traces from emotional/trust signals', async () => {
    const llmResponse = JSON.stringify({
      reasoning: 'User shared vulnerability about job — relational trust signal',
      type: 'relational',
      scope: 'user',
      scopeId: '',
      content: 'User shared vulnerability about job insecurity — trust-building moment',
      entities: ['user'],
      tags: ['trust', 'vulnerability'],
      confidence: 0.85,
      sourceType: 'reflection',
      supersedes: [],
      consumedNotes: ['note-1'],
    });

    const llmInvoker = vi.fn().mockResolvedValue(llmResponse);
    const reflector = new MemoryReflector(defaultTraits, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    const notes = [makeNote({ id: 'note-1' })];
    const result = await reflector.addNotes(notes);

    expect(result).not.toBeNull();
    expect(result!.traces.length).toBeGreaterThanOrEqual(1);
    expect(result!.traces[0].type).toBe('relational');
  });

  it('includes chain-of-thought reasoning in the prompt', async () => {
    const llmInvoker = vi.fn().mockResolvedValue('');
    const reflector = new MemoryReflector(defaultTraits, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    await reflector.addNotes([makeNote()]);

    const systemPrompt = llmInvoker.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('<thinking>');
    expect(systemPrompt).toContain('RELATIONSHIP SIGNALS');
    expect(systemPrompt).toContain('relational');
  });

  it('includes personality-biased relational sensitivity for high emotionality', async () => {
    const llmInvoker = vi.fn().mockResolvedValue('');
    const highEmotionality = { ...defaultTraits, emotionality: 0.9 };
    const reflector = new MemoryReflector(highEmotionality, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    await reflector.addNotes([makeNote()]);

    const systemPrompt = llmInvoker.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('emotional subtleties');
  });

  it('includes personality-biased social dynamics for high extraversion', async () => {
    const llmInvoker = vi.fn().mockResolvedValue('');
    const highExtraversion = { ...defaultTraits, extraversion: 0.9 };
    const reflector = new MemoryReflector(highExtraversion, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    await reflector.addNotes([makeNote()]);

    const systemPrompt = llmInvoker.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('social dynamics');
  });

  it('strips <thinking> blocks from LLM response when parsing traces', async () => {
    const llmResponse = [
      '<thinking>User revealed a fact about being an engineer.</thinking>',
      '{"type":"semantic","scope":"user","scopeId":"","content":"User is an engineer","entities":[],"tags":[],"confidence":0.9,"sourceType":"reflection","supersedes":[],"consumedNotes":["n1"]}',
    ].join('\n');

    const llmInvoker = vi.fn().mockResolvedValue(llmResponse);
    const reflector = new MemoryReflector(defaultTraits, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    const result = await reflector.addNotes([makeNote({ id: 'n1' })]);
    expect(result!.traces.length).toBe(1);
    expect(result!.traces[0].content).toBe('User is an engineer');
    // Thinking block should not appear as a trace
    expect(result!.traces.every(t => !t.content.includes('<thinking>'))).toBe(true);
  });

  it('preserves reasoning field on trace output for devtools', async () => {
    const llmResponse = '{"reasoning":"test reason","type":"semantic","scope":"user","scopeId":"","content":"A fact","entities":[],"tags":[],"confidence":0.9,"sourceType":"reflection","supersedes":[],"consumedNotes":["n1"]}';

    const llmInvoker = vi.fn().mockResolvedValue(llmResponse);
    const reflector = new MemoryReflector(defaultTraits, {
      activationThresholdTokens: 1,
      llmInvoker,
    });

    const result = await reflector.addNotes([makeNote({ id: 'n1' })]);
    expect((result!.traces[0] as any).reasoning).toBe('test reason');
  });
});
