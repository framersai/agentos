/**
 * @fileoverview Tests for SqliteBrain — unified SQLite connection manager.
 *
 * Verifies schema initialisation, WAL mode, brain_meta helpers,
 * and embedding dimension compatibility checks.
 *
 * @module memory/store/__tests__/SqliteBrain.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBrain } from '../SqliteBrain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique temp file path for each test so tests are fully isolated.
 * The file is NOT created — SqliteBrain creates it on open.
 */
function tempDbPath(): string {
  return path.join(os.tmpdir(), `agentos-test-brain-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

/** Tracks brains opened during each test so afterEach can close + delete them. */
const openBrains: Array<{ brain: SqliteBrain; dbPath: string }> = [];

function openBrain(dbPath?: string): { brain: SqliteBrain; dbPath: string } {
  const p = dbPath ?? tempDbPath();
  const brain = new SqliteBrain(p);
  openBrains.push({ brain, dbPath: p });
  return { brain, dbPath: p };
}

afterEach(() => {
  // Close all brains opened in this test and delete the temp files.
  while (openBrains.length > 0) {
    const entry = openBrains.pop()!;
    try {
      entry.brain.close();
    } catch {
      // Already closed — ignore.
    }
    try {
      // Delete the main db file and any WAL / SHM sidecars.
      for (const suffix of ['', '-wal', '-shm']) {
        const p = entry.dbPath + suffix;
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    } catch {
      // Best-effort cleanup.
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqliteBrain', () => {
  // -------------------------------------------------------------------------
  // Schema initialisation
  // -------------------------------------------------------------------------

  describe('schema initialisation', () => {
    it('creates all expected tables', () => {
      const { brain } = openBrain();

      // Query sqlite_master for all user-created tables and virtual tables.
      const rows = brain.db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow') ORDER BY name`,
        )
        .all();

      const tableNames = new Set(rows.map((r) => r.name));

      const expectedTables = [
        'brain_meta',
        'consolidation_log',
        'conversations',
        'document_chunks',
        'document_images',
        'documents',
        'knowledge_edges',
        'knowledge_nodes',
        'memory_traces',
        'messages',
        'retrieval_feedback',
      ];

      for (const table of expectedTables) {
        expect(tableNames.has(table), `Expected table "${table}" to exist`).toBe(true);
      }
    });

    it('creates the memory_traces_fts virtual table', () => {
      const { brain } = openBrain();

      const row = brain.db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_traces_fts'`,
        )
        .get();

      expect(row).toBeDefined();
      expect(row?.name).toBe('memory_traces_fts');
    });

    it('is idempotent — re-opening the same file does not throw', () => {
      const dbPath = tempDbPath();
      const { brain: first } = openBrain(dbPath);
      first.close();

      // Open again — should not throw (CREATE TABLE IF NOT EXISTS).
      expect(() => {
        const brain2 = new SqliteBrain(dbPath);
        openBrains.push({ brain: brain2, dbPath });
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // WAL mode
  // -------------------------------------------------------------------------

  describe('WAL mode', () => {
    it('enables WAL journal mode', () => {
      const { brain } = openBrain();

      const row = brain.db
        .prepare<[], { journal_mode: string }>('PRAGMA journal_mode')
        .get();

      expect(row?.journal_mode).toBe('wal');
    });
  });

  // -------------------------------------------------------------------------
  // brain_meta helpers
  // -------------------------------------------------------------------------

  describe('getMeta / setMeta', () => {
    it('returns undefined for unknown keys', () => {
      const { brain } = openBrain();
      expect(brain.getMeta('nonexistent_key')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
      const { brain } = openBrain();
      brain.setMeta('test_key', 'hello_world');
      expect(brain.getMeta('test_key')).toBe('hello_world');
    });

    it('overwrites an existing value (upsert semantics)', () => {
      const { brain } = openBrain();
      brain.setMeta('overwrite_me', 'first');
      brain.setMeta('overwrite_me', 'second');
      expect(brain.getMeta('overwrite_me')).toBe('second');
    });

    it('preserves independent keys', () => {
      const { brain } = openBrain();
      brain.setMeta('key_a', 'alpha');
      brain.setMeta('key_b', 'beta');
      expect(brain.getMeta('key_a')).toBe('alpha');
      expect(brain.getMeta('key_b')).toBe('beta');
    });
  });

  // -------------------------------------------------------------------------
  // Schema version seeded on first creation
  // -------------------------------------------------------------------------

  describe('schema version', () => {
    it('sets schema_version to "1" on first creation', () => {
      const { brain } = openBrain();
      expect(brain.getMeta('schema_version')).toBe('1');
    });

    it('sets created_at on first creation', () => {
      const before = Date.now();
      const { brain } = openBrain();
      const after = Date.now();

      const raw = brain.getMeta('created_at');
      expect(raw).toBeDefined();

      const ts = parseInt(raw!, 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('does not overwrite schema_version on re-open', () => {
      const dbPath = tempDbPath();
      const { brain: first } = openBrain(dbPath);
      first.close();

      // Re-open — schema_version must still be '1' (INSERT OR IGNORE in _seedMeta).
      const brain2 = new SqliteBrain(dbPath);
      openBrains.push({ brain: brain2, dbPath });
      expect(brain2.getMeta('schema_version')).toBe('1');
    });
  });

  // -------------------------------------------------------------------------
  // checkEmbeddingCompat
  // -------------------------------------------------------------------------

  describe('checkEmbeddingCompat', () => {
    it('returns true when no embedding_dimensions stored yet', () => {
      const { brain } = openBrain();
      // No prior call — should accept any dimension.
      expect(brain.checkEmbeddingCompat(1536)).toBe(true);
    });

    it('stores the dimension after the first call', () => {
      const { brain } = openBrain();
      brain.checkEmbeddingCompat(768);
      expect(brain.getMeta('embedding_dimensions')).toBe('768');
    });

    it('returns true when dimensions match the stored value', () => {
      const { brain } = openBrain();
      brain.checkEmbeddingCompat(1536);      // stores 1536
      expect(brain.checkEmbeddingCompat(1536)).toBe(true);
    });

    it('returns false on dimension mismatch', () => {
      const { brain } = openBrain();
      brain.checkEmbeddingCompat(1536);      // stores 1536
      expect(brain.checkEmbeddingCompat(768)).toBe(false);
    });

    it('does not overwrite the stored dimension on mismatch', () => {
      const { brain } = openBrain();
      brain.checkEmbeddingCompat(1536);
      brain.checkEmbeddingCompat(768);       // mismatch — should NOT update stored value
      expect(brain.getMeta('embedding_dimensions')).toBe('1536');
    });
  });

  // -------------------------------------------------------------------------
  // Foreign keys
  // -------------------------------------------------------------------------

  describe('foreign key enforcement', () => {
    it('enforces foreign keys (inserting edge with missing node throws)', () => {
      const { brain } = openBrain();

      expect(() => {
        brain.db
          .prepare(
            `INSERT INTO knowledge_edges (id, source_id, target_id, type, created_at)
             VALUES ('e1', 'missing-node', 'also-missing', 'RELATED_TO', ?)`,
          )
          .run(Date.now());
      }).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------------

  describe('close()', () => {
    it('closes the database without throwing', () => {
      const dbPath = tempDbPath();
      const brain = new SqliteBrain(dbPath);
      expect(() => brain.close()).not.toThrow();
      // Manually clean up since we bypassed openBrain().
      for (const suffix of ['', '-wal', '-shm']) {
        const p = dbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    });
  });
});
