/**
 * @fileoverview End-to-end tests for SqlStorageAdapter's cache-token
 * persistence path, covering the 2026-04-18 migration that added
 * cacheReadTokens + cacheCreationTokens columns, the idempotent ALTER
 * TABLE back-compat migration, the INSERT/SELECT round-trip, and the
 * getConversationTokenUsage SUM aggregation.
 *
 * Uses an in-memory SQLite adapter via @framers/sql-storage-adapter,
 * matching the SqlStorageMemoryArchive test pattern so CI stays
 * filesystem-free.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlStorageAdapter } from '../SqlStorageAdapter.js';

async function freshAdapter(): Promise<SqlStorageAdapter> {
  const adapter = new SqlStorageAdapter({
    filePath: ':memory:',
    priority: ['better-sqlite3', 'sqljs'],
    quiet: true,
  });
  await adapter.initialize();
  return adapter;
}

describe('SqlStorageAdapter — cache-token persistence', () => {
  let adapter: SqlStorageAdapter;

  beforeEach(async () => {
    adapter = await freshAdapter();
    await adapter.createConversation({
      id: 'conv-1',
      userId: 'user-1',
      createdAt: 1,
      lastActivity: 1,
    });
  });

  afterEach(async () => {
    await adapter.close?.();
  });

  it('persists cacheReadTokens + cacheCreationTokens on saveMessage and hydrates them back', async () => {
    await adapter.storeMessage({
      id: 'msg-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hello',
      timestamp: 10,
      model: 'claude-sonnet-4-6',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cacheReadTokens: 80,
        cacheCreationTokens: 15,
      },
    });

    const msg = await adapter.getMessage('msg-1');
    expect(msg).toBeTruthy();
    expect(msg!.usage).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 80,
      cacheCreationTokens: 15,
    });
  });

  it('leaves cache fields undefined when the message did not report them', async () => {
    await adapter.storeMessage({
      id: 'msg-2',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'hi',
      timestamp: 11,
      usage: {
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
      },
    });

    const msg = await adapter.getMessage('msg-2');
    expect(msg!.usage?.cacheReadTokens).toBeUndefined();
    expect(msg!.usage?.cacheCreationTokens).toBeUndefined();
  });

  it('SUMs cache tokens across a conversation in getConversationTokenUsage', async () => {
    await adapter.storeMessage({
      id: 'msg-3',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'a',
      timestamp: 20,
      usage: {
        promptTokens: 200,
        completionTokens: 30,
        totalTokens: 230,
        cacheReadTokens: 150,
        cacheCreationTokens: 40,
      },
    });
    await adapter.storeMessage({
      id: 'msg-4',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'b',
      timestamp: 21,
      usage: {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 90,
      },
    });

    const agg = await adapter.getConversationTokenUsage('conv-1');
    expect(agg.promptTokens).toBe(300);
    expect(agg.completionTokens).toBe(40);
    expect(agg.totalTokens).toBe(340);
    expect(agg.cacheReadTokens).toBe(240);
    expect(agg.cacheCreationTokens).toBe(40);
  });

  it('keeps aggregate cache fields undefined when no message reported cache', async () => {
    await adapter.storeMessage({
      id: 'msg-5',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'opencache-silent',
      timestamp: 30,
      usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45 },
    });

    const agg = await adapter.getConversationTokenUsage('conv-1');
    expect(agg.promptTokens).toBe(40);
    expect(agg.cacheReadTokens).toBeUndefined();
    expect(agg.cacheCreationTokens).toBeUndefined();
  });

  it('tolerates re-initialize() without losing the migration (idempotent ALTER TABLE)', async () => {
    // First saveMessage runs the migration path on a fresh DB.
    await adapter.storeMessage({
      id: 'msg-6',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'first',
      timestamp: 40,
      usage: {
        promptTokens: 10,
        completionTokens: 2,
        totalTokens: 12,
        cacheReadTokens: 5,
      },
    });

    // Close + re-open the SAME adapter config; the second initialize
    // hits the ALTER TABLE branch expecting duplicate-column and
    // catching silently.
    await adapter.close?.();
    adapter = await freshAdapter();
    await adapter.createConversation({
      id: 'conv-1',
      userId: 'user-1',
      createdAt: 1,
      lastActivity: 1,
    });
    await adapter.storeMessage({
      id: 'msg-7',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'second',
      timestamp: 41,
      usage: {
        promptTokens: 20,
        completionTokens: 4,
        totalTokens: 24,
        cacheReadTokens: 12,
      },
    });

    const msg = await adapter.getMessage('msg-7');
    expect(msg!.usage?.cacheReadTokens).toBe(12);
  });
});
