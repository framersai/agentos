/**
 * @file TombstoneManager.test.ts
 * @description Tests for the tombstone (soft-delete) system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TombstoneManager } from '../enforcement/TombstoneManager.js';

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'tomb-uuid'),
}));

describe('TombstoneManager', () => {
  let storageAdapter: any;
  let mockLedger: any;
  let manager: TombstoneManager;

  beforeEach(() => {
    storageAdapter = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    };

    mockLedger = {
      appendEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
    };

    manager = new TombstoneManager(storageAdapter, mockLedger);
  });

  describe('createTombstone', () => {
    it('should create tombstone records for matching rows', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1', text: 'hello' }]);
      storageAdapter.get.mockResolvedValueOnce(null); // not already tombstoned

      const tombstones = await manager.createTombstone('messages', 'id = ?', ['msg-1']);

      expect(tombstones).toHaveLength(1);
      expect(tombstones[0].tableName).toBe('messages');
      expect(tombstones[0].recordId).toBe('msg-1');
      expect(tombstones[0].reason).toBe('deleted');
      expect(tombstones[0].initiator).toBe('system');
    });

    it('should store tombstone in database', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      await manager.createTombstone('messages', 'id = ?', ['msg-1']);

      expect(storageAdapter.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['tomb-uuid', 'messages', 'msg-1']),
      );
    });

    it('should log to signed event ledger', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      await manager.createTombstone('messages', 'id = ?', ['msg-1']);

      expect(mockLedger.appendEvent).toHaveBeenCalledWith(
        'message.tombstoned',
        expect.objectContaining({ tableName: 'messages', recordId: 'msg-1' }),
      );
    });

    it('should use conversation.tombstoned for conversation tables', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'conv-1' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      await manager.createTombstone('conversations', 'id = ?', ['conv-1']);

      expect(mockLedger.appendEvent).toHaveBeenCalledWith(
        'conversation.tombstoned',
        expect.anything(),
      );
    });

    it('should skip already-tombstoned records', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1' }]);
      storageAdapter.get.mockResolvedValueOnce({ id: 'existing-tombstone' });

      const tombstones = await manager.createTombstone('messages', 'id = ?', ['msg-1']);
      expect(tombstones).toHaveLength(0);
    });

    it('should accept custom reason and initiator', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      const tombstones = await manager.createTombstone(
        'messages', 'id = ?', ['msg-1'], 'user requested', 'human',
      );

      expect(tombstones[0].reason).toBe('user requested');
      expect(tombstones[0].initiator).toBe('human');
    });

    it('should return empty array when no rows match', async () => {
      storageAdapter.all.mockResolvedValueOnce([]);
      const tombstones = await manager.createTombstone('messages', 'id = ?', ['nope']);
      expect(tombstones).toHaveLength(0);
    });

    it('should work without ledger', async () => {
      const noLedgerManager = new TombstoneManager(storageAdapter, null);
      storageAdapter.all.mockResolvedValueOnce([{ id: 'msg-1' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      const tombstones = await noLedgerManager.createTombstone('messages', 'id = ?', ['msg-1']);
      expect(tombstones).toHaveLength(1);
      expect(tombstones[0].eventId).toBe('tomb-uuid'); // fallback
    });
  });

  describe('isTombstoned', () => {
    it('should return true for tombstoned records', async () => {
      storageAdapter.get.mockResolvedValueOnce({ id: 'tomb-1' });
      const result = await manager.isTombstoned('messages', 'msg-1');
      expect(result).toBe(true);
    });

    it('should return false for non-tombstoned records', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      const result = await manager.isTombstoned('messages', 'msg-1');
      expect(result).toBe(false);
    });
  });

  describe('getTombstone', () => {
    it('should return tombstone record with mapped fields', async () => {
      storageAdapter.get.mockResolvedValueOnce({
        id: 't1',
        table_name: 'messages',
        record_id: 'msg-1',
        reason: 'deleted',
        event_id: 'e1',
        initiator: 'system',
        timestamp: '2025-01-01T00:00:00.000Z',
      });

      const tombstone = await manager.getTombstone('messages', 'msg-1');
      expect(tombstone).toBeTruthy();
      expect(tombstone!.tableName).toBe('messages');
      expect(tombstone!.recordId).toBe('msg-1');
    });

    it('should return null for non-existent records', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      const tombstone = await manager.getTombstone('messages', 'nope');
      expect(tombstone).toBeNull();
    });
  });

  describe('getTombstones', () => {
    it('should return all tombstones when no table filter', async () => {
      storageAdapter.all.mockResolvedValueOnce([
        { id: 't1', table_name: 'messages', record_id: 'r1', reason: 'd', event_id: 'e1', initiator: 's', timestamp: 't1' },
        { id: 't2', table_name: 'conversations', record_id: 'r2', reason: 'd', event_id: 'e2', initiator: 's', timestamp: 't2' },
      ]);

      const tombstones = await manager.getTombstones();
      expect(tombstones).toHaveLength(2);
    });

    it('should filter by table name', async () => {
      storageAdapter.all.mockResolvedValueOnce([
        { id: 't1', table_name: 'messages', record_id: 'r1', reason: 'd', event_id: 'e1', initiator: 's', timestamp: 't1' },
      ]);

      const tombstones = await manager.getTombstones('messages');
      expect(tombstones).toHaveLength(1);
      expect(storageAdapter.all).toHaveBeenCalledWith(
        expect.stringContaining('WHERE table_name = ?'),
        ['messages'],
      );
    });
  });
});
