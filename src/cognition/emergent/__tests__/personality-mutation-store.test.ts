/**
 * @fileoverview Unit tests for PersonalityMutationStore.
 *
 * Uses a mock IStorageAdapter to verify SQL generation, parameter binding,
 * row mapping, decay arithmetic, and pruning logic without requiring a
 * real SQLite database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonalityMutationStore } from '../PersonalityMutationStore.js';

// ---------------------------------------------------------------------------
// Mock storage adapter
// ---------------------------------------------------------------------------

const mockStorage = {
  run: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(undefined),
  all: vi.fn().mockResolvedValue([]),
  exec: vi.fn().mockResolvedValue(undefined),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersonalityMutationStore', () => {
  let store: PersonalityMutationStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PersonalityMutationStore(mockStorage);
  });

  it('records a personality mutation', async () => {
    await store.record({
      agentId: 'a1',
      trait: 'openness',
      delta: 0.1,
      reasoning: 'creative tasks',
      baselineValue: 0.7,
      mutatedValue: 0.8,
    });

    // ensureSchema calls exec once, then record calls run once
    expect(mockStorage.exec).toHaveBeenCalledTimes(1);
    expect(mockStorage.run).toHaveBeenCalledTimes(1);
    expect(mockStorage.run.mock.calls[0][0]).toContain('INSERT');
  });

  it('loads mutations for an agent', async () => {
    mockStorage.all.mockResolvedValueOnce([
      {
        id: 'm1',
        agent_id: 'a1',
        trait: 'openness',
        delta: 0.1,
        reasoning: 'creative tasks',
        strength: 0.9,
        baseline_value: 0.7,
        mutated_value: 0.8,
        created_at: 1000,
      },
    ]);

    const mutations = await store.loadForAgent('a1');

    expect(mutations.length).toBe(1);
    expect(mutations[0].trait).toBe('openness');
    expect(mutations[0].strength).toBe(0.9);
    expect(mutations[0].agentId).toBe('a1');
    expect(mutations[0].baselineValue).toBe(0.7);
    expect(mutations[0].mutatedValue).toBe(0.8);
  });

  it('decays mutations by rate and prunes below threshold', async () => {
    mockStorage.all.mockResolvedValueOnce([
      { id: 'm1', strength: 0.5 },
      { id: 'm2', strength: 0.08 },
    ]);

    const result = await store.decayAll(0.05);

    // m1: 0.5 - 0.05 = 0.45 > 0.1 → decayed (UPDATE)
    expect(result.decayed).toBe(1);

    // m2: 0.08 - 0.05 = 0.03 <= 0.1 → pruned (DELETE)
    expect(result.pruned).toBe(1);

    // Verify the UPDATE was called for m1 with the new strength
    const updateCall = mockStorage.run.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([0.45, 'm1']);

    // Verify the DELETE was called for m2
    const deleteCall = mockStorage.run.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(['m2']);
  });

  it('getEffectiveDeltas returns strength-weighted deltas', async () => {
    mockStorage.all.mockResolvedValueOnce([
      {
        id: 'm1',
        agent_id: 'a1',
        trait: 'openness',
        delta: 0.1,
        reasoning: 'creative tasks',
        strength: 0.8,
        baseline_value: 0.7,
        mutated_value: 0.8,
        created_at: 1000,
      },
      {
        id: 'm2',
        agent_id: 'a1',
        trait: 'openness',
        delta: 0.05,
        reasoning: 'exploratory conversation',
        strength: 0.6,
        baseline_value: 0.8,
        mutated_value: 0.85,
        created_at: 2000,
      },
    ]);

    const deltas = await store.getEffectiveDeltas('a1');

    // openness = (0.1 * 0.8) + (0.05 * 0.6) = 0.08 + 0.03 = 0.11
    expect(deltas.openness).toBeCloseTo(0.1 * 0.8 + 0.05 * 0.6);
  });
});
