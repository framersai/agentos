import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Memory } from '../../facade/Memory.js';
import { createStandaloneMemoryLongTermRetriever } from '../StandaloneMemoryBridge.js';

describe('StandaloneMemoryBridge retrieval policy', () => {
  it('forwards retrieval policy to Memory.recall', async () => {
    const recall = vi.fn().mockResolvedValue([]);
    const retriever = createStandaloneMemoryLongTermRetriever({
      recall,
    } as any);

    await retriever.retrieveLongTermMemory({
      userId: 'user-1',
      conversationId: 'conv-1',
      personaId: 'persona-1',
      mode: 'chat',
      queryText: 'what ships friday',
      memoryPolicy: {
        enabled: true,
        scopes: { conversation: false, user: true, persona: false, organization: false },
        shareWithOrganization: false,
        storeAtomicDocs: true,
        allowedCategories: null,
        retrieval: null,
      },
      retrievalPolicy: { profile: 'balanced', minScore: 0.4 },
    });

    expect(recall).toHaveBeenCalledWith(
      'what ships friday',
      expect.objectContaining({
        policy: expect.objectContaining({ profile: 'balanced', minScore: 0.4 }),
      }),
    );
  });

  it('passes retrieval policy to Memory.recall and suppresses weak hits', async () => {
    const dbPath = path.join(
      os.tmpdir(),
      `agentos-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    );
    const memory = await Memory.create({ store: 'sqlite', path: dbPath });

    await memory.remember('Project Atlas ships Friday', {
      scope: 'user',
      scopeId: 'user-1',
      tags: ['shipping'],
    });

    const retriever = createStandaloneMemoryLongTermRetriever(memory);

    const strong = await retriever.retrieveLongTermMemory({
      userId: 'user-1',
      conversationId: 'conv-1',
      personaId: 'persona-1',
      mode: 'chat',
      queryText: 'what ships friday',
      memoryPolicy: {
        enabled: true,
        scopes: { conversation: false, user: true, persona: false, organization: false },
        shareWithOrganization: false,
        storeAtomicDocs: true,
        allowedCategories: null,
        retrieval: null,
      },
      retrievalPolicy: { profile: 'balanced', minScore: 0.000001 },
    });

    const weak = await retriever.retrieveLongTermMemory({
      userId: 'user-1',
      conversationId: 'conv-1',
      personaId: 'persona-1',
      mode: 'chat',
      queryText: 'nothing relevant here',
      memoryPolicy: {
        enabled: true,
        scopes: { conversation: false, user: true, persona: false, organization: false },
        shareWithOrganization: false,
        storeAtomicDocs: true,
        allowedCategories: null,
        retrieval: null,
      },
      retrievalPolicy: { profile: 'balanced', minScore: 0.95 },
    });

    expect(strong?.contextText).toContain('Project Atlas ships Friday');
    expect(weak).toBeNull();

    await memory.close();
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });
  });
});
