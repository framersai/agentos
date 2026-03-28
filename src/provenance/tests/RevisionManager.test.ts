/**
 * @file RevisionManager.test.ts
 * @description Tests for the revision capture system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RevisionManager } from '../enforcement/RevisionManager.js';

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid'),
}));

describe('RevisionManager', () => {
  let storageAdapter: any;
  let mockLedger: any;
  let manager: RevisionManager;

  beforeEach(() => {
    storageAdapter = {
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    };

    mockLedger = {
      appendEvent: vi.fn().mockResolvedValue({ id: 'event-1' }),
    };

    manager = new RevisionManager(storageAdapter, mockLedger);
  });

  describe('captureRevision', () => {
    it('should capture snapshots of matching rows', async () => {
      storageAdapter.all.mockResolvedValueOnce([
        { id: 'row-1', text: 'original text', created_at: '2025-01-01' },
      ]);
      storageAdapter.get.mockResolvedValueOnce(null); // no prior revisions

      const revisions = await manager.captureRevision('messages', 'id = ?', ['row-1']);

      expect(revisions).toHaveLength(1);
      expect(revisions[0].tableName).toBe('messages');
      expect(revisions[0].recordId).toBe('row-1');
      expect(revisions[0].revisionNumber).toBe(1);
      expect(JSON.parse(revisions[0].snapshot)).toEqual({
        id: 'row-1',
        text: 'original text',
        created_at: '2025-01-01',
      });
    });

    it('should increment revision number', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'row-1', text: 'v2' }]);
      storageAdapter.get.mockResolvedValueOnce({ revision_number: 3 });

      const revisions = await manager.captureRevision('messages', 'id = ?', ['row-1']);
      expect(revisions[0].revisionNumber).toBe(4);
    });

    it('should store revision in database', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'row-1', text: 'original' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      await manager.captureRevision('messages', 'id = ?', ['row-1']);

      expect(storageAdapter.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['mock-uuid', 'messages', 'row-1', 1]),
      );
    });

    it('should log to signed event ledger', async () => {
      storageAdapter.all.mockResolvedValueOnce([{ id: 'row-1', text: 'original' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      await manager.captureRevision('messages', 'id = ?', ['row-1']);

      expect(mockLedger.appendEvent).toHaveBeenCalledWith(
        'message.revised',
        expect.objectContaining({ tableName: 'messages', recordId: 'row-1' }),
      );
    });

    it('should return empty array when no rows match', async () => {
      storageAdapter.all.mockResolvedValueOnce([]);

      const revisions = await manager.captureRevision('messages', 'id = ?', ['nonexistent']);
      expect(revisions).toHaveLength(0);
    });

    it('should capture multiple rows', async () => {
      storageAdapter.all.mockResolvedValueOnce([
        { id: 'r1', text: 'a' },
        { id: 'r2', text: 'b' },
      ]);
      storageAdapter.get.mockResolvedValue(null);

      const revisions = await manager.captureRevision('messages', 'conversation_id = ?', ['c1']);
      expect(revisions).toHaveLength(2);
    });

    it('should work without ledger', async () => {
      const managerNoLedger = new RevisionManager(storageAdapter, null);
      storageAdapter.all.mockResolvedValueOnce([{ id: 'row-1', text: 'hi' }]);
      storageAdapter.get.mockResolvedValueOnce(null);

      const revisions = await managerNoLedger.captureRevision('messages', 'id = ?', ['row-1']);
      expect(revisions).toHaveLength(1);
      expect(revisions[0].eventId).toBe('mock-uuid'); // fallback
    });
  });

  describe('getRevisions', () => {
    it('should return revisions ordered by revision number', async () => {
      storageAdapter.all.mockResolvedValueOnce([
        { id: 'r1', table_name: 'messages', record_id: 'row-1', revision_number: 1, snapshot: '{}', event_id: 'e1', timestamp: 't1' },
        { id: 'r2', table_name: 'messages', record_id: 'row-1', revision_number: 2, snapshot: '{}', event_id: 'e2', timestamp: 't2' },
      ]);

      const revisions = await manager.getRevisions('messages', 'row-1');
      expect(revisions).toHaveLength(2);
      expect(revisions[0].revisionNumber).toBe(1);
      expect(revisions[1].revisionNumber).toBe(2);
    });
  });

  describe('getLatestRevision', () => {
    it('should return the latest revision', async () => {
      storageAdapter.get.mockResolvedValueOnce({
        id: 'r3', table_name: 'messages', record_id: 'row-1', revision_number: 3, snapshot: '{"text":"v3"}', event_id: 'e3', timestamp: 't3',
      });

      const revision = await manager.getLatestRevision('messages', 'row-1');
      expect(revision).toBeTruthy();
      expect(revision!.revisionNumber).toBe(3);
    });

    it('should return null when no revisions exist', async () => {
      storageAdapter.get.mockResolvedValueOnce(null);
      const revision = await manager.getLatestRevision('messages', 'nonexistent');
      expect(revision).toBeNull();
    });
  });
});
