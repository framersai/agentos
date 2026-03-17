import { describe, expect, it, vi } from 'vitest';

import { AgentMemory } from '../../src/memory/AgentMemory.js';

function createManager(overrides: Record<string, unknown> = {}) {
  return {
    initialize: vi.fn(async () => undefined),
    encode: vi.fn(async () => ({ id: 'trace-1', content: 'hello memory' })),
    retrieve: vi.fn(async () => ({
      retrieved: [{ id: 'trace-1', content: 'hello memory', retrievalScore: 0.92 }],
      partiallyRetrieved: [],
      diagnostics: { totalCandidates: 1 },
    })),
    observe: vi.fn(async () => [{ content: 'note-1' }]),
    assembleForPrompt: vi.fn(async () => ({ prompt: 'context block', includedMemoryIds: ['trace-1'] })),
    registerProspective: vi.fn(async (input) => ({ id: 'pm-1', ...input })),
    listProspective: vi.fn(async () => [{ id: 'pm-1', content: 'follow up' }]),
    runConsolidation: vi.fn(async () => undefined),
    getMemoryHealth: vi.fn(async () => ({ status: 'ok' })),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  } as any;
}

describe('AgentMemory', () => {
  it('wrap() marks an existing manager as initialized and exposes raw', () => {
    const manager = createManager();
    const memory = AgentMemory.wrap(manager);

    expect(memory.isInitialized).toBe(true);
    expect(memory.raw).toBe(manager);
  });

  it('initialize() delegates once and becomes ready', async () => {
    const manager = createManager();
    const memory = new AgentMemory(manager);

    await memory.initialize({} as any);
    await memory.initialize({} as any);

    expect(manager.initialize).toHaveBeenCalledTimes(1);
    expect(memory.isInitialized).toBe(true);
  });

  it('throws from public methods when not initialized', async () => {
    const memory = new AgentMemory(createManager());

    await expect(memory.recall('preferences')).rejects.toThrow('AgentMemory not initialized');
  });

  it('remember() delegates with neutral mood defaults', async () => {
    const manager = createManager();
    const memory = AgentMemory.wrap(manager);

    const result = await memory.remember('User prefers dark mode', { tags: ['prefs'] });

    expect(result.success).toBe(true);
    expect(manager.encode).toHaveBeenCalledWith(
      'User prefers dark mode',
      { valence: 0, arousal: 0, dominance: 0 },
      'neutral',
      expect.objectContaining({
        type: 'episodic',
        scope: 'thread',
        sourceType: 'user_statement',
        tags: ['prefs'],
      }),
    );
  });

  it('remember() returns success false when encoding fails', async () => {
    const manager = createManager({
      encode: vi.fn(async () => {
        throw new Error('encoding failed');
      }),
    });
    const memory = AgentMemory.wrap(manager);

    const result = await memory.remember('broken');

    expect(result.success).toBe(false);
  });

  it('recall() and search() delegate to retrieve()', async () => {
    const manager = createManager();
    const memory = AgentMemory.wrap(manager);

    const recall = await memory.recall('dark mode', { limit: 5, tags: ['prefs'] });
    const search = await memory.search('dark mode', { limit: 5 });

    expect(recall.memories).toHaveLength(1);
    expect(search).toHaveLength(1);
    expect(manager.retrieve).toHaveBeenCalledWith(
      'dark mode',
      { valence: 0, arousal: 0, dominance: 0 },
      expect.objectContaining({ topK: 5 }),
    );
  });

  it('observe(), remind(), reminders(), consolidate(), and health() delegate cleanly', async () => {
    const manager = createManager();
    const memory = AgentMemory.wrap(manager);

    const notes = await memory.observe('user', 'Can you help with TMJ?');
    const reminder = await memory.remind({
      content: 'Follow up',
      triggerType: 'time',
      triggerAt: Date.now() + 60_000,
      metadata: {},
      importance: 0.7,
    } as any);
    const reminders = await memory.reminders();
    await memory.consolidate();
    const health = await memory.health();

    expect(notes).toEqual([{ content: 'note-1' }]);
    expect(reminder?.id).toBe('pm-1');
    expect(reminders).toHaveLength(1);
    expect(manager.runConsolidation).toHaveBeenCalledTimes(1);
    expect(health).toEqual({ status: 'ok' });
  });

  it('falls back gracefully when optional manager methods are unavailable', async () => {
    const manager = createManager({
      observe: undefined,
      registerProspective: undefined,
      listProspective: undefined,
      runConsolidation: undefined,
    });
    const memory = AgentMemory.wrap(manager);

    await expect(memory.observe('user', 'hello')).resolves.toBeNull();
    await expect(memory.remind({ content: 'later' } as any)).resolves.toBeNull();
    await expect(memory.reminders()).resolves.toEqual([]);
    await expect(memory.consolidate()).resolves.toBeUndefined();
  });

  it('shutdown() delegates and resets initialization state', async () => {
    const manager = createManager();
    const memory = AgentMemory.wrap(manager);

    await memory.shutdown();

    expect(manager.shutdown).toHaveBeenCalledTimes(1);
    expect(memory.isInitialized).toBe(false);
  });
});
