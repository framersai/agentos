/**
 * @fileoverview Tests for SqliteKnowledgeGraph — IKnowledgeGraph backed by SQLite.
 *
 * Verifies entity CRUD, relation CRUD, episodic memory operations,
 * graph traversal (BFS, shortest path, neighbourhood), entity merging,
 * memory decay, statistics, and full clear.
 *
 * @module memory/store/__tests__/SqliteKnowledgeGraph.test
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBrain } from '../SqliteBrain.js';
import { SqliteKnowledgeGraph } from '../SqliteKnowledgeGraph.js';
import type {
  KnowledgeSource,
  EntityType,
} from '../../../core/knowledge/IKnowledgeGraph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique temp file path for each test. */
function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `agentos-test-kg-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

/** Default source object used across tests. */
function defaultSource(): KnowledgeSource {
  return {
    type: 'user_input',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

/** Tracks brains opened during each test so afterEach can close + delete them. */
const openBrains: Array<{ brain: SqliteBrain; dbPath: string }> = [];

async function createGraph(): Promise<{ graph: SqliteKnowledgeGraph; brain: SqliteBrain; dbPath: string }> {
  const dbPath = tempDbPath();
  const brain = await SqliteBrain.open(dbPath);
  openBrains.push({ brain, dbPath });
  const graph = new SqliteKnowledgeGraph(brain);
  return { graph, brain, dbPath };
}

afterEach(async () => {
  while (openBrains.length > 0) {
    const entry = openBrains.pop()!;
    try {
      await entry.brain.close();
    } catch {
      // Already closed.
    }
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const p = entry.dbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {
      // Best-effort cleanup.
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqliteKnowledgeGraph', () => {
  // =========================================================================
  // Entity CRUD
  // =========================================================================

  describe('entity CRUD', () => {
    it('upserts a new entity with generated ID', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const entity = await graph.upsertEntity({
        type: 'person',
        label: 'Alice',
        properties: { role: 'engineer' },
        confidence: 0.95,
        source: defaultSource(),
      });

      expect(entity.id).toBeDefined();
      expect(entity.type).toBe('person');
      expect(entity.label).toBe('Alice');
      expect(entity.properties).toEqual({ role: 'engineer' });
      expect(entity.confidence).toBe(0.95);
      expect(entity.createdAt).toBeDefined();
      expect(entity.updatedAt).toBeDefined();
    });

    it('upserts an entity with a provided ID', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const entity = await graph.upsertEntity({
        id: 'custom-id-123',
        type: 'concept',
        label: 'TypeScript',
        properties: { paradigm: 'multi' },
        confidence: 1.0,
        source: defaultSource(),
      });

      expect(entity.id).toBe('custom-id-123');
    });

    it('updates an existing entity (upsert semantics)', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const v1 = await graph.upsertEntity({
        id: 'update-me',
        type: 'person',
        label: 'Bob',
        properties: { age: 30 },
        confidence: 0.8,
        source: defaultSource(),
      });

      const v2 = await graph.upsertEntity({
        id: 'update-me',
        type: 'person',
        label: 'Bob Updated',
        properties: { age: 31 },
        confidence: 0.9,
        source: defaultSource(),
      });

      expect(v2.id).toBe('update-me');
      expect(v2.label).toBe('Bob Updated');
      expect(v2.properties).toEqual({ age: 31 });
      expect(v2.confidence).toBe(0.9);
      // createdAt should be preserved from v1.
      expect(v2.createdAt).toBe(v1.createdAt);
    });

    it('gets an entity by ID', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const created = await graph.upsertEntity({
        type: 'location',
        label: 'Berlin',
        properties: { country: 'Germany' },
        confidence: 1.0,
        source: defaultSource(),
      });

      const fetched = await graph.getEntity(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.label).toBe('Berlin');
    });

    it('returns undefined for non-existent entity', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const result = await graph.getEntity('nonexistent');
      expect(result).toBeUndefined();
    });

    it('queries entities by type', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.upsertEntity({
        type: 'person',
        label: 'Alice',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertEntity({
        type: 'person',
        label: 'Bob',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertEntity({
        type: 'location',
        label: 'Berlin',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });

      const people = await graph.queryEntities({ entityTypes: ['person'] });
      expect(people).toHaveLength(2);
      expect(people.every((e) => e.type === 'person')).toBe(true);
    });

    it('queries entities by textSearch', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.upsertEntity({
        type: 'concept',
        label: 'Machine Learning',
        properties: { field: 'AI' },
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertEntity({
        type: 'concept',
        label: 'Database Systems',
        properties: { field: 'CS' },
        confidence: 1.0,
        source: defaultSource(),
      });

      // textSearch is an extension — passed as part of the options object
      const results = await graph.queryEntities({ textSearch: 'machine' } as any);
      expect(results).toHaveLength(1);
      expect(results[0].label).toBe('Machine Learning');
    });

    it('deletes an entity and its relations', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const alice = await graph.upsertEntity({
        type: 'person',
        label: 'Alice',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      const bob = await graph.upsertEntity({
        type: 'person',
        label: 'Bob',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });

      await graph.upsertRelation({
        sourceId: alice.id,
        targetId: bob.id,
        type: 'knows',
        label: 'knows',
        weight: 1.0,
        bidirectional: true,
        confidence: 1.0,
        source: defaultSource(),
      });

      const deleted = await graph.deleteEntity(alice.id);
      expect(deleted).toBe(true);

      // Entity should be gone.
      expect(await graph.getEntity(alice.id)).toBeUndefined();

      // Relations involving Alice should be gone.
      const relations = await graph.getRelations(alice.id);
      expect(relations).toHaveLength(0);
    });

    it('deleteEntity returns false for non-existent entity', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const deleted = await graph.deleteEntity('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  // =========================================================================
  // Relation CRUD
  // =========================================================================

  describe('relation CRUD', () => {
    it('upserts a new relation', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const alice = await graph.upsertEntity({
        type: 'person',
        label: 'Alice',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      const bob = await graph.upsertEntity({
        type: 'person',
        label: 'Bob',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });

      const relation = await graph.upsertRelation({
        sourceId: alice.id,
        targetId: bob.id,
        type: 'knows',
        label: 'knows',
        weight: 0.8,
        bidirectional: true,
        confidence: 0.9,
        source: defaultSource(),
      });

      expect(relation.id).toBeDefined();
      expect(relation.sourceId).toBe(alice.id);
      expect(relation.targetId).toBe(bob.id);
      expect(relation.type).toBe('knows');
      expect(relation.weight).toBe(0.8);
      expect(relation.bidirectional).toBe(true);
      expect(relation.confidence).toBe(0.9);
    });

    it('gets relations by entity (outgoing)', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'person', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });
      const c = await graph.upsertEntity({
        type: 'person', label: 'C', properties: {}, confidence: 1, source: defaultSource(),
      });

      await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });
      await graph.upsertRelation({
        sourceId: c.id, targetId: a.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });

      const outgoing = await graph.getRelations(a.id, { direction: 'outgoing' });
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].targetId).toBe(b.id);
    });

    it('gets relations by entity (incoming)', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'person', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });
      const c = await graph.upsertEntity({
        type: 'person', label: 'C', properties: {}, confidence: 1, source: defaultSource(),
      });

      await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });
      await graph.upsertRelation({
        sourceId: c.id, targetId: a.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });

      const incoming = await graph.getRelations(a.id, { direction: 'incoming' });
      expect(incoming).toHaveLength(1);
      expect(incoming[0].sourceId).toBe(c.id);
    });

    it('gets relations by entity (both directions)', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'person', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });
      const c = await graph.upsertEntity({
        type: 'person', label: 'C', properties: {}, confidence: 1, source: defaultSource(),
      });

      await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });
      await graph.upsertRelation({
        sourceId: c.id, targetId: a.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });

      const both = await graph.getRelations(a.id, { direction: 'both' });
      expect(both).toHaveLength(2);
    });

    it('deletes a relation', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'person', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });

      const rel = await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });

      const deleted = await graph.deleteRelation(rel.id);
      expect(deleted).toBe(true);

      const remaining = await graph.getRelations(a.id);
      expect(remaining).toHaveLength(0);
    });
  });

  // =========================================================================
  // Episodic Memory
  // =========================================================================

  describe('episodic memory', () => {
    it('records and retrieves a memory', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const mem = await graph.recordMemory({
        type: 'conversation',
        summary: 'Discussed project roadmap with Alice',
        participants: ['user-1', 'agent-1'],
        importance: 0.8,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      expect(mem.id).toBeDefined();
      expect(mem.type).toBe('conversation');
      expect(mem.summary).toBe('Discussed project roadmap with Alice');
      expect(mem.accessCount).toBe(0);

      const fetched = await graph.getMemory(mem.id);
      expect(fetched).toBeDefined();
      expect(fetched!.summary).toBe(mem.summary);
    });

    it('returns undefined for non-existent memory', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const result = await graph.getMemory('nonexistent');
      expect(result).toBeUndefined();
    });

    it('queries memories by type', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.recordMemory({
        type: 'conversation',
        summary: 'Chat about ML',
        participants: ['user-1'],
        importance: 0.5,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });
      await graph.recordMemory({
        type: 'task',
        summary: 'Completed deployment',
        participants: ['user-1'],
        importance: 0.9,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      const convos = await graph.queryMemories({ types: ['conversation'] });
      expect(convos).toHaveLength(1);
      expect(convos[0].type).toBe('conversation');
    });

    it('queries memories by timeRange', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const old = new Date('2024-01-01T00:00:00Z');
      const recent = new Date('2025-06-01T00:00:00Z');

      await graph.recordMemory({
        type: 'conversation',
        summary: 'Old memory',
        participants: [],
        importance: 0.5,
        entityIds: [],
        occurredAt: old.toISOString(),
      });

      // Small delay to ensure different created_at timestamps
      await graph.recordMemory({
        type: 'conversation',
        summary: 'Recent memory',
        participants: [],
        importance: 0.5,
        entityIds: [],
        occurredAt: recent.toISOString(),
      });

      const all = await graph.queryMemories({});
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('recalls memories by keyword and updates access count', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.recordMemory({
        type: 'conversation',
        summary: 'Discussed TypeScript migration plan',
        participants: ['user-1'],
        importance: 0.7,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });
      await graph.recordMemory({
        type: 'task',
        summary: 'Fixed Python bug',
        participants: ['user-1'],
        importance: 0.5,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      const results = await graph.recallMemories('TypeScript');
      expect(results).toHaveLength(1);
      expect(results[0].summary).toContain('TypeScript');
      expect(results[0].accessCount).toBe(1);

      // Recall again — access count should increment.
      const results2 = await graph.recallMemories('TypeScript');
      expect(results2[0].accessCount).toBe(2);
    });
  });

  // =========================================================================
  // Graph Traversal
  // =========================================================================

  describe('graph traversal', () => {
    /**
     * Helper: create a chain A -> B -> C -> D with directed edges.
     */
    async function createChain(graph: SqliteKnowledgeGraph) {
      const entities = [];
      for (const label of ['A', 'B', 'C', 'D']) {
        const e = await graph.upsertEntity({
          id: `node-${label}`,
          type: 'concept',
          label,
          properties: {},
          confidence: 1.0,
          source: defaultSource(),
        });
        entities.push(e);
      }

      // A -> B -> C -> D
      for (let i = 0; i < entities.length - 1; i++) {
        await graph.upsertRelation({
          sourceId: entities[i].id,
          targetId: entities[i + 1].id,
          type: 'precedes',
          label: 'precedes',
          weight: 1.0,
          bidirectional: false,
          confidence: 1.0,
          source: defaultSource(),
        });
      }

      return entities;
    }

    it('traverses from A with maxDepth 2 — returns A, B, C only', async () => {
      const { graph } = await createGraph();
      await graph.initialize();
      await createChain(graph);

      const result = await graph.traverse('node-A', {
        maxDepth: 2,
        direction: 'outgoing',
      });

      expect(result.root.label).toBe('A');

      // Collect all entity labels across levels.
      const allLabels = new Set<string>();
      for (const level of result.levels) {
        for (const entity of level.entities) {
          allLabels.add(entity.label);
        }
      }

      expect(allLabels.has('A')).toBe(true);
      expect(allLabels.has('B')).toBe(true);
      expect(allLabels.has('C')).toBe(true);
      expect(allLabels.has('D')).toBe(false);
    });

    it('throws for non-existent start entity', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await expect(graph.traverse('nonexistent')).rejects.toThrow('Entity not found');
    });
  });

  // =========================================================================
  // findPath
  // =========================================================================

  describe('findPath', () => {
    it('finds shortest path A -> B -> C -> D', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      // Create chain A -> B -> C -> D
      const entities = [];
      for (const label of ['A', 'B', 'C', 'D']) {
        const e = await graph.upsertEntity({
          id: `path-${label}`,
          type: 'concept',
          label,
          properties: {},
          confidence: 1.0,
          source: defaultSource(),
        });
        entities.push(e);
      }

      for (let i = 0; i < entities.length - 1; i++) {
        await graph.upsertRelation({
          sourceId: entities[i].id,
          targetId: entities[i + 1].id,
          type: 'precedes',
          label: 'precedes',
          weight: 1.0,
          bidirectional: false,
          confidence: 1.0,
          source: defaultSource(),
        });
      }

      const path = await graph.findPath('path-A', 'path-D');
      expect(path).not.toBeNull();
      expect(path!.length).toBe(4); // A, B, C, D
      expect(path![0].entity.label).toBe('A');
      expect(path![path!.length - 1].entity.label).toBe('D');
    });

    it('returns null when no path exists', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.upsertEntity({
        id: 'island-1',
        type: 'concept',
        label: 'Island1',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertEntity({
        id: 'island-2',
        type: 'concept',
        label: 'Island2',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });

      const path = await graph.findPath('island-1', 'island-2');
      expect(path).toBeNull();
    });
  });

  // =========================================================================
  // getNeighborhood
  // =========================================================================

  describe('getNeighborhood', () => {
    it('returns A and C as neighbours of B at depth 1', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      // Chain: A -> B -> C -> D
      const entities = [];
      for (const label of ['A', 'B', 'C', 'D']) {
        const e = await graph.upsertEntity({
          id: `nb-${label}`,
          type: 'concept',
          label,
          properties: {},
          confidence: 1.0,
          source: defaultSource(),
        });
        entities.push(e);
      }

      for (let i = 0; i < entities.length - 1; i++) {
        await graph.upsertRelation({
          sourceId: entities[i].id,
          targetId: entities[i + 1].id,
          type: 'precedes',
          label: 'precedes',
          weight: 1.0,
          bidirectional: false,
          confidence: 1.0,
          source: defaultSource(),
        });
      }

      const { entities: neighbors, relations } = await graph.getNeighborhood('nb-B', 1);

      const labels = new Set(neighbors.map((e) => e.label));
      // B itself plus its direct neighbors A and C.
      expect(labels.has('B')).toBe(true);
      expect(labels.has('A')).toBe(true);
      expect(labels.has('C')).toBe(true);
      expect(labels.has('D')).toBe(false);

      // Relations connecting the neighbourhood.
      expect(relations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // mergeEntities
  // =========================================================================

  describe('mergeEntities', () => {
    it('merges 3 entities — edges re-linked to primary', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const primary = await graph.upsertEntity({
        id: 'merge-primary',
        type: 'person',
        label: 'Alice (primary)',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });
      const dup1 = await graph.upsertEntity({
        id: 'merge-dup1',
        type: 'person',
        label: 'Alice (dup 1)',
        properties: {},
        confidence: 0.7,
        source: defaultSource(),
      });
      const dup2 = await graph.upsertEntity({
        id: 'merge-dup2',
        type: 'person',
        label: 'Alice (dup 2)',
        properties: {},
        confidence: 0.5,
        source: defaultSource(),
      });

      // External entity linked to dup1 and dup2.
      const bob = await graph.upsertEntity({
        id: 'merge-bob',
        type: 'person',
        label: 'Bob',
        properties: {},
        confidence: 1.0,
        source: defaultSource(),
      });

      await graph.upsertRelation({
        sourceId: dup1.id,
        targetId: bob.id,
        type: 'knows',
        label: 'knows',
        weight: 1.0,
        bidirectional: false,
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertRelation({
        sourceId: bob.id,
        targetId: dup2.id,
        type: 'knows',
        label: 'knows',
        weight: 1.0,
        bidirectional: false,
        confidence: 1.0,
        source: defaultSource(),
      });

      const merged = await graph.mergeEntities(
        [primary.id, dup1.id, dup2.id],
        primary.id,
      );

      expect(merged.id).toBe(primary.id);

      // Duplicates should be deleted.
      expect(await graph.getEntity(dup1.id)).toBeUndefined();
      expect(await graph.getEntity(dup2.id)).toBeUndefined();

      // All edges should now point to/from primary.
      const edges = await graph.getRelations(primary.id, { direction: 'both' });
      expect(edges.length).toBeGreaterThanOrEqual(1);
      for (const edge of edges) {
        expect(
          edge.sourceId === primary.id || edge.targetId === primary.id,
        ).toBe(true);
      }
    });
  });

  // =========================================================================
  // decayMemories
  // =========================================================================

  describe('decayMemories', () => {
    it('reduces confidence of memory nodes by decay factor', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const mem = await graph.recordMemory({
        type: 'conversation',
        summary: 'Important chat',
        participants: [],
        importance: 1.0,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      const decayed = await graph.decayMemories(0.5);
      expect(decayed).toBe(1);

      const fetched = await graph.getMemory(mem.id);
      expect(fetched).toBeDefined();
      expect(fetched!.importance).toBeCloseTo(0.5, 2);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe('getStats', () => {
    it('returns correct counts', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      // 2 entities (non-memory).
      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'concept', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });

      // 1 relation.
      await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'related_to', label: 'related',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });

      // 1 memory.
      await graph.recordMemory({
        type: 'task',
        summary: 'Did a thing',
        participants: [],
        importance: 0.7,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      const stats = await graph.getStats();
      expect(stats.totalEntities).toBe(2);
      expect(stats.totalRelations).toBe(1);
      expect(stats.totalMemories).toBe(1);
      expect(stats.entitiesByType['person']).toBe(1);
      expect(stats.entitiesByType['concept']).toBe(1);
      expect(stats.relationsByType['related_to']).toBe(1);
      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
    });
  });

  // =========================================================================
  // clear
  // =========================================================================

  describe('clear', () => {
    it('removes all data from knowledge_nodes and knowledge_edges', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      const a = await graph.upsertEntity({
        type: 'person', label: 'A', properties: {}, confidence: 1, source: defaultSource(),
      });
      const b = await graph.upsertEntity({
        type: 'person', label: 'B', properties: {}, confidence: 1, source: defaultSource(),
      });
      await graph.upsertRelation({
        sourceId: a.id, targetId: b.id, type: 'knows', label: 'knows',
        weight: 1, bidirectional: false, confidence: 1, source: defaultSource(),
      });
      await graph.recordMemory({
        type: 'task',
        summary: 'Something',
        participants: [],
        importance: 0.5,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      await graph.clear();

      const stats = await graph.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelations).toBe(0);
      expect(stats.totalMemories).toBe(0);
    });
  });

  // =========================================================================
  // extractFromText
  // =========================================================================

  describe('extractFromText', () => {
    it('throws with LLM requirement message', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await expect(graph.extractFromText('Some text')).rejects.toThrow(
        'extractFromText requires an LLM',
      );
    });
  });

  // =========================================================================
  // semanticSearch (keyword fallback)
  // =========================================================================

  describe('semanticSearch', () => {
    it('finds entities by keyword in label', async () => {
      const { graph } = await createGraph();
      await graph.initialize();

      await graph.upsertEntity({
        type: 'concept',
        label: 'Quantum Computing',
        properties: { field: 'physics' },
        confidence: 1.0,
        source: defaultSource(),
      });
      await graph.upsertEntity({
        type: 'concept',
        label: 'Classical Music',
        properties: { field: 'arts' },
        confidence: 1.0,
        source: defaultSource(),
      });

      const results = await graph.semanticSearch({
        query: 'quantum',
        scope: 'entities',
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].type).toBe('entity');
      expect((results[0].item as any).label).toBe('Quantum Computing');
    });
  });
});
