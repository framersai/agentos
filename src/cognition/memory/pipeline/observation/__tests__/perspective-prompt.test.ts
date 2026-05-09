/**
 * @fileoverview Tests for perspective prompt builders.
 * @module agentos/memory/observation/__tests__/perspective-prompt.test
 */

import { describe, it, expect } from 'vitest';
import {
  buildPerspectiveSystemPrompt,
  buildPerspectiveUserPrompt,
} from '../perspective-prompt.js';
import type { Witness, ObservedEvent } from '../PerspectiveObserver.js';

const testWitness: Witness = {
  agentId: 'npc_lyra',
  agentName: 'Lyra',
  hexaco: { honesty: 0.8, emotionality: 0.7, extraversion: 0.4, agreeableness: 0.6, conscientiousness: 0.5, openness: 0.9 },
  mood: { valence: 0.3, arousal: 0.6, dominance: 0.2 },
  relationships: [
    { entityName: 'player', disposition: 'friendly', trustLevel: 0.7 },
    { entityName: 'Vex', disposition: 'hostile', trustLevel: -0.9 },
  ],
  tier: 'important',
};

const testEvents: ObservedEvent[] = [
  {
    eventId: 'evt_001',
    content: 'The dragon Vex attacked the village at dawn.',
    playerAction: 'I drew my sword and charged at the dragon.',
    narratorProse: 'Vex swooped low, flame scorching the rooftops.',
    importance: 0.8,
    emotionalContext: { valence: -0.5, arousal: 0.9, dominance: -0.3, intensity: 0.45, gmiMood: 'terrified' },
    entities: ['Vex', 'player', 'village'],
    timestamp: Date.now(),
  },
];

describe('buildPerspectiveSystemPrompt', () => {
  it('includes agent name', () => {
    const prompt = buildPerspectiveSystemPrompt(testWitness);
    expect(prompt).toContain('Lyra');
  });

  it('includes HEXACO values', () => {
    const prompt = buildPerspectiveSystemPrompt(testWitness);
    expect(prompt).toContain('0.8');
    expect(prompt).toContain('0.7');
    expect(prompt).toContain('0.9');
  });

  it('includes mood values', () => {
    const prompt = buildPerspectiveSystemPrompt(testWitness);
    expect(prompt).toContain('valence=0.3');
    expect(prompt).toContain('arousal=0.6');
    expect(prompt).toContain('dominance=0.2');
  });

  it('includes relationships with disposition and trust', () => {
    const prompt = buildPerspectiveSystemPrompt(testWitness);
    expect(prompt).toContain('player');
    expect(prompt).toContain('friendly');
    expect(prompt).toContain('0.7');
    expect(prompt).toContain('Vex');
    expect(prompt).toContain('hostile');
    expect(prompt).toContain('-0.9');
  });

  it('handles witness with no relationships', () => {
    const lonely: Witness = { ...testWitness, relationships: [] };
    const prompt = buildPerspectiveSystemPrompt(lonely);
    expect(prompt).toContain('No known relationships');
  });
});

describe('buildPerspectiveUserPrompt', () => {
  it('formats events as numbered list', () => {
    const prompt = buildPerspectiveUserPrompt(testEvents);
    expect(prompt).toContain('1.');
    expect(prompt).toContain('Vex attacked');
  });

  it('handles multiple events', () => {
    const multi = [
      ...testEvents,
      { ...testEvents[0], eventId: 'evt_002', content: 'The villagers fled in panic.' },
    ];
    const prompt = buildPerspectiveUserPrompt(multi);
    expect(prompt).toContain('1.');
    expect(prompt).toContain('2.');
    expect(prompt).toContain('villagers fled');
  });
});
