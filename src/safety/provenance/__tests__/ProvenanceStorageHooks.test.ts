/**
 * @file ProvenanceStorageHooks.test.ts
 * @description Tests for storage policy enforcement hooks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProvenanceHooks } from '../enforcement/ProvenanceStorageHooks.js';
import { ProvenanceViolationError } from '../types.js';
import type { ProvenanceSystemConfig } from '../types.js';
import { profiles } from '../config/PolicyProfiles.js';

describe('ProvenanceStorageHooks', () => {
  const makeContext = (statement: string, tables?: string[]) => ({
    operation: 'run' as const,
    statement,
    affectedTables: tables,
    operationId: 'op-1',
    startTime: Date.now(),
  });

  describe('sealed mode', () => {
    let hooks: ReturnType<typeof createProvenanceHooks>;

    beforeEach(() => {
      const config = profiles.sealedAutonomous();
      hooks = createProvenanceHooks(config);
    });

    it('should allow INSERT operations', async () => {
      const ctx = makeContext('INSERT INTO messages (id, text) VALUES (?, ?)');
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx);
    });

    it('should block UPDATE operations on protected tables', async () => {
      const ctx = makeContext('UPDATE messages SET text = ? WHERE id = ?');
      await expect(hooks.onBeforeWrite!(ctx)).rejects.toThrow(ProvenanceViolationError);
    });

    it('should block DELETE operations on protected tables', async () => {
      const ctx = makeContext('DELETE FROM messages WHERE id = ?');
      await expect(hooks.onBeforeWrite!(ctx)).rejects.toThrow(ProvenanceViolationError);
    });

    it('should allow schema operations', async () => {
      const createCtx = makeContext('CREATE TABLE test (id TEXT)');
      const result = await hooks.onBeforeWrite!(createCtx);
      expect(result).toBe(createCtx);
    });

    it('should allow operations on provenance tables', async () => {
      const ctx = makeContext('UPDATE signed_events SET anchor_id = ?');
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx);
    });

    it('should allow operations on exempt tables', async () => {
      const config: ProvenanceSystemConfig = {
        ...profiles.sealedAutonomous(),
        storagePolicy: {
          mode: 'sealed',
          exemptTables: ['cache_table'],
        },
      };
      const sealedHooks = createProvenanceHooks(config);
      const ctx = makeContext('UPDATE cache_table SET value = ?', ['cache_table']);
      const result = await sealedHooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx);
    });

    it('should include error code in ProvenanceViolationError', async () => {
      const ctx = makeContext('DELETE FROM messages WHERE id = ?');
      try {
        await hooks.onBeforeWrite!(ctx);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ProvenanceViolationError);
        expect((e as ProvenanceViolationError).code).toBe('SEALED_MUTATION_BLOCKED');
      }
    });
  });

  describe('revisioned mode', () => {
    it('should allow INSERT operations', async () => {
      const config = profiles.revisionedVerified();
      const hooks = createProvenanceHooks(config);
      const ctx = makeContext('INSERT INTO messages (id, text) VALUES (?, ?)');
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx);
    });

    it('should allow UPDATE operations (after capturing revision)', async () => {
      const mockRevisionManager = {
        captureRevision: vi.fn().mockResolvedValue([]),
      };
      const config = profiles.revisionedVerified();
      const hooks = createProvenanceHooks(config, undefined, mockRevisionManager as any);

      const ctx = makeContext('UPDATE messages SET text = ? WHERE id = ?', ['messages']);
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx);
      expect(mockRevisionManager.captureRevision).toHaveBeenCalled();
    });

    it('should abort DELETE and create tombstone', async () => {
      const mockTombstoneManager = {
        createTombstone: vi.fn().mockResolvedValue([]),
      };
      const config = profiles.revisionedVerified();
      const hooks = createProvenanceHooks(config, undefined, undefined, mockTombstoneManager as any);

      const ctx = makeContext('DELETE FROM messages WHERE id = ?', ['messages']);
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBeUndefined(); // Aborts the DELETE
      expect(mockTombstoneManager.createTombstone).toHaveBeenCalled();
    });
  });

  describe('mutable mode', () => {
    it('should allow all operations', async () => {
      const config = profiles.mutableDev();
      const hooks = createProvenanceHooks(config);

      const insertCtx = makeContext('INSERT INTO messages VALUES (?)');
      const updateCtx = makeContext('UPDATE messages SET text = ?');
      const deleteCtx = makeContext('DELETE FROM messages WHERE id = ?');

      expect(await hooks.onBeforeWrite!(insertCtx)).toBe(insertCtx);
      expect(await hooks.onBeforeWrite!(updateCtx)).toBe(updateCtx);
      expect(await hooks.onBeforeWrite!(deleteCtx)).toBe(deleteCtx);
    });
  });

  describe('onAfterWrite', () => {
    it('should log events to ledger when provenance is enabled', async () => {
      const mockLedger = {
        appendEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      };
      const config = profiles.sealedAutonomous();
      const hooks = createProvenanceHooks(config, mockLedger as any);

      const ctx = makeContext('INSERT INTO messages (id, text) VALUES (?, ?)');
      await hooks.onAfterWrite!(ctx, { changes: 1 });

      expect(mockLedger.appendEvent).toHaveBeenCalledWith(
        'message.created',
        expect.objectContaining({ table: 'messages', operation: 'INSERT' }),
      );
    });

    it('should not log when changes is 0', async () => {
      const mockLedger = {
        appendEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      };
      const config = profiles.sealedAutonomous();
      const hooks = createProvenanceHooks(config, mockLedger as any);

      const ctx = makeContext('INSERT INTO messages VALUES (?)');
      await hooks.onAfterWrite!(ctx, { changes: 0 });

      expect(mockLedger.appendEvent).not.toHaveBeenCalled();
    });

    it('should not log when provenance is disabled', async () => {
      const mockLedger = {
        appendEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      };
      const config = profiles.mutableDev(); // provenance.enabled = false
      const hooks = createProvenanceHooks(config, mockLedger as any);

      const ctx = makeContext('INSERT INTO messages VALUES (?)');
      await hooks.onAfterWrite!(ctx, { changes: 1 });

      expect(mockLedger.appendEvent).not.toHaveBeenCalled();
    });

    it('should skip logging for provenance-internal tables', async () => {
      const mockLedger = {
        appendEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      };
      const config = profiles.sealedAutonomous();
      const hooks = createProvenanceHooks(config, mockLedger as any);

      const ctx = makeContext('INSERT INTO signed_events VALUES (?)');
      await hooks.onAfterWrite!(ctx, { changes: 1 });

      expect(mockLedger.appendEvent).not.toHaveBeenCalled();
    });

    it('should map conversation table operations correctly', async () => {
      const mockLedger = {
        appendEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      };
      const config = profiles.sealedAutonomous();
      const hooks = createProvenanceHooks(config, mockLedger as any);

      const ctx = makeContext('INSERT INTO conversations (id) VALUES (?)');
      await hooks.onAfterWrite!(ctx, { changes: 1 });

      expect(mockLedger.appendEvent).toHaveBeenCalledWith(
        'conversation.created',
        expect.anything(),
      );
    });
  });

  describe('table extraction', () => {
    it('should extract table from INSERT statement', async () => {
      const config: ProvenanceSystemConfig = {
        ...profiles.sealedAutonomous(),
        storagePolicy: {
          mode: 'sealed',
          protectedTables: ['my_table'],
        },
      };
      const hooks = createProvenanceHooks(config);

      const ctx = makeContext('INSERT INTO my_table (col1) VALUES (?)');
      const result = await hooks.onBeforeWrite!(ctx);
      expect(result).toBe(ctx); // my_table is protected but INSERT is allowed
    });

    it('should block INSERT OR REPLACE in sealed mode (upsert mutation)', async () => {
      const config: ProvenanceSystemConfig = {
        ...profiles.sealedAutonomous(),
        storagePolicy: {
          mode: 'sealed',
          protectedTables: ['my_table'],
        },
      };
      const hooks = createProvenanceHooks(config);

      const ctx = makeContext('INSERT OR REPLACE INTO my_table (col1) VALUES (?)');
      await expect(hooks.onBeforeWrite!(ctx)).rejects.toThrow(ProvenanceViolationError);
    });

    it('should use affectedTables from context when available', async () => {
      const config: ProvenanceSystemConfig = {
        ...profiles.sealedAutonomous(),
        storagePolicy: {
          mode: 'sealed',
          protectedTables: ['protected_table'],
        },
      };
      const hooks = createProvenanceHooks(config);

      // affectedTables says 'protected_table' even though SQL says 'other_table'
      const ctx = makeContext('UPDATE other_table SET x = 1', ['protected_table']);
      await expect(hooks.onBeforeWrite!(ctx)).rejects.toThrow(ProvenanceViolationError);
    });
  });
});
