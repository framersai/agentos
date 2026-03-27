import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveLongTermMemoryPolicy } from '../../src/core/conversation/LongTermMemoryPolicy.js';
import {
  Memory,
  buildStandaloneMemoryPersonaScopeId,
  createStandaloneMemoryDescriptor,
  createStandaloneMemoryLongTermRetriever,
  createStandaloneMemoryRollingSummarySink,
} from '../../src/memory/index.js';

const cleanupPaths: string[] = [];
const openMemories: Memory[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentos-standalone-memory-'));
  cleanupPaths.push(dir);
  return dir;
}

async function createMemory(overrides?: Record<string, unknown>): Promise<Memory> {
  const dir = await createTempDir();
  const dbPath = path.join(dir, 'brain.sqlite');
  const memory = await Memory.create({
    store: 'sqlite',
    path: dbPath,
    graph: false,
    selfImprove: true,
    decay: true,
    ...overrides,
  });
  openMemories.push(memory);
  return memory;
}

afterEach(async () => {
  for (const memory of openMemories) {
    try {
      await memory.close();
    } catch {
      // already closed
    }
  }
  openMemories.length = 0;

  for (const target of cleanupPaths) {
    await rm(target, { recursive: true, force: true });
  }
  cleanupPaths.length = 0;
});

describe('Standalone memory bridges', () => {
  it('adapts the standalone Memory facade as a memory-provider descriptor', async () => {
    const memory = await createMemory();
    const descriptor = createStandaloneMemoryDescriptor();

    await descriptor.payload.initialize({ memory });

    const traceId = await descriptor.payload.store('default', {
      content: 'User prefers release notes by email.',
      options: {
        type: 'semantic',
        scope: 'user',
        scopeId: 'user-1',
        tags: ['preferences'],
      },
    });

    expect(traceId).toMatch(/^mt_/);

    const results = (await descriptor.payload.query('default', {
      text: 'release notes',
      options: {
        scope: 'user',
        scopeId: 'user-1',
        limit: 5,
      },
    })) as Array<{ trace: { id: string; content: string } }>;

    expect(results).toHaveLength(1);
    expect(results[0]?.trace.content).toContain('release notes');

    await descriptor.payload.delete?.('default', [traceId]);

    const afterDelete = await memory.recall('release notes', {
      scope: 'user',
      scopeId: 'user-1',
    });
    expect(afterDelete).toHaveLength(0);

    const stats = await descriptor.payload.getStats?.();
    expect(stats).toMatchObject({
      documents: 0,
      size: 1,
    });
  });

  it('retrieves scoped long-term memory from the standalone Memory facade', async () => {
    const memory = await createMemory();
    const personaScopeId = buildStandaloneMemoryPersonaScopeId('user-1', 'designer');

    await memory.remember('Conversation preference: dashboard redesign this week.', {
      type: 'semantic',
      scope: 'thread',
      scopeId: 'conv-1',
    });
    await memory.remember('Persona preference: dense dashboard layouts.', {
      type: 'semantic',
      scope: 'persona',
      scopeId: personaScopeId,
    });
    await memory.remember('User preference: dark mode and keyboard shortcuts.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
    });

    const retriever = createStandaloneMemoryLongTermRetriever(memory);
    const policy = resolveLongTermMemoryPolicy({
      input: {
        enabled: true,
        scopes: {
          conversation: true,
          persona: true,
          user: true,
        },
      },
    });

    const result = await retriever.retrieveLongTermMemory({
      userId: 'user-1',
      conversationId: 'conv-1',
      personaId: 'designer',
      mode: 'chat',
      queryText: 'preference',
      memoryPolicy: policy,
      maxContextChars: 2000,
      topKByScope: {
        user: 3,
        persona: 3,
        organization: 3,
      },
    });

    expect(result?.contextText).toContain('Conversation Memory');
    expect(result?.contextText).toContain('Persona Memory');
    expect(result?.contextText).toContain('User Memory');
    expect(result?.contextText).toContain('dashboard redesign this week');
    expect(result?.contextText).toContain('dense dashboard layouts');
    expect(result?.contextText).toContain('dark mode and keyboard shortcuts');
    expect(result?.diagnostics).toMatchObject({
      totalHits: 3,
      scopes: {
        conversation: 1,
        persona: 1,
        user: 1,
      },
    });
  });

  it('persists rolling summaries and atomic docs into standalone memory with in-process upsert semantics', async () => {
    const memory = await createMemory();
    const sink = createStandaloneMemoryRollingSummarySink(memory);
    const policy = resolveLongTermMemoryPolicy({
      input: {
        enabled: true,
        scopes: {
          user: true,
          persona: true,
        },
        storeAtomicDocs: true,
      },
    });

    await sink.upsertRollingSummaryMemory({
      userId: 'user-1',
      sessionId: 'sess-1',
      conversationId: 'conv-1',
      personaId: 'designer',
      summaryText: '- User prefers keyboard shortcuts.\n- Alex owns the dashboard redesign.',
      summaryJson: {
        facts: [{ text: 'User prefers keyboard shortcuts.' }],
        people: [{ name: 'Alex', notes: 'Owns the dashboard redesign.' }],
        tags: ['dashboard'],
      },
      memoryPolicy: policy,
    });

    const userResults = await memory.recall('keyboard shortcuts', {
      scope: 'user',
      scopeId: 'user-1',
    });
    const personaResults = await memory.recall('Alex', {
      scope: 'persona',
      scopeId: buildStandaloneMemoryPersonaScopeId('user-1', 'designer'),
    });

    expect(userResults.length).toBeGreaterThanOrEqual(1);
    expect(personaResults.length).toBeGreaterThanOrEqual(1);

    await sink.upsertRollingSummaryMemory({
      userId: 'user-1',
      sessionId: 'sess-1',
      conversationId: 'conv-1',
      personaId: 'designer',
      summaryText: '- User prefers the command palette.',
      summaryJson: {
        facts: [{ text: 'User prefers the command palette.' }],
        tags: ['dashboard'],
      },
      memoryPolicy: policy,
    });

    const oldResults = await memory.recall('keyboard shortcuts', {
      scope: 'user',
      scopeId: 'user-1',
    });
    const newResults = await memory.recall('command palette', {
      scope: 'user',
      scopeId: 'user-1',
    });

    expect(oldResults).toHaveLength(0);
    expect(newResults.length).toBeGreaterThanOrEqual(1);
  });
});
