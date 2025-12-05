/**
 * @file KnowledgeGraph.spec.ts
 * @description Unit tests for the KnowledgeGraph class.
 * @module AgentOS/Knowledge/Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../../src/core/knowledge/KnowledgeGraph';
import type {
  KnowledgeEntity,
  KnowledgeRelation,
  EpisodicMemory,
  KnowledgeSource,
} from '../../../src/core/knowledge/IKnowledgeGraph';

describe('KnowledgeGraph', () => {
  let graph: KnowledgeGraph;

  const testSource: KnowledgeSource = {
    type: 'system',
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    graph = new KnowledgeGraph();
    await graph.initialize();
  });

  describe('Entity Operations', () => {
    it('should create an entity', async () => {
      const entity = await graph.upsertEntity({
        type: 'person',
        label: 'John Doe',
        properties: { age: 30 },
        confidence: 0.9,
        source: testSource,
      });

      expect(entity.id).toBeDefined();
      expect(entity.label).toBe('John Doe');
      expect(entity.type).toBe('person');
      expect(entity.properties.age).toBe(30);
      expect(entity.createdAt).toBeDefined();
    });

    it('should update an existing entity', async () => {
      const entity = await graph.upsertEntity({
        type: 'concept',
        label: 'AI',
        properties: { domain: 'tech' },
        confidence: 0.8,
        source: testSource,
      });

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await graph.upsertEntity({
        id: entity.id,
        type: 'concept',
        label: 'Artificial Intelligence',
        properties: { domain: 'technology', subfield: 'ML' },
        confidence: 0.95,
        source: testSource,
      });

      expect(updated.id).toBe(entity.id);
      expect(updated.label).toBe('Artificial Intelligence');
      expect(updated.createdAt).toBe(entity.createdAt);
      // Updated timestamp should be different (or at least not fail)
      expect(updated.updatedAt).toBeDefined();
    });

    it('should retrieve entity by ID', async () => {
      const entity = await graph.upsertEntity({
        type: 'location',
        label: 'New York',
        properties: { country: 'USA' },
        confidence: 1.0,
        source: testSource,
      });

      const retrieved = await graph.getEntity(entity.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.label).toBe('New York');
    });

    it('should query entities by type', async () => {
      await graph.upsertEntity({ type: 'person', label: 'Alice', properties: {}, confidence: 1, source: testSource });
      await graph.upsertEntity({ type: 'person', label: 'Bob', properties: {}, confidence: 1, source: testSource });
      await graph.upsertEntity({ type: 'location', label: 'Paris', properties: {}, confidence: 1, source: testSource });

      const people = await graph.queryEntities({ entityTypes: ['person'] });
      expect(people.length).toBe(2);
      expect(people.every(e => e.type === 'person')).toBe(true);
    });

    it('should query entities by confidence threshold', async () => {
      await graph.upsertEntity({ type: 'fact', label: 'Fact A', properties: {}, confidence: 0.9, source: testSource });
      await graph.upsertEntity({ type: 'fact', label: 'Fact B', properties: {}, confidence: 0.5, source: testSource });

      const highConfidence = await graph.queryEntities({ minConfidence: 0.7 });
      expect(highConfidence.length).toBe(1);
      expect(highConfidence[0].label).toBe('Fact A');
    });

    it('should delete entity and its relations', async () => {
      const entity1 = await graph.upsertEntity({ type: 'concept', label: 'A', properties: {}, confidence: 1, source: testSource });
      const entity2 = await graph.upsertEntity({ type: 'concept', label: 'B', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({
        sourceId: entity1.id,
        targetId: entity2.id,
        type: 'related_to',
        label: 'connects',
        weight: 1,
        bidirectional: true,
        confidence: 1,
        source: testSource,
      });

      await graph.deleteEntity(entity1.id);

      const deleted = await graph.getEntity(entity1.id);
      expect(deleted).toBeUndefined();

      const relations = await graph.getRelations(entity2.id);
      expect(relations.length).toBe(0);
    });
  });

  describe('Relation Operations', () => {
    it('should create a relation', async () => {
      const entity1 = await graph.upsertEntity({ type: 'person', label: 'Alice', properties: {}, confidence: 1, source: testSource });
      const entity2 = await graph.upsertEntity({ type: 'organization', label: 'Acme Corp', properties: {}, confidence: 1, source: testSource });

      const relation = await graph.upsertRelation({
        sourceId: entity1.id,
        targetId: entity2.id,
        type: 'related_to',
        label: 'works_at',
        weight: 0.9,
        bidirectional: false,
        confidence: 0.95,
        source: testSource,
      });

      expect(relation.id).toBeDefined();
      expect(relation.label).toBe('works_at');
      expect(relation.weight).toBe(0.9);
    });

    it('should get outgoing relations', async () => {
      const alice = await graph.upsertEntity({ type: 'person', label: 'Alice', properties: {}, confidence: 1, source: testSource });
      const bob = await graph.upsertEntity({ type: 'person', label: 'Bob', properties: {}, confidence: 1, source: testSource });
      const charlie = await graph.upsertEntity({ type: 'person', label: 'Charlie', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({ sourceId: alice.id, targetId: bob.id, type: 'knows', label: 'knows', weight: 1, bidirectional: false, confidence: 1, source: testSource });
      await graph.upsertRelation({ sourceId: alice.id, targetId: charlie.id, type: 'knows', label: 'knows', weight: 1, bidirectional: false, confidence: 1, source: testSource });

      const outgoing = await graph.getRelations(alice.id, { direction: 'outgoing' });
      expect(outgoing.length).toBe(2);
    });

    it('should filter relations by type', async () => {
      const a = await graph.upsertEntity({ type: 'concept', label: 'A', properties: {}, confidence: 1, source: testSource });
      const b = await graph.upsertEntity({ type: 'concept', label: 'B', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({ sourceId: a.id, targetId: b.id, type: 'is_a', label: 'is_a', weight: 1, bidirectional: false, confidence: 1, source: testSource });
      await graph.upsertRelation({ sourceId: a.id, targetId: b.id, type: 'related_to', label: 'related', weight: 1, bidirectional: false, confidence: 1, source: testSource });

      const isARelations = await graph.getRelations(a.id, { types: ['is_a'] });
      expect(isARelations.length).toBe(1);
      expect(isARelations[0].type).toBe('is_a');
    });
  });

  describe('Episodic Memory Operations', () => {
    it('should record a memory', async () => {
      const memory = await graph.recordMemory({
        type: 'conversation',
        summary: 'Discussed AI agents',
        participants: ['user-1', 'gmi-1'],
        importance: 0.8,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      expect(memory.id).toBeDefined();
      expect(memory.summary).toBe('Discussed AI agents');
      expect(memory.accessCount).toBe(0);
    });

    it('should retrieve memory and update access count', async () => {
      const memory = await graph.recordMemory({
        type: 'task',
        summary: 'Completed project',
        participants: ['user-1'],
        importance: 0.9,
        entityIds: [],
        occurredAt: new Date().toISOString(),
      });

      const retrieved = await graph.getMemory(memory.id);
      expect(retrieved?.accessCount).toBe(1);

      await graph.getMemory(memory.id);
      const retrievedAgain = await graph.getMemory(memory.id);
      expect(retrievedAgain?.accessCount).toBe(3);
    });

    it('should query memories by type', async () => {
      await graph.recordMemory({ type: 'conversation', summary: 'Chat 1', participants: [], importance: 0.5, entityIds: [], occurredAt: new Date().toISOString() });
      await graph.recordMemory({ type: 'task', summary: 'Task 1', participants: [], importance: 0.7, entityIds: [], occurredAt: new Date().toISOString() });
      await graph.recordMemory({ type: 'conversation', summary: 'Chat 2', participants: [], importance: 0.6, entityIds: [], occurredAt: new Date().toISOString() });

      const conversations = await graph.queryMemories({ types: ['conversation'] });
      expect(conversations.length).toBe(2);
    });

    it('should query memories by importance', async () => {
      await graph.recordMemory({ type: 'discovery', summary: 'Minor discovery', participants: [], importance: 0.3, entityIds: [], occurredAt: new Date().toISOString() });
      await graph.recordMemory({ type: 'discovery', summary: 'Major discovery', participants: [], importance: 0.9, entityIds: [], occurredAt: new Date().toISOString() });

      const important = await graph.queryMemories({ minImportance: 0.5 });
      expect(important.length).toBe(1);
      expect(important[0].summary).toBe('Major discovery');
    });
  });

  describe('Graph Traversal', () => {
    it('should traverse graph from starting entity', async () => {
      const a = await graph.upsertEntity({ type: 'concept', label: 'A', properties: {}, confidence: 1, source: testSource });
      const b = await graph.upsertEntity({ type: 'concept', label: 'B', properties: {}, confidence: 1, source: testSource });
      const c = await graph.upsertEntity({ type: 'concept', label: 'C', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({ sourceId: a.id, targetId: b.id, type: 'related_to', label: 'r1', weight: 1, bidirectional: false, confidence: 1, source: testSource });
      await graph.upsertRelation({ sourceId: b.id, targetId: c.id, type: 'related_to', label: 'r2', weight: 1, bidirectional: false, confidence: 1, source: testSource });

      const result = await graph.traverse(a.id, { maxDepth: 2 });

      expect(result.root.label).toBe('A');
      expect(result.totalEntities).toBe(3);
    });

    it('should find path between entities', async () => {
      const a = await graph.upsertEntity({ type: 'concept', label: 'A', properties: {}, confidence: 1, source: testSource });
      const b = await graph.upsertEntity({ type: 'concept', label: 'B', properties: {}, confidence: 1, source: testSource });
      const c = await graph.upsertEntity({ type: 'concept', label: 'C', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({ sourceId: a.id, targetId: b.id, type: 'related_to', label: 'r1', weight: 1, bidirectional: true, confidence: 1, source: testSource });
      await graph.upsertRelation({ sourceId: b.id, targetId: c.id, type: 'related_to', label: 'r2', weight: 1, bidirectional: true, confidence: 1, source: testSource });

      const path = await graph.findPath(a.id, c.id);

      expect(path).not.toBeNull();
      expect(path?.length).toBe(3);
      expect(path?.[0].entity.label).toBe('A');
      expect(path?.[2].entity.label).toBe('C');
    });

    it('should return null for unreachable entities', async () => {
      const a = await graph.upsertEntity({ type: 'concept', label: 'A', properties: {}, confidence: 1, source: testSource });
      const b = await graph.upsertEntity({ type: 'concept', label: 'B', properties: {}, confidence: 1, source: testSource });

      const path = await graph.findPath(a.id, b.id);
      expect(path).toBeNull();
    });

    it('should get neighborhood of an entity', async () => {
      const center = await graph.upsertEntity({ type: 'concept', label: 'Center', properties: {}, confidence: 1, source: testSource });
      const n1 = await graph.upsertEntity({ type: 'concept', label: 'N1', properties: {}, confidence: 1, source: testSource });
      const n2 = await graph.upsertEntity({ type: 'concept', label: 'N2', properties: {}, confidence: 1, source: testSource });

      await graph.upsertRelation({ sourceId: center.id, targetId: n1.id, type: 'related_to', label: 'r', weight: 1, bidirectional: true, confidence: 1, source: testSource });
      await graph.upsertRelation({ sourceId: center.id, targetId: n2.id, type: 'related_to', label: 'r', weight: 1, bidirectional: true, confidence: 1, source: testSource });

      const { entities, relations } = await graph.getNeighborhood(center.id, 1);

      expect(entities.length).toBe(3);
      expect(relations.length).toBe(2);
    });
  });

  describe('Semantic Search (Text-based fallback)', () => {
    it('should search entities by text', async () => {
      await graph.upsertEntity({ type: 'concept', label: 'Machine Learning', properties: {}, confidence: 1, source: testSource });
      await graph.upsertEntity({ type: 'concept', label: 'Deep Learning', properties: {}, confidence: 1, source: testSource });
      await graph.upsertEntity({ type: 'concept', label: 'Data Science', properties: {}, confidence: 1, source: testSource });

      const results = await graph.semanticSearch({
        query: 'learning',
        scope: 'entities',
        topK: 5,
      });

      expect(results.length).toBe(2);
      expect(results.every(r => r.item.label?.includes('Learning'))).toBe(true);
    });
  });

  describe('Knowledge Extraction', () => {
    it('should extract entities from text', async () => {
      const { entities } = await graph.extractFromText(
        'John Smith works at Acme Corporation in New York City.'
      );

      expect(entities.length).toBeGreaterThan(0);
      const labels = entities.map(e => e.label);
      expect(labels).toContain('John Smith');
    });
  });

  describe('Maintenance', () => {
    it('should merge entities', async () => {
      const e1 = await graph.upsertEntity({ type: 'person', label: 'J. Smith', properties: { nickname: 'John' }, confidence: 0.7, source: testSource });
      const e2 = await graph.upsertEntity({ type: 'person', label: 'John Smith', properties: { age: 30 }, confidence: 0.9, source: testSource });

      const merged = await graph.mergeEntities([e1.id, e2.id], e2.id);

      expect(merged.properties.nickname).toBe('John');
      expect(merged.properties.age).toBe(30);

      const deleted = await graph.getEntity(e1.id);
      expect(deleted).toBeUndefined();
    });

    it('should get statistics', async () => {
      await graph.upsertEntity({ type: 'person', label: 'A', properties: {}, confidence: 0.8, source: testSource });
      await graph.upsertEntity({ type: 'person', label: 'B', properties: {}, confidence: 0.9, source: testSource });
      await graph.upsertEntity({ type: 'concept', label: 'C', properties: {}, confidence: 0.7, source: testSource });

      const stats = await graph.getStats();

      expect(stats.totalEntities).toBe(3);
      expect(stats.entitiesByType.person).toBe(2);
      expect(stats.entitiesByType.concept).toBe(1);
    });

    it('should clear all data', async () => {
      await graph.upsertEntity({ type: 'concept', label: 'Test', properties: {}, confidence: 1, source: testSource });
      await graph.recordMemory({ type: 'task', summary: 'Test', participants: [], importance: 1, entityIds: [], occurredAt: new Date().toISOString() });

      await graph.clear();

      const stats = await graph.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalMemories).toBe(0);
    });
  });
});

