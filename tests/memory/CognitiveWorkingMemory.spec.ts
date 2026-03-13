/**
 * @fileoverview Unit tests for Baddeley's working memory model.
 * Tests slot capacity, personality modulation, eviction, rehearsal, decay.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CognitiveWorkingMemory } from '../../src/memory/working/CognitiveWorkingMemory';
import type { IWorkingMemory } from '../../src/cognitive_substrate/memory/IWorkingMemory';

// ---------------------------------------------------------------------------
// Mock IWorkingMemory
// ---------------------------------------------------------------------------

function createMockBacking(): IWorkingMemory {
  const store = new Map<string, any>();
  return {
    id: 'mock-wm',
    initialize: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(async (key: string, value: any) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key)),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    getAll: vi.fn(async () => Object.fromEntries(store)),
    clear: vi.fn(async () => { store.clear(); }),
    size: vi.fn(async () => store.size),
    has: vi.fn(async (key: string) => store.has(key)),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('CognitiveWorkingMemory', () => {
  let backing: IWorkingMemory;
  let wm: CognitiveWorkingMemory;

  beforeEach(() => {
    backing = createMockBacking();
    wm = new CognitiveWorkingMemory(backing, {
      baseCapacity: 7,
      traits: {},
      activationDecayRate: 0.1,
      minActivation: 0.15,
    });
  });

  describe('capacity', () => {
    it('defaults to base capacity of 7', () => {
      expect(wm.getCapacity()).toBe(7);
    });

    it('high openness increases capacity by 1', () => {
      const cwm = new CognitiveWorkingMemory(backing, {
        baseCapacity: 7,
        traits: { openness: 0.9 },
        activationDecayRate: 0.1,
        minActivation: 0.15,
      });
      expect(cwm.getCapacity()).toBe(8);
    });

    it('high conscientiousness decreases capacity by 1', () => {
      const cwm = new CognitiveWorkingMemory(backing, {
        baseCapacity: 7,
        traits: { conscientiousness: 0.9 },
        activationDecayRate: 0.1,
        minActivation: 0.15,
      });
      expect(cwm.getCapacity()).toBe(6);
    });

    it('clamps capacity to [5, 9]', () => {
      const lowCap = new CognitiveWorkingMemory(backing, {
        baseCapacity: 5,
        traits: { conscientiousness: 1.0 },
        activationDecayRate: 0.1,
        minActivation: 0.15,
      });
      expect(lowCap.getCapacity()).toBeGreaterThanOrEqual(5);

      const highCap = new CognitiveWorkingMemory(backing, {
        baseCapacity: 9,
        traits: { openness: 1.0 },
        activationDecayRate: 0.1,
        minActivation: 0.15,
      });
      expect(highCap.getCapacity()).toBeLessThanOrEqual(9);
    });
  });

  describe('focus (slot management)', () => {
    it('adds a trace to working memory', async () => {
      await wm.focus('trace-1', 0.8);
      expect(wm.getSlotCount()).toBe(1);
    });

    it('returns a slot ID', async () => {
      const slotId = await wm.focus('trace-1', 0.8);
      expect(slotId).toBeDefined();
      expect(typeof slotId).toBe('string');
    });

    it('refreshes activation if trace already has a slot', async () => {
      const slotId = await wm.focus('trace-1', 0.5);
      await wm.focus('trace-1', 0.5);

      expect(wm.getSlotCount()).toBe(1);
      const slot = wm.getSlot(slotId);
      expect(slot!.activationLevel).toBeGreaterThan(0.5);
    });

    it('evicts lowest-activation slot when at capacity', async () => {
      const onEvict = vi.fn().mockResolvedValue(undefined);
      // Minimum capacity after [5,9] clamp is 5
      const smallWm = new CognitiveWorkingMemory(backing, {
        baseCapacity: 5,
        traits: {},
        activationDecayRate: 0.1,
        minActivation: 0.15,
        onEvict,
      });

      await smallWm.focus('trace-1', 0.3);
      await smallWm.focus('trace-2', 0.5);
      await smallWm.focus('trace-3', 0.8);
      await smallWm.focus('trace-4', 0.6);
      await smallWm.focus('trace-5', 0.7);

      // At capacity (5) — adding a 6th should evict trace-1 (lowest activation)
      await smallWm.focus('trace-6', 0.9);

      expect(smallWm.getSlotCount()).toBe(5);
      expect(onEvict).toHaveBeenCalledWith(expect.any(String), 'trace-1');
    });

    it('caps initial activation at 1.0', async () => {
      const slotId = await wm.focus('trace-1', 1.5);
      const slot = wm.getSlot(slotId);
      expect(slot!.activationLevel).toBeLessThanOrEqual(1.0);
    });
  });

  describe('rehearse', () => {
    it('increases activation by 0.15', async () => {
      const slotId = await wm.focus('trace-1', 0.5);
      wm.rehearse(slotId);
      const slot = wm.getSlot(slotId);
      expect(slot!.activationLevel).toBeCloseTo(0.65);
    });

    it('increments rehearsal count', async () => {
      const slotId = await wm.focus('trace-1', 0.5);
      wm.rehearse(slotId);
      wm.rehearse(slotId);
      const slot = wm.getSlot(slotId);
      expect(slot!.rehearsalCount).toBe(2);
    });

    it('caps activation at 1.0', async () => {
      const slotId = await wm.focus('trace-1', 0.95);
      wm.rehearse(slotId);
      const slot = wm.getSlot(slotId);
      expect(slot!.activationLevel).toBeLessThanOrEqual(1.0);
    });
  });

  describe('decayActivations', () => {
    it('reduces all slot activations', async () => {
      const slotId = await wm.focus('trace-1', 0.5);
      await wm.decayActivations();
      const slot = wm.getSlot(slotId);
      expect(slot!.activationLevel).toBeCloseTo(0.4);
    });

    it('evicts slots that drop below minActivation', async () => {
      await wm.focus('trace-1', 0.2); // Just above minActivation
      const evicted = await wm.decayActivations();
      expect(evicted.length).toBe(1);
      expect(wm.getSlotCount()).toBe(0);
    });

    it('does not evict slots above minActivation', async () => {
      await wm.focus('trace-1', 0.8);
      const evicted = await wm.decayActivations();
      expect(evicted.length).toBe(0);
      expect(wm.getSlotCount()).toBe(1);
    });
  });

  describe('utilization', () => {
    it('returns 0 when empty', () => {
      expect(wm.getUtilization()).toBe(0);
    });

    it('returns fraction of capacity used', async () => {
      await wm.focus('trace-1', 0.8);
      await wm.focus('trace-2', 0.8);
      expect(wm.getUtilization()).toBeCloseTo(2 / 7);
    });
  });

  describe('formatForPrompt', () => {
    it('returns empty string when no slots', () => {
      expect(wm.formatForPrompt()).toBe('');
    });

    it('includes activation level in output', async () => {
      await wm.focus('trace-1', 0.8);
      const output = wm.formatForPrompt();
      expect(output).toContain('trace-1');
      expect(output).toContain('0.80');
    });

    it('sorts by activation descending', async () => {
      await wm.focus('trace-low', 0.3);
      await wm.focus('trace-high', 0.9);
      const output = wm.formatForPrompt();
      const lines = output.split('\n');
      expect(lines[0]).toContain('trace-high');
      expect(lines[1]).toContain('trace-low');
    });
  });

  describe('IWorkingMemory backward compatibility', () => {
    it('delegates set/get to backing store', async () => {
      await wm.set('key1', 'value1');
      expect(backing.set).toHaveBeenCalledWith('key1', 'value1');

      await wm.get('key1');
      expect(backing.get).toHaveBeenCalledWith('key1');
    });

    it('delegates clear and clears slots', async () => {
      await wm.focus('trace-1', 0.8);
      await wm.clear();
      expect(wm.getSlotCount()).toBe(0);
      expect(backing.clear).toHaveBeenCalled();
    });
  });
});
