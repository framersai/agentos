---
title: PerspectiveObserver — Multi-Agent Subjective Memory Encoding
date: 2026-04-10
status: draft
scope: agentos
depends_on:
  - 2026-04-10-memory-archive-rehydration-design
enables:
  - 2026-04-XX-wilds-end-of-session-memory-pipeline-design
---

# PerspectiveObserver — Multi-Agent Subjective Memory Encoding

## Problem Statement

AgentOS observation is single-agent. `MemoryObserver` extracts `ObservationNote[]` from conversation text, `ObservationCompressor` compresses them, and `ObservationReflector` derives patterns. All three operate on one agent's view of one conversation. There is no mechanism to encode the same event differently for multiple witnesses.

In multi-agent scenes (game NPCs, collaborative agents, simulated environments), every agent currently records the same objective text. HEXACO traits modulate *encoding strength* (how well the trace is remembered) and *retrieval behavior* (reconsolidation drift, FOK sensitivity), but the *content* of the memory is identical across agents. A cowardly NPC and a battle-hardened warrior remember the same fight with the same words. That's not subjectivity — it's identical records with different decay curves.

The fix: a `PerspectiveObserver` that takes an objective event and an array of witnesses, and produces per-witness first-person memory traces via LLM rewriting. Each witness's HEXACO traits, current mood, and relationships to entities in the event shape what they notice, how they feel about it, and what they remember.

Verified gap: zero matches for `witness|perspective|multi-agent|subjective|perAgent|forAgent` across `packages/agentos/src/memory` (searched 2026-04-10).

---

## Non-Goals

- **Not** replacing `MemoryObserver`, `ObservationCompressor`, or `ObservationReflector`. Those are single-agent conversation-analysis tools. `PerspectiveObserver` is a sibling with a different input shape and job.
- **Not** modifying the core `MemoryTrace` interface. Perspective metadata goes in `structuredData.mechanismMetadata` like all other mechanism outputs.
- **Not** supporting perspective encoding for `combatant` or `background` tier witnesses. Only `important`-tier witnesses get LLM rewrites; others fall back to objective encoding.
- **Not** changing how events are detected or classified. The caller provides `ObservedEvent` objects — PerspectiveObserver does not extract events from text.
- **Not** archiving objective events. That is `IMemoryArchive`'s job (Spec A, shipped). PerspectiveObserver consumes the archive reference to link subjective traces back to the archived original.

---

## Architecture

### Position in the Pipeline

```
Turn Pipeline (wilds-ai)
    │
    ├── Stage 7: Memory Persistence (existing)
    │     ├── persistMessage()
    │     ├── updateNarratorState()
    │     ├── updateGameState()
    │     │
    │     └── NPC Memory Observation (currently objective)
    │           │
    │           ├── [OLD] NpcMemoryBridge.observeForNpc(npcId, playerAction, narratorProse)
    │           │         → facade.observe('user', playerAction)
    │           │         → facade.observe('assistant', npcResponse)
    │           │         Result: OBJECTIVE text in NPC brain
    │           │
    │           └── [NEW] PerspectiveObserver.rewrite(event, witnesses)
    │                     → archive.store(objectiveEvent)              ← Spec A
    │                     → LLM rewrite per witness (batched)
    │                     → SubjectiveTrace per witness → witness brain
    │                     Result: FIRST-PERSON text in each NPC brain
```

`PerspectiveObserver` is a standalone pipeline stage in `packages/agentos/src/memory/pipeline/observation/`. It is a sibling to `ObservationCompressor` and `ObservationReflector`, not an extension of either. Different input shape (`ObservedEvent` + `Witness[]`), different output shape (`SubjectiveTrace[]`), different job (perspective rewriting vs note extraction vs pattern reflection).

### Types

```ts
// packages/agentos/src/memory/pipeline/observation/PerspectiveObserver.ts

import type { PADState, HexacoTraits } from '../../core/config.js';
import type { EmotionalContext } from '../../core/types.js';
import type { IMemoryArchive } from '../../archive/IMemoryArchive.js';

/**
 * An objective event witnessed by one or more agents.
 * Provided by the caller (e.g. wilds-ai turn pipeline).
 */
export interface ObservedEvent {
  /** Unique event ID for linking subjective traces back to the source. */
  eventId: string;
  /** Objective event text (e.g. narrator prose + player action combined). */
  content: string;
  /** The player's action text. */
  playerAction: string;
  /** The narrator/system response text. */
  narratorProse: string;
  /** 0-1 importance score (from Director or NLP classification). */
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
 * Used to bias the perspective rewrite (e.g. hostile toward the player
 * means interpreting their actions with suspicion).
 */
export interface WitnessRelationship {
  /** Entity name (must match an entity in the ObservedEvent). */
  entityName: string;
  /** Current disposition toward this entity. */
  disposition: 'neutral' | 'friendly' | 'wary' | 'hostile' | 'grateful' | 'fearful';
  /** Trust level, -1 (deep distrust) to 1 (full trust). */
  trustLevel: number;
}

/**
 * An agent witnessing the event. Each witness gets their own
 * subjective trace via LLM perspective rewriting.
 */
export interface Witness {
  /** Agent/NPC ID — used to route the subjective trace to the correct brain. */
  agentId: string;
  /** Display name for the LLM prompt (e.g. "Lyra", "Guard Captain Holt"). */
  agentName: string;
  /** HEXACO personality traits for perspective bias. */
  hexaco: HexacoTraits;
  /** Current mood at observation time. */
  mood: PADState;
  /** Relationships to entities in the event. */
  relationships: WitnessRelationship[];
  /** Memory tier — only 'important' witnesses get LLM rewrites. */
  tier: 'important' | 'combatant' | 'background';
}

/**
 * A first-person memory trace produced by perspective rewriting.
 * Routed to the witness's brain by the caller.
 */
export interface SubjectiveTrace {
  /** ID of the witness who produced this trace. */
  witnessId: string;
  /** First-person rewritten memory content. */
  content: string;
  /** Event ID linking back to the archived objective event. */
  sourceEventId: string;
  /** SHA-256 of the objective event content for integrity linking. */
  originalEventHash: string;
  /** Snapshot of the witness's state at encoding time. */
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
  /** Subjective traces successfully produced. */
  traces: SubjectiveTrace[];
  /** Witnesses that fell back to objective encoding due to LLM failure. */
  fallbacks: Array<{ witnessId: string; reason: string }>;
  /** Total LLM calls made. */
  llmCallCount: number;
}
```

### Gating Predicates

Events and witnesses are filtered before LLM calls. An event/witness pair is **skipped** (falls back to objective encoding) when any of these is true:

| Predicate | Rationale |
|---|---|
| `event.importance < 0.3` | Trivial events (walking, looking around) don't need subjective encoding — objective text is fine. |
| `witness.tier !== 'important'` | Combatant and background NPCs get raw objective encoding. The LLM cost is reserved for narratively significant characters. |
| `event.entities` has no overlap with `witness.relationships[].entityName` AND the witness is not named in the event | If the NPC has no relationship to anyone in the event and isn't mentioned, they're a passive bystander — objective encoding is sufficient. |

Skipped witnesses get the objective event text as-is, with `perspectiveEncoded: false` in their trace metadata. This is not a failure — it's a cost optimization.

### LLM Rewrite

**Model:** Haiku-class (cheap tier). The rewrite is a stylistic transform, not deep reasoning.

**Batching:** Up to 10 events per LLM call per witness. If a session turn produces 1 event, each witness gets 1 call. If an end-of-session consolidation produces 50 events, each witness gets 5 calls.

**Invoker contract:** `(system: string, user: string) => Promise<string>` — identical to `ObservationCompressor` and `ObservationReflector`.

**System prompt:**

```
You are encoding memories for {agentName}. Rewrite each event as this character's
first-person memory. What stands out to THEM? What do they notice, feel, emphasize?

Personality (HEXACO, 0-1 scale):
- Honesty: {h} — low: spin things favorably; high: record things as they are
- Emotionality: {e} — low: focus on facts; high: focus on feelings and atmosphere
- Extraversion: {x} — low: internal monologue; high: focus on social dynamics
- Agreeableness: {a} — low: note conflicts, competition; high: note cooperation
- Conscientiousness: {c} — low: skip details; high: note commitments, consequences
- Openness: {o} — low: stick to what happened; high: wonder about implications

Current mood: valence={v}, arousal={a}, dominance={d}

Relationships:
{foreach relationship}
- {entityName}: {disposition} (trust: {trustLevel})
{end}

Rules:
1. Write 1-2 sentences per event, first person.
2. Personality MUST color the encoding — a suspicious character notices threats,
   an emotional character remembers how things felt, a conscientious character
   tracks who promised what.
3. Hostile relationships mean interpreting actions with suspicion.
4. Friendly relationships mean charitable interpretation.
5. Do NOT fabricate events that didn't happen. Rewrite perspective, not facts.

Output a JSON array of strings, one per event. No explanation.
```

**User prompt:**

```
Events to encode:
1. {event1.content}
2. {event2.content}
...
```

**Response parsing:** JSON array of strings. Each string is one first-person trace. If parsing fails or array length doesn't match event count, fall back to objective encoding for all events in the batch with `perspective_failed: true`.

### Cost Envelope

| Parameter | Value |
|---|---|
| Model | Haiku 4.5 (~$0.25/MTok input, ~$1.25/MTok output) |
| Tokens per rewrite | ~300 input, ~100 output |
| Cost per rewrite | ~$0.0002 |
| Rewrites per session (5 important NPCs, 50 turns, 0.5 gating rate) | 125 |
| **Cost per session** | **$0.025** |
| Batch size (events per LLM call) | 10 |
| LLM calls per session | 25 (5 NPCs × 5 batches) |
| At 1000 sessions/day | $25/day |

### Reconsolidation Interaction

When a trace has `perspectiveEncoded: true` in its `MechanismMetadata`, `applyReconsolidation()` halves the effective `driftRate`. The rationale: perspective encoding already shifted the memory from objective truth at encoding time. Applying full reconsolidation drift on every retrieval would compound the distortion.

The `maxDriftPerTrace` cap (default 0.4) still applies — this is a rate reduction, not an exemption. Perspective-encoded traces drift more slowly but to the same maximum.

Implementation: one check in `applyReconsolidation()`:

```ts
const effectiveRate = meta.perspectiveEncoded ? config.driftRate * 0.5 : config.driftRate;
```

### Failure Modes

| Failure | Behavior |
|---|---|
| LLM call fails for a witness batch | All events in that batch fall back to objective encoding for that witness. `perspective_failed: true` metadata flag. Logged at `warn`. |
| LLM response is not valid JSON | Same as above — batch fallback. |
| LLM returns wrong number of traces vs events | Same — batch fallback. |
| Archive store fails for the objective event | PerspectiveObserver proceeds without archiving. The objective event is not lost (it's in the narrator transcript) but the archive link is broken. Logged at `warn`. |
| All witnesses gated out for an event | No LLM calls made. Event still archived. No error. |

### MechanismMetadata Extensions

Add to `MechanismMetadata` in `mechanisms/types.ts`:

```ts
/** PerspectiveObserver: trace was encoded through a persona lens. */
perspectiveEncoded?: boolean;
/** PerspectiveObserver: ID of the source objective event. */
perspectiveSourceEventId?: string;
/** PerspectiveObserver: SHA-256 of the source objective event content. */
perspectiveSourceHash?: string;
```

---

## Module Structure

| File | Responsibility |
|---|---|
| `src/memory/pipeline/observation/PerspectiveObserver.ts` | Core class: gating, batching, LLM rewriting, fallback |
| `src/memory/pipeline/observation/perspective-prompt.ts` | System/user prompt builders (separated for testability) |
| `src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts` | Unit tests with mock LLM |
| `src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts` | Prompt builder tests |
| `src/memory/mechanisms/types.ts` | Add `perspectiveEncoded`, `perspectiveSourceEventId`, `perspectiveSourceHash` |
| `src/memory/mechanisms/retrieval/Reconsolidation.ts` | Add `perspectiveEncoded` rate halving |

---

## Documentation Plan

### TSDoc

Every new public symbol gets full TSDoc (imperative, `@param`, `@returns`, `@see`, `@example`). The `typedoc` → `agentos-live-docs` pipeline picks it up automatically.

### Docs files to update

| File | Update |
|---|---|
| `docs/memory/MEMORY_ARCHITECTURE.md` | Add PerspectiveObserver to the pipeline diagram and module table. |
| `docs/memory/COGNITIVE_MECHANISMS.md` | Add "Perspective Encoding" row: first-person rewriting at encoding time, reconsolidation rate halving. |
| `docs/memory/COGNITIVE_MEMORY_GUIDE.md` | Add "Multi-agent memory" section with worked example showing 2 NPCs witnessing the same event. |

### Blog

New post: "Perspective Observer: NPCs That Remember Differently" — short, focused on the cognitive science (subjective encoding, reconstructive memory) and the practical outcome (distinct NPC minds).

---

## Testing Plan

### Unit tests

`src/memory/pipeline/observation/__tests__/PerspectiveObserver.test.ts`:

- **Gating:** event below importance threshold → no LLM call, objective fallback
- **Gating:** combatant witness → no LLM call, objective fallback
- **Gating:** no entity overlap → no LLM call, objective fallback
- **Rewrite:** 2 witnesses with different HEXACO → 2 different SubjectiveTraces
- **Batching:** 15 events → 2 batches (10 + 5) per witness
- **Fallback:** LLM returns invalid JSON → all events in batch fall back to objective
- **Fallback:** LLM returns wrong count → batch fallback
- **Archive link:** SubjectiveTrace.originalEventHash matches archived event hash
- **Metadata:** perspectiveEncoded = true, sourceEventId set
- **Cost tracking:** llmCallCount in result matches expected batch count

`src/memory/pipeline/observation/__tests__/perspective-prompt.test.ts`:

- System prompt includes HEXACO values
- System prompt includes mood values
- System prompt includes relationships with correct disposition/trust
- User prompt formats events as numbered list

`src/memory/mechanisms/__tests__/retrieval.test.ts` (extend existing):

- Reconsolidation driftRate halved when `perspectiveEncoded: true`
- Reconsolidation driftRate unchanged when `perspectiveEncoded` absent
- maxDriftPerTrace cap still applies with halved rate

### Integration test

`tests/integration/memory/perspective-rewrite-roundtrip.test.ts`:

- Create 2 WildsMemoryFacade instances (2 NPCs) with different HEXACO
- Create a PerspectiveObserver with a mock LLM that returns distinct rewrites
- Feed one event with both NPCs as witnesses
- Verify each NPC's brain contains different first-person content
- Verify the objective event is in the archive (Spec A)

---

## Rollout

1. **Add `perspectiveEncoded` / `perspectiveSourceEventId` / `perspectiveSourceHash` to `MechanismMetadata`** — pure type addition, no runtime change.
2. **Add reconsolidation rate halving** — 1-line change in `Reconsolidation.ts`, test in existing suite.
3. **Create `perspective-prompt.ts`** — prompt builders, pure functions, fully testable in isolation.
4. **Create `PerspectiveObserver.ts`** — core class with gating, batching, LLM calls, fallback.
5. **Create unit + integration tests.**
6. **Update docs.**
7. **Wilds-ai adoption:** modify `NpcMemoryBridge.observeForNpc()` to route through `PerspectiveObserver` for important-tier NPCs.

Each step is independently mergeable.

---

## Resolved Design Decisions

### 1. Standalone vs extending MemoryObserver → **Standalone**

`MemoryObserver` extracts notes from *conversation text* (single-agent, text→notes). `PerspectiveObserver` rewrites *objective events* per-witness (multi-agent, event→first-person traces). Different input shape, different output shape, different job. Coupling them would add complexity without benefit.

### 2. LLM vs template for rewrites → **LLM (Approach A)**

Template-based rewrites (Approach B) produce formulaic output — HEXACO only modulates which keywords are emphasized, not genuine perspective shifts. The cost ($0.025/session on Haiku) is negligible. The whole point is genuine subjectivity; templates defeat that.

### 3. Archive the objective event → **Yes, via Spec A**

The caller archives the objective event via `IMemoryArchive.store()` before calling `PerspectiveObserver.rewrite()`. The archive uses `archiveReason: 'perspective_source'`. This requires adding `'perspective_source'` to the `ArchiveReason` union type in `IMemoryArchive.ts` (minor additive change to Spec A's shipped code). SubjectiveTraces carry `originalEventHash` for integrity linking. This is the caller's responsibility, not PerspectiveObserver's — the observer doesn't own the archive.

### 4. Reconsolidation clamping → **Halve driftRate, keep maxDriftPerTrace**

Perspective encoding shifts memory from objective truth at encoding. Reconsolidation shifts it again at retrieval. Two drift sources. Halving the retrieval drift rate means perspective-encoded traces evolve more slowly but aren't immune. The `maxDriftPerTrace` cap (0.4) still bounds total drift regardless.

## Remaining Open Questions

1. **Should PerspectiveObserver accept a `modelOverride` parameter?** Default is Haiku-class, but some consumers might want Sonnet for higher-quality rewrites on critical events. Proposed: yes, optional `model?: string` on the config. Resolve during implementation.

2. **Should the access-log (Spec A) record perspective-rewrite events?** When the archive stores the objective event for perspective encoding, should that count as a "rehydration" for retention purposes? Proposed: no — perspective source archival is a write path, not a read path. Only `rehydrate()` calls write access-log entries.
