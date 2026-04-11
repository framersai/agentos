# PerspectiveObserver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-agent subjective memory encoding — each witness of an event gets a first-person LLM rewrite through their HEXACO personality, mood, and relationships before the trace is stored in their brain.

**Architecture:** `PerspectiveObserver` is a standalone pipeline stage in `memory/pipeline/observation/` (sibling to `ObservationCompressor`/`ObservationReflector`). It takes `ObservedEvent[]` + `Witness[]`, gates on importance/tier/entity-overlap, batches events per witness into LLM calls using a personality-aware prompt, and returns `SubjectiveTrace[]`. The `Reconsolidation` mechanism halves its drift rate for perspective-encoded traces to avoid compounding distortion.

**Tech Stack:** TypeScript, vitest, `@framers/agentos` memory subsystem, `@framers/sql-storage-adapter`

**Spec:** [`packages/agentos/docs/superpowers/specs/2026-04-10-perspective-observer-design.md`](../specs/2026-04-10-perspective-observer-design.md)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/memory/pipeline/observation/PerspectiveObserver.ts` | Core class: gating, batching, LLM rewrite, fallback |
| Create | `src/memory/pipeline/observation/perspective-prompt.ts` | System/user prompt builders |
| Create | `src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts` | Unit tests |
| Create | `src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts` | Prompt builder tests |
| Modify | `src/memory/archive/IMemoryArchive.ts:27` | Add `'perspective_source'` to `ArchiveReason` |
| Modify | `src/memory/mechanisms/types.ts:155-179` | Add `perspectiveEncoded`, `perspectiveSourceEventId`, `perspectiveSourceHash` to `MechanismMetadata` |
| Modify | `src/memory/mechanisms/retrieval/Reconsolidation.ts:64-65` | Halve driftRate when `perspectiveEncoded` |
| Modify | `src/memory/mechanisms/__tests__/retrieval.test.ts` | Test reconsolidation clamping |

All paths relative to `packages/agentos/`.

---

### Task 1: Extend ArchiveReason and MechanismMetadata Types

**Files:**
- Modify: `src/memory/archive/IMemoryArchive.ts`
- Modify: `src/memory/mechanisms/types.ts`

- [ ] **Step 1: Add `'perspective_source'` to ArchiveReason**

In `src/memory/archive/IMemoryArchive.ts`, line 27:

```ts
export type ArchiveReason = 'temporal_gist' | 'lifecycle_archive' | 'manual_compaction' | 'perspective_source';
```

- [ ] **Step 2: Add perspective fields to MechanismMetadata**

In `src/memory/mechanisms/types.ts`, inside the `MechanismMetadata` interface (after the `reappraisalHistory` field, around line 178):

```ts
  /** PerspectiveObserver: trace was encoded through a persona lens. */
  perspectiveEncoded?: boolean;
  /** PerspectiveObserver: ID of the source objective event. */
  perspectiveSourceEventId?: string;
  /** PerspectiveObserver: SHA-256 of the source objective event content. */
  perspectiveSourceHash?: string;
```

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
cd packages/agentos && npx vitest run src/memory/mechanisms/__tests__/types.test.ts src/memory/archive/__tests__/SqlStorageMemoryArchive.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/memory/archive/IMemoryArchive.ts src/memory/mechanisms/types.ts
git commit -m "feat(memory): add perspective_source archive reason and perspectiveEncoded metadata"
```

---

### Task 2: Reconsolidation Rate Halving

**Files:**
- Modify: `src/memory/mechanisms/retrieval/Reconsolidation.ts`
- Modify: `src/memory/mechanisms/__tests__/retrieval.test.ts`

- [ ] **Step 1: Write failing tests for perspective clamping**

Add to `src/memory/mechanisms/__tests__/retrieval.test.ts`:

```ts
import { applyReconsolidation } from '../retrieval/Reconsolidation.js';
import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedReconsolidationConfig, MechanismMetadata } from '../types.js';

function makeTraceForRecon(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    id: 'recon_test',
    type: 'episodic',
    scope: 'user',
    scopeId: 'test',
    content: 'Test memory',
    entities: [],
    tags: [],
    provenance: { sourceType: 'observation', sourceTimestamp: Date.now(), confidence: 1, verificationCount: 0 },
    emotionalContext: { valence: 0.5, arousal: 0.5, dominance: 0.5, intensity: 0.25, gmiMood: 'neutral' },
    encodingStrength: 0.5,
    stability: 86_400_000,
    retrievalCount: 0,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    reinforcementInterval: 86_400_000,
    associatedTraceIds: [],
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    isActive: true,
    structuredData: {},
    ...overrides,
  };
}

const defaultReconConfig: ResolvedReconsolidationConfig = {
  enabled: true,
  driftRate: 0.1,
  maxDriftPerTrace: 0.4,
  immuneAboveImportance: 9,
};

describe('Reconsolidation perspectiveEncoded clamping', () => {
  it('halves driftRate when perspectiveEncoded is true', () => {
    const trace = makeTraceForRecon({
      structuredData: { mechanismMetadata: { perspectiveEncoded: true } },
    });
    const originalValence = trace.emotionalContext.valence;
    const mood = { valence: 1.0, arousal: 0.5, dominance: 0.5 };

    applyReconsolidation(trace, mood, defaultReconConfig);

    // With halved rate (0.05 instead of 0.1), drift should be half as much
    const drift = trace.emotionalContext.valence - originalValence;
    expect(drift).toBeCloseTo(0.05 * (1.0 - 0.5), 5);
  });

  it('uses full driftRate when perspectiveEncoded is absent', () => {
    const trace = makeTraceForRecon();
    const originalValence = trace.emotionalContext.valence;
    const mood = { valence: 1.0, arousal: 0.5, dominance: 0.5 };

    applyReconsolidation(trace, mood, defaultReconConfig);

    const drift = trace.emotionalContext.valence - originalValence;
    expect(drift).toBeCloseTo(0.1 * (1.0 - 0.5), 5);
  });

  it('maxDriftPerTrace cap still applies with halved rate', () => {
    const trace = makeTraceForRecon({
      structuredData: {
        mechanismMetadata: { perspectiveEncoded: true, cumulativeDrift: 0.39 },
      },
    });
    const mood = { valence: 1.0, arousal: 1.0, dominance: 1.0 };

    applyReconsolidation(trace, mood, defaultReconConfig);

    const meta = trace.structuredData!.mechanismMetadata as MechanismMetadata;
    expect(meta.cumulativeDrift).toBeLessThanOrEqual(0.4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agentos && npx vitest run src/memory/mechanisms/__tests__/retrieval.test.ts -t "perspectiveEncoded"
```

Expected: FAIL — `applyReconsolidation` doesn't read `perspectiveEncoded` yet.

- [ ] **Step 3: Implement the rate halving**

In `src/memory/mechanisms/retrieval/Reconsolidation.ts`, replace line 65:

```ts
  const rate = config.driftRate;
```

with:

```ts
  // Halve drift rate for perspective-encoded traces — they already shifted
  // from objective truth at encoding time; full reconsolidation on retrieval
  // would compound the distortion.
  const perspectiveEncoded = (meta as any).perspectiveEncoded === true;
  const rate = perspectiveEncoded ? config.driftRate * 0.5 : config.driftRate;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/mechanisms/__tests__/retrieval.test.ts
```

Expected: all pass, including the new `perspectiveEncoded` tests.

- [ ] **Step 5: Commit**

```bash
git add src/memory/mechanisms/retrieval/Reconsolidation.ts src/memory/mechanisms/__tests__/retrieval.test.ts
git commit -m "feat(memory): halve reconsolidation driftRate for perspective-encoded traces"
```

---

### Task 3: Perspective Prompt Builders

**Files:**
- Create: `src/memory/pipeline/observation/perspective-prompt.ts`
- Create: `src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts`

- [ ] **Step 1: Write failing tests for prompt builders**

```ts
// src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts

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
    expect(prompt).toContain('0.3');
    expect(prompt).toContain('0.6');
    expect(prompt).toContain('0.2');
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement prompt builders**

```ts
// src/memory/pipeline/observation/perspective-prompt.ts

/**
 * @fileoverview Prompt builders for PerspectiveObserver LLM calls.
 *
 * Pure functions that produce the system and user prompts for per-witness
 * first-person memory rewriting. Separated from PerspectiveObserver for
 * testability.
 *
 * @module agentos/memory/observation/perspective-prompt
 * @see {@link PerspectiveObserver} for the consuming class.
 */

import type { Witness, ObservedEvent } from './PerspectiveObserver.js';

/**
 * Build the system prompt for a single witness.
 *
 * Encodes the witness's HEXACO personality, current mood, and relationships
 * into instructions for first-person memory rewriting. Each HEXACO dimension
 * includes behavioral guidance for how it colors perception.
 *
 * @param witness - The witness whose perspective shapes the prompt.
 * @returns System prompt string for the LLM call.
 */
export function buildPerspectiveSystemPrompt(witness: Witness): string {
  const h = witness.hexaco;
  const m = witness.mood;

  const relBlock = witness.relationships.length > 0
    ? witness.relationships
        .map((r) => `- ${r.entityName}: ${r.disposition} (trust: ${r.trustLevel})`)
        .join('\n')
    : '- No known relationships to entities in these events.';

  return `You are encoding memories for ${witness.agentName}. Rewrite each event as this character's first-person memory. What stands out to THEM? What do they notice, feel, emphasize?

Personality (HEXACO, 0-1 scale):
- Honesty: ${h.honesty ?? 0.5} — low: spin things favorably; high: record things as they are
- Emotionality: ${h.emotionality ?? 0.5} — low: focus on facts; high: focus on feelings and atmosphere
- Extraversion: ${h.extraversion ?? 0.5} — low: internal monologue; high: focus on social dynamics
- Agreeableness: ${h.agreeableness ?? 0.5} — low: note conflicts, competition; high: note cooperation
- Conscientiousness: ${h.conscientiousness ?? 0.5} — low: skip details; high: note commitments, consequences
- Openness: ${h.openness ?? 0.5} — low: stick to what happened; high: wonder about implications

Current mood: valence=${m.valence}, arousal=${m.arousal}, dominance=${m.dominance}

Relationships:
${relBlock}

Rules:
1. Write 1-2 sentences per event, first person.
2. Personality MUST color the encoding — a suspicious character notices threats, an emotional character remembers how things felt, a conscientious character tracks who promised what.
3. Hostile relationships mean interpreting actions with suspicion.
4. Friendly relationships mean charitable interpretation.
5. Do NOT fabricate events that didn't happen. Rewrite perspective, not facts.

Output a JSON array of strings, one per event. No explanation.`;
}

/**
 * Build the user prompt containing the events to rewrite.
 *
 * @param events - Objective events to rewrite from the witness's perspective.
 * @returns User prompt string listing events as a numbered list.
 */
export function buildPerspectiveUserPrompt(events: ObservedEvent[]): string {
  const list = events
    .map((e, i) => `${i + 1}. ${e.content}`)
    .join('\n');
  return `Events to encode:\n${list}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/memory/pipeline/observation/perspective-prompt.ts src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts
git commit -m "feat(memory): add perspective prompt builders for PerspectiveObserver"
```

---

### Task 4: PerspectiveObserver Core Class

**Files:**
- Create: `src/memory/pipeline/observation/PerspectiveObserver.ts`
- Create: `src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts

/**
 * @fileoverview Tests for PerspectiveObserver.
 * @module agentos/memory/observation/__tests__/PerspectiveObserver.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PerspectiveObserver,
  type ObservedEvent,
  type Witness,
  type PerspectiveObserverConfig,
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
  const fn = vi.fn(async (_system: string, _user: string): Promise<string> => {
    const response = responses[callIndex] ?? '["Fallback memory."]';
    callIndex++;
    return response;
  });
  return fn;
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
    it('falls back to objective encoding on invalid JSON response', async () => {
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
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts
```

Expected: FAIL — `PerspectiveObserver` module doesn't exist.

- [ ] **Step 3: Implement PerspectiveObserver**

```ts
// src/memory/pipeline/observation/PerspectiveObserver.ts

/**
 * @fileoverview PerspectiveObserver — multi-agent subjective memory encoding.
 *
 * Takes objective events and an array of witnesses, applies gating predicates,
 * then produces per-witness first-person memory traces via LLM rewriting.
 * Each witness's HEXACO traits, current mood, and relationships to entities
 * in the event shape what they notice, feel, and remember.
 *
 * Standalone pipeline stage — sibling to ObservationCompressor and
 * ObservationReflector, not an extension of either.
 *
 * @module agentos/memory/observation/PerspectiveObserver
 * @see {@link ObservationCompressor} for note compression (different job).
 * @see {@link ObservationReflector} for pattern extraction (different job).
 */

import type { PADState, HexacoTraits } from '../../core/config.js';
import type { EmotionalContext } from '../../core/types.js';
import { sha256 } from '../../core/util/crossPlatformCrypto.js';
import {
  buildPerspectiveSystemPrompt,
  buildPerspectiveUserPrompt,
} from './perspective-prompt.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An objective event witnessed by one or more agents.
 */
export interface ObservedEvent {
  /** Unique event ID for linking subjective traces back to the source. */
  eventId: string;
  /** Objective event text. */
  content: string;
  /** The player's action text. */
  playerAction: string;
  /** The narrator/system response text. */
  narratorProse: string;
  /** 0-1 importance score. */
  importance: number;
  /** PAD snapshot at the moment of the event. */
  emotionalContext: EmotionalContext;
  /** Entity names involved in the event. */
  entities: string[];
  /** When the event occurred (Unix ms). */
  timestamp: number;
}

/**
 * A relationship between a witness and an entity in the event.
 */
export interface WitnessRelationship {
  entityName: string;
  disposition: 'neutral' | 'friendly' | 'wary' | 'hostile' | 'grateful' | 'fearful';
  trustLevel: number;
}

/**
 * An agent witnessing the event.
 */
export interface Witness {
  agentId: string;
  agentName: string;
  hexaco: HexacoTraits;
  mood: PADState;
  relationships: WitnessRelationship[];
  tier: 'important' | 'combatant' | 'background';
}

/**
 * A first-person memory trace produced by perspective rewriting.
 */
export interface SubjectiveTrace {
  witnessId: string;
  content: string;
  sourceEventId: string;
  originalEventHash: string;
  perspectiveMetadata: {
    hexacoSnapshot: HexacoTraits;
    moodSnapshot: PADState;
    relationshipSnapshot: WitnessRelationship[];
  };
}

/**
 * Result of a rewrite batch.
 */
export interface PerspectiveRewriteResult {
  traces: SubjectiveTrace[];
  fallbacks: Array<{ witnessId: string; reason: string }>;
  llmCallCount: number;
}

/**
 * Configuration for PerspectiveObserver.
 */
export interface PerspectiveObserverConfig {
  /** LLM invoker with (system, user) → response contract. */
  llmInvoker: (system: string, user: string) => Promise<string>;
  /** Minimum importance for perspective encoding. @default 0.3 */
  importanceThreshold?: number;
  /** Max events per LLM call. @default 10 */
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Multi-agent subjective memory encoder.
 *
 * @example
 * ```ts
 * const observer = new PerspectiveObserver({
 *   llmInvoker: (sys, usr) => callHaiku(sys, usr),
 * });
 * const result = await observer.rewrite(events, witnesses);
 * for (const trace of result.traces) {
 *   await npcBrains.get(trace.witnessId)?.remember(trace.content, {
 *     type: 'episodic',
 *     tags: ['perspective-encoded'],
 *   });
 * }
 * ```
 */
export class PerspectiveObserver {
  private readonly llmInvoker: PerspectiveObserverConfig['llmInvoker'];
  private readonly importanceThreshold: number;
  private readonly batchSize: number;

  constructor(config: PerspectiveObserverConfig) {
    this.llmInvoker = config.llmInvoker;
    this.importanceThreshold = config.importanceThreshold ?? 0.3;
    this.batchSize = config.batchSize ?? 10;
  }

  /**
   * Rewrite objective events from each witness's perspective.
   *
   * Applies gating predicates, batches events per witness, invokes the LLM,
   * and returns per-witness subjective traces. Failures fall back to objective
   * encoding with a reason string.
   *
   * @param events - Objective events to rewrite.
   * @param witnesses - Agents who witnessed the events.
   * @returns Subjective traces + fallback records + LLM call count.
   */
  async rewrite(
    events: ObservedEvent[],
    witnesses: Witness[],
  ): Promise<PerspectiveRewriteResult> {
    const traces: SubjectiveTrace[] = [];
    const fallbacks: PerspectiveRewriteResult['fallbacks'] = [];
    let llmCallCount = 0;

    // Pre-compute event hashes
    const eventHashes = new Map<string, string>();
    for (const event of events) {
      eventHashes.set(event.eventId, await sha256(event.content));
    }

    for (const witness of witnesses) {
      // Gate: tier
      if (witness.tier !== 'important') {
        fallbacks.push({ witnessId: witness.agentId, reason: `Skipped: tier is '${witness.tier}', not 'important'` });
        continue;
      }

      // Gate: filter events by importance and entity overlap
      const qualifying = events.filter((e) => {
        if (e.importance < this.importanceThreshold) return false;
        const witnessEntityNames = new Set(witness.relationships.map((r) => r.entityName.toLowerCase()));
        const eventEntityNames = e.entities.map((n) => n.toLowerCase());
        const hasOverlap = eventEntityNames.some((n) => witnessEntityNames.has(n));
        const witnessNameInEvent = eventEntityNames.includes(witness.agentName.toLowerCase());
        return hasOverlap || witnessNameInEvent;
      });

      if (qualifying.length === 0) {
        const importanceFiltered = events.filter((e) => e.importance < this.importanceThreshold);
        if (importanceFiltered.length === events.length) {
          fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: all events below importance threshold' });
        } else {
          fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: no entity overlap with witness relationships' });
        }
        continue;
      }

      // Batch events and invoke LLM per batch
      const systemPrompt = buildPerspectiveSystemPrompt(witness);
      const batches = this.chunk(qualifying, this.batchSize);

      for (const batch of batches) {
        const userPrompt = buildPerspectiveUserPrompt(batch);

        try {
          const response = await this.llmInvoker(systemPrompt, userPrompt);
          llmCallCount++;

          const parsed = this.parseResponse(response, batch.length);
          if (!parsed) {
            const reason = response.trim().startsWith('[')
              ? `Fallback: LLM returned wrong count (expected ${batch.length})`
              : 'Fallback: LLM response failed to parse as JSON array';
            fallbacks.push({ witnessId: witness.agentId, reason });
            continue;
          }

          for (let i = 0; i < parsed.length; i++) {
            const event = batch[i];
            traces.push({
              witnessId: witness.agentId,
              content: parsed[i],
              sourceEventId: event.eventId,
              originalEventHash: eventHashes.get(event.eventId) ?? '',
              perspectiveMetadata: {
                hexacoSnapshot: { ...witness.hexaco },
                moodSnapshot: { ...witness.mood },
                relationshipSnapshot: witness.relationships.map((r) => ({ ...r })),
              },
            });
          }
        } catch (err) {
          llmCallCount++;
          fallbacks.push({
            witnessId: witness.agentId,
            reason: `Fallback: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    return { traces, fallbacks, llmCallCount };
  }

  /**
   * Parse LLM response as a JSON array of strings.
   * Returns null if parsing fails or count doesn't match expected.
   */
  private parseResponse(response: string, expectedCount: number): string[] | null {
    try {
      // Strip markdown fences if present
      const cleaned = response.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return null;
      if (parsed.length !== expectedCount) return null;
      if (!parsed.every((item) => typeof item === 'string')) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Split an array into chunks of `size`. */
  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run all observation tests to verify no regressions**

```bash
cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/
```

Expected: all existing observation tests pass alongside the new ones.

- [ ] **Step 6: Commit**

```bash
git add src/memory/pipeline/observation/PerspectiveObserver.ts src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts
git commit -m "feat(memory): add PerspectiveObserver for multi-agent subjective encoding"
```

---

### Task 5: Documentation Updates

**Files:**
- Modify: `docs/memory/MEMORY_ARCHITECTURE.md`
- Modify: `docs/memory/COGNITIVE_MECHANISMS.md`
- Modify: `docs/memory/COGNITIVE_MEMORY_GUIDE.md`

- [ ] **Step 1: Update MEMORY_ARCHITECTURE.md**

Add `PerspectiveObserver` to the module table (near the `memory/archive/` row added in Spec A):

```markdown
| `memory/observation/PerspectiveObserver.ts` | Multi-agent subjective encoding (per-witness LLM rewrite) |
| `memory/observation/perspective-prompt.ts` | Perspective rewrite prompt builders |
```

- [ ] **Step 2: Update COGNITIVE_MECHANISMS.md**

Add a row to the mechanisms section (after the Rehydration row):

```markdown
## Perspective Encoding

Events witnessed by multiple agents are rewritten through each witness's HEXACO personality, current mood, and relationships before encoding. A suspicious character notices threats; an emotional character remembers feelings; a conscientious character tracks commitments. The objective event is archived (Spec A); each witness gets their own first-person trace.

Perspective-encoded traces have their reconsolidation `driftRate` halved — they already shifted from objective truth at encoding time, so full retrieval-time drift would compound distortion. The `maxDriftPerTrace` cap (0.4) still bounds total drift.
```

- [ ] **Step 3: Update COGNITIVE_MEMORY_GUIDE.md**

Add a "Multi-agent memory" section after the "Long-running agents" section:

```markdown
## Multi-Agent Memory: PerspectiveObserver

When multiple agents witness the same event, each gets a first-person rewrite through their personality and relationships.

\`\`\`ts
import { PerspectiveObserver } from '@framers/agentos/memory/pipeline/observation/PerspectiveObserver';

const observer = new PerspectiveObserver({
  llmInvoker: (sys, usr) => callHaiku(sys, usr),
  importanceThreshold: 0.3,
});

const result = await observer.rewrite(
  [{ eventId: 'evt_1', content: 'The dragon attacked the village.', ... }],
  [
    { agentId: 'lyra', agentName: 'Lyra', hexaco: { emotionality: 0.9, ... }, ... },
    { agentId: 'holt', agentName: 'Holt', hexaco: { emotionality: 0.2, ... }, ... },
  ],
);
// Lyra: "I watched in horror as flames consumed our home..."
// Holt: "The beast attacked. Predictable. I assessed our defensive options."
\`\`\`

Each `SubjectiveTrace` carries a `perspectiveMetadata` snapshot and an `originalEventHash` linking back to the archived objective event. The reconsolidation mechanism halves its drift rate for perspective-encoded traces.
```

- [ ] **Step 4: Commit**

```bash
git add docs/memory/
git commit -m "docs(memory): document PerspectiveObserver, perspective encoding, and reconsolidation clamping"
```

---

## Post-Implementation Checklist

- [ ] Run the full targeted test suite:
  ```bash
  cd packages/agentos && npx vitest run src/memory/pipeline/observation/__tests__/ src/memory/mechanisms/__tests__/ src/memory/archive/__tests__/
  ```
- [ ] Verify `typedoc` picks up new modules:
  ```bash
  cd packages/agentos && npx typedoc --options typedoc.json 2>&1 | grep -i perspective
  ```
- [ ] Review all new public symbols have `@param`, `@returns`, `@see` TSDoc tags.
