/**
 * @fileoverview Tests for SqlStorageMemoryArchive.
 *
 * Runs the shared IMemoryArchive contract suite against an in-memory
 * SQLite adapter via `resolveStorageAdapter`.
 *
 * @module agentos/memory/archive/__tests__/SqlStorageMemoryArchive.test
 */

import { describe } from 'vitest';
import { resolveStorageAdapter, createStorageFeatures } from '@framers/sql-storage-adapter';
import { SqlStorageMemoryArchive } from '../SqlStorageMemoryArchive.js';
import { runArchiveContractSuite } from './IMemoryArchive.contract.js';

describe('SqlStorageMemoryArchive (in-memory SQLite)', () => {
  runArchiveContractSuite(async () => {
    const adapter = await resolveStorageAdapter({
      filePath: ':memory:',
      priority: ['better-sqlite3', 'sqljs'],
      quiet: true,
    });
    const features = createStorageFeatures(adapter);
    const archive = new SqlStorageMemoryArchive(adapter, features, 'test-brain');
    await archive.initialize();
    return {
      archive,
      cleanup: async () => adapter.close(),
    };
  });
});
