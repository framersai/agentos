import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveLongTermMemoryPolicy } from '../../src/core/conversation/LongTermMemoryPolicy';
import {
  Memory,
  buildStandaloneMemoryPersonaScopeId,
  createStandaloneMemoryLongTermRetriever,
  createStandaloneMemoryRollingSummarySink,
} from '../../src/memory';

const cleanupPaths: string[] = [];
const openMemories: Memory[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentos-memory-persistence-'));
  cleanupPaths.push(dir);
  return dir;
}

function openMemory(dbPath: string): Memory {
  const memory = new Memory({
    store: 'sqlite',
    path: dbPath,
    graph: false,
    selfImprove: true,
    decay: true,
  });
  openMemories.push(memory);
  return memory;
}

afterEach(async () => {
  for (const memory of openMemories.splice(0)) {
    try {
      await memory.close();
    } catch {
      // already closed
    }
  }

  for (const target of cleanupPaths.splice(0)) {
    await rm(target, { recursive: true, force: true });
  }
});

describe('Standalone memory persistence e2e', () => {
  it('persists scoped traces and rolling-summary docs across SQLite restarts', async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, 'brain.sqlite');
    const personaScopeId = buildStandaloneMemoryPersonaScopeId('user-1', 'designer');
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

    const firstMemory = openMemory(dbPath);
    await firstMemory.remember('User preference: command palette first.', {
      type: 'semantic',
      scope: 'user',
      scopeId: 'user-1',
      tags: ['preferences'],
    });
    await firstMemory.remember('Persona preference: dense dashboard layouts.', {
      type: 'semantic',
      scope: 'persona',
      scopeId: personaScopeId,
      tags: ['preferences'],
    });

    const sink = createStandaloneMemoryRollingSummarySink(firstMemory);
    await sink.upsertRollingSummaryMemory({
      userId: 'user-1',
      sessionId: 'session-1',
      conversationId: 'conv-1',
      personaId: 'designer',
      summaryText:
        '- User prefers keyboard shortcuts.\n- Alex owns the dashboard redesign.',
      summaryJson: {
        facts: [{ text: 'User prefers keyboard shortcuts.' }],
        people: [{ name: 'Alex', notes: 'Owns the dashboard redesign.' }],
        tags: ['dashboard'],
      },
      memoryPolicy: policy,
    });

    await firstMemory.close();

    const reopenedMemory = openMemory(dbPath);

    const userHits = await reopenedMemory.recall('command palette', {
      scope: 'user',
      scopeId: 'user-1',
      limit: 5,
    });
    const personaHits = await reopenedMemory.recall('dense dashboard', {
      scope: 'persona',
      scopeId: personaScopeId,
      limit: 5,
    });
    const factHits = await reopenedMemory.recall('keyboard shortcuts', {
      scope: 'user',
      scopeId: 'user-1',
      limit: 5,
    });
    const peopleHits = await reopenedMemory.recall('Alex', {
      scope: 'persona',
      scopeId: personaScopeId,
      limit: 5,
    });

    expect(userHits.some((hit) => hit.trace.content.includes('command palette first'))).toBe(
      true,
    );
    expect(
      personaHits.some((hit) => hit.trace.content.includes('dense dashboard layouts')),
    ).toBe(true);
    expect(
      factHits.some((hit) => hit.trace.content.includes('keyboard shortcuts')),
    ).toBe(true);
    expect(peopleHits.some((hit) => hit.trace.content.includes('Alex'))).toBe(true);

    const retriever = createStandaloneMemoryLongTermRetriever(reopenedMemory);
    const retrieval = await retriever.retrieveLongTermMemory({
      userId: 'user-1',
      conversationId: 'conv-1',
      personaId: 'designer',
      mode: 'chat',
      queryText: 'command palette dashboard Alex',
      memoryPolicy: policy,
      maxContextChars: 2000,
      topKByScope: {
        user: 5,
        persona: 5,
        organization: 5,
      },
    });

    expect(retrieval?.contextText).toContain('Persona Memory');
    expect(retrieval?.contextText).toContain('User Memory');
    expect(retrieval?.contextText).toContain('command palette first');
    expect(retrieval?.contextText).toContain('dense dashboard layouts');
    expect(retrieval?.contextText).toContain('Alex');
  });
});
