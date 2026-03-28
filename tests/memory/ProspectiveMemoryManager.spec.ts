/**
 * @fileoverview Unit tests for the prospective memory manager.
 * Tests time-based, event-based, and context-based trigger types.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProspectiveMemoryManager } from '../../src/memory/retrieval/prospective/ProspectiveMemoryManager';

describe('ProspectiveMemoryManager', () => {
  let pm: ProspectiveMemoryManager;

  beforeEach(() => {
    pm = new ProspectiveMemoryManager();
  });

  describe('register', () => {
    it('registers a time-based item', async () => {
      const item = await pm.register({
        content: 'Remind me at noon',
        triggerType: 'time_based',
        triggerAt: Date.now() + 3_600_000,
        importance: 0.8,
        recurring: false,
      });

      expect(item.id).toBeDefined();
      expect(item.triggerType).toBe('time_based');
      expect(item.triggered).toBe(false);
      expect(pm.getCount()).toBe(1);
    });

    it('registers an event-based item', async () => {
      const item = await pm.register({
        content: 'When deployment happens, check logs',
        triggerType: 'event_based',
        triggerEvent: 'deployment',
        importance: 0.9,
        recurring: false,
      });

      expect(item.triggerEvent).toBe('deployment');
    });

    it('registers a context-based item', async () => {
      const item = await pm.register({
        content: 'When user mentions cooking, suggest recipe',
        triggerType: 'context_based',
        cueText: 'cooking recipes',
        importance: 0.6,
        recurring: true,
      });

      expect(item.recurring).toBe(true);
    });
  });

  describe('check (time-based)', () => {
    it('triggers when current time >= triggerAt', async () => {
      const triggerAt = Date.now() - 1000; // Already past
      await pm.register({
        content: 'Past deadline',
        triggerType: 'time_based',
        triggerAt,
        importance: 0.7,
        recurring: false,
      });

      const triggered = await pm.check({ now: Date.now() });
      expect(triggered).toHaveLength(1);
      expect(triggered[0].content).toBe('Past deadline');
    });

    it('does not trigger before triggerAt', async () => {
      await pm.register({
        content: 'Future event',
        triggerType: 'time_based',
        triggerAt: Date.now() + 999_999_999,
        importance: 0.7,
        recurring: false,
      });

      const triggered = await pm.check({ now: Date.now() });
      expect(triggered).toHaveLength(0);
    });
  });

  describe('check (event-based)', () => {
    it('triggers when matching event occurs', async () => {
      await pm.register({
        content: 'Handle deployment',
        triggerType: 'event_based',
        triggerEvent: 'deployment',
        importance: 0.9,
        recurring: false,
      });

      const triggered = await pm.check({ events: ['deployment'] });
      expect(triggered).toHaveLength(1);
    });

    it('does not trigger for non-matching events', async () => {
      await pm.register({
        content: 'Handle deployment',
        triggerType: 'event_based',
        triggerEvent: 'deployment',
        importance: 0.9,
        recurring: false,
      });

      const triggered = await pm.check({ events: ['login'] });
      expect(triggered).toHaveLength(0);
    });
  });

  describe('triggered state', () => {
    it('marks items as triggered after firing', async () => {
      await pm.register({
        content: 'One-shot reminder',
        triggerType: 'time_based',
        triggerAt: Date.now() - 1000,
        importance: 0.7,
        recurring: false,
      });

      await pm.check({ now: Date.now() });

      // Should not fire again
      const secondCheck = await pm.check({ now: Date.now() });
      expect(secondCheck).toHaveLength(0);
    });

    it('recurring items fire again after being triggered', async () => {
      await pm.register({
        content: 'Recurring reminder',
        triggerType: 'time_based',
        triggerAt: Date.now() - 1000,
        importance: 0.7,
        recurring: true,
      });

      const first = await pm.check({ now: Date.now() });
      expect(first).toHaveLength(1);

      // Recurring items fire every time conditions are met
      const second = await pm.check({ now: Date.now() });
      expect(second).toHaveLength(1);
    });
  });

  describe('sorting', () => {
    it('returns triggered items sorted by importance descending', async () => {
      await pm.register({
        content: 'Low priority',
        triggerType: 'time_based',
        triggerAt: Date.now() - 1000,
        importance: 0.3,
        recurring: true,
      });

      await pm.register({
        content: 'High priority',
        triggerType: 'time_based',
        triggerAt: Date.now() - 1000,
        importance: 0.9,
        recurring: true,
      });

      const triggered = await pm.check({ now: Date.now() });
      expect(triggered[0].importance).toBeGreaterThan(triggered[1].importance);
    });
  });

  describe('remove and getActive', () => {
    it('removes an item by ID', async () => {
      const item = await pm.register({
        content: 'To be removed',
        triggerType: 'time_based',
        triggerAt: Date.now() + 99999,
        importance: 0.5,
        recurring: false,
      });

      expect(pm.remove(item.id)).toBe(true);
      expect(pm.getCount()).toBe(0);
    });

    it('getActive returns only untriggered or recurring items', async () => {
      await pm.register({
        content: 'One-shot triggered',
        triggerType: 'time_based',
        triggerAt: Date.now() - 1000,
        importance: 0.5,
        recurring: false,
      });

      await pm.register({
        content: 'Still active',
        triggerType: 'time_based',
        triggerAt: Date.now() + 999999,
        importance: 0.5,
        recurring: false,
      });

      await pm.check({ now: Date.now() }); // Triggers the first one

      const active = pm.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe('Still active');
    });
  });

  describe('clear', () => {
    it('removes all items', async () => {
      await pm.register({ content: 'A', triggerType: 'time_based', importance: 0.5, recurring: false });
      await pm.register({ content: 'B', triggerType: 'event_based', triggerEvent: 'x', importance: 0.5, recurring: false });

      pm.clear();
      expect(pm.getCount()).toBe(0);
    });
  });
});
