/**
 * @fileoverview Tests for PerspectiveObserver.
 * @module agentos/memory/observation/__tests__/PerspectiveObserver.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PerspectiveObserver,
  type ObservedEvent,
  type Witness,
} from '../PerspectiveObserver.js';

function makeEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
    eventId: overrides.eventId ?? 'evt_001',
    content: overrides.content ?? 'The dragon attacked the village.',
    playerAction: overrides.playerAction ?? 'I charged at the dragon.',
    narratorProse: overrides.narratorProse ?? 'Flames engulfed the rooftops.',
    importance: overrides.importance ?? 0.8,
    emotionalContext: overrides.emotionalContext ?? {
      valence: -0.5, arousal: 0.8, dominance: -0.3, intensity: 0.4, gmiMood: 'anxious',
    },
    entities: overrides.entities ?? ['dragon', 'player', 'village'],
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

function makeWitness(overrides: Partial<Witness> = {}): Witness {
  return {
    agentId: overrides.agentId ?? 'npc_lyra',
    agentName: overrides.agentName ?? 'Lyra',
    hexaco: overrides.hexaco ?? { honesty: 0.8, emotionality: 0.7, extraversion: 0.4, agreeableness: 0.6, conscientiousness: 0.5, openness: 0.9 },
    mood: overrides.mood ?? { valence: 0.3, arousal: 0.6, dominance: 0.2 },
    relationships: overrides.relationships ?? [
      { entityName: 'player', disposition: 'friendly', trustLevel: 0.7 },
    ],
    tier: overrides.tier ?? 'important',
  };
}

function createMockLlm(responses: string[]) {
  let callIndex = 0;
  return vi.fn(async (_system: string, _user: string): Promise<string> => {
    const response = responses[callIndex] ?? '["Fallback memory."]';
    callIndex++;
    return response;
  });
}

describe('PerspectiveObserver', () => {
  describe('gating', () => {
    it('skips events below importance threshold', async () => {
      const llm = createMockLlm([]);
      const observer = new PerspectiveObserver({ llmInvoker: llm, importanceThreshold: 0.5 });

      const result = await observer.rewrite(
        [makeEvent({ importance: 0.2 })],
        [makeWitness()],
      );

      expect(llm).not.toHaveBeenCalled();
      expect(result.traces).toHaveLength(0);
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('importance');
    });

    it('skips combatant-tier witnesses', async () => {
      const llm = createMockLlm([]);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite(
        [makeEvent()],
        [makeWitness({ tier: 'combatant' })],
      );

      expect(llm).not.toHaveBeenCalled();
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('tier');
    });

    it('skips witnesses with no entity overlap', async () => {
      const llm = createMockLlm([]);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite(
        [makeEvent({ entities: ['goblin', 'cave'] })],
        [makeWitness({ relationships: [{ entityName: 'player', disposition: 'friendly', trustLevel: 0.5 }] })],
      );

      expect(llm).not.toHaveBeenCalled();
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('overlap');
    });

    it('includes witness when their name appears in event entities', async () => {
      const llm = createMockLlm(['["I remember being part of this."]']);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite(
        [makeEvent({ entities: ['Lyra', 'goblin'] })],
        [makeWitness({ agentName: 'Lyra', relationships: [] })],
      );

      expect(llm).toHaveBeenCalledTimes(1);
      expect(result.traces).toHaveLength(1);
    });
  });

  describe('rewriting', () => {
    it('produces subjective traces for qualifying witnesses', async () => {
      const llm = createMockLlm(['["I watched in horror as the dragon swooped down on our village."]']);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite(
        [makeEvent()],
        [makeWitness()],
      );

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].witnessId).toBe('npc_lyra');
      expect(result.traces[0].content).toContain('horror');
      expect(result.traces[0].sourceEventId).toBe('evt_001');
      expect(result.traces[0].perspectiveMetadata.hexacoSnapshot.openness).toBe(0.9);
      expect(result.llmCallCount).toBe(1);
    });

    it('produces different traces for different witnesses', async () => {
      const llm = createMockLlm([
        '["I watched in horror as the dragon attacked."]',
        '["Good. The beast will thin the weak."]',
      ]);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const lyra = makeWitness({ agentId: 'lyra', agentName: 'Lyra' });
      const holt = makeWitness({
        agentId: 'holt',
        agentName: 'Holt',
        hexaco: { honesty: 0.3, emotionality: 0.2, extraversion: 0.8, agreeableness: 0.2, conscientiousness: 0.3, openness: 0.3 },
        relationships: [{ entityName: 'player', disposition: 'hostile', trustLevel: -0.5 }],
      });

      const result = await observer.rewrite([makeEvent()], [lyra, holt]);

      expect(result.traces).toHaveLength(2);
      expect(result.traces[0].witnessId).toBe('lyra');
      expect(result.traces[1].witnessId).toBe('holt');
      expect(result.traces[0].content).not.toBe(result.traces[1].content);
      expect(result.llmCallCount).toBe(2);
    });
  });

  describe('batching', () => {
    it('batches events into groups of batchSize', async () => {
      const events = Array.from({ length: 15 }, (_, i) =>
        makeEvent({ eventId: `evt_${i}`, content: `Event ${i} happened.` }),
      );
      const llm = createMockLlm([
        JSON.stringify(Array.from({ length: 10 }, (_, i) => `Memory of event ${i}.`)),
        JSON.stringify(Array.from({ length: 5 }, (_, i) => `Memory of event ${i + 10}.`)),
      ]);
      const observer = new PerspectiveObserver({ llmInvoker: llm, batchSize: 10 });

      const result = await observer.rewrite(events, [makeWitness()]);

      expect(llm).toHaveBeenCalledTimes(2);
      expect(result.traces).toHaveLength(15);
      expect(result.llmCallCount).toBe(2);
    });
  });

  describe('fallback', () => {
    it('falls back on invalid JSON response', async () => {
      const llm = createMockLlm(['not valid json at all']);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite([makeEvent()], [makeWitness()]);

      expect(result.traces).toHaveLength(0);
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('parse');
    });

    it('falls back when LLM returns wrong count', async () => {
      const llm = createMockLlm(['["Only one memory."]']);
      const events = [makeEvent({ eventId: 'e1' }), makeEvent({ eventId: 'e2' })];
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite(events, [makeWitness()]);

      expect(result.traces).toHaveLength(0);
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('count');
    });

    it('falls back when LLM throws', async () => {
      const llm = vi.fn(async () => { throw new Error('model unavailable'); });
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite([makeEvent()], [makeWitness()]);

      expect(result.traces).toHaveLength(0);
      expect(result.fallbacks).toHaveLength(1);
      expect(result.fallbacks[0].reason).toContain('model unavailable');
    });
  });

  describe('metadata', () => {
    it('includes originalEventHash in subjective traces', async () => {
      const llm = createMockLlm(['["I remember the fire."]']);
      const observer = new PerspectiveObserver({ llmInvoker: llm });

      const result = await observer.rewrite([makeEvent()], [makeWitness()]);

      expect(result.traces[0].originalEventHash).toBeTruthy();
      expect(typeof result.traces[0].originalEventHash).toBe('string');
      expect(result.traces[0].originalEventHash.length).toBeGreaterThan(10);
    });

    it('snapshots witness state in perspectiveMetadata', async () => {
      const llm = createMockLlm(['["Memory."]']);
      const observer = new PerspectiveObserver({ llmInvoker: llm });
      const witness = makeWitness();

      const result = await observer.rewrite([makeEvent()], [witness]);

      const meta = result.traces[0].perspectiveMetadata;
      expect(meta.hexacoSnapshot).toEqual(witness.hexaco);
      expect(meta.moodSnapshot).toEqual(witness.mood);
      expect(meta.relationshipSnapshot).toHaveLength(1);
      expect(meta.relationshipSnapshot[0].entityName).toBe('player');
    });
  });
});
