---
title: 'Self-Improving Memory'
sidebar_position: 23
description: 'The ConsolidationLoop runs 6 maintenance steps (prune, merge, strengthen, derive, compact, reindex), feedback signals detect used/ignored traces, and observation compression distills conversations into long-term knowledge.'
---

> Memory consolidation is the analogue of slow-wave sleep: background maintenance that prunes weak traces, merges duplicates, strengthens co-activated patterns, derives new insights, compacts old episodic traces, and rebuilds the search index.

---

## Overview

The self-improvement subsystem has three components that work together:

| Component | Purpose | LLM Required |
|-----------|---------|--------------|
| **ConsolidationLoop** | 6-step background maintenance pipeline | Only for the derive step |
| **RetrievalFeedbackSignal** | Detect which retrieved traces were used vs ignored by the LLM | No |
| **ObservationCompressor + ObservationReflector** | Compress conversations into dense memory traces | Yes |

---

## ConsolidationLoop

Source: `memory/consolidation/ConsolidationLoop.ts`

The consolidation pipeline runs 6 ordered steps in a single cycle. A boolean mutex prevents concurrent runs --- if `run()` is called while a cycle is in progress, it returns immediately with zero counts.

### Step 1: Prune

Soft-delete traces whose Ebbinghaus strength has decayed below the `pruneThreshold` (default: 0.05).

```
S(t) = S0 * e^(-dt / stability)

If S(t) < pruneThreshold → trace.deleted = 1
```

Emotional memories (intensity > 0.3) are protected from pruning regardless of strength.

### Step 2: Merge

Deduplicate near-identical traces. Two comparison strategies:

| Method | Activation | Threshold |
|--------|-----------|-----------|
| Embedding cosine similarity | When `embedFn` is provided | Default 0.95 |
| Exact content-hash comparison | Fallback when no embeddings | SHA-256 match |

When a merge occurs:
- The newer trace's content is kept.
- Tags from both traces are unioned.
- The older trace is soft-deleted with a reference to the survivor.

### Step 3: Strengthen

Read retrieval-feedback co-usage signals from the `retrieval_feedback` table and record Hebbian co-activation edges in the memory graph.

Traces that were retrieved together for the same query get `CO_ACTIVATED` edges. The learning rate (default 0.1) controls how quickly edge weights grow. This implements the Hebbian rule: "neurons that fire together wire together."

### Step 4: Derive (LLM-backed)

Detect clusters of related memories using the memory graph's `detectClusters()` method (minimum cluster size: 5). For each cluster, invoke an LLM to synthesise a higher-level insight trace.

- The derived trace has `type: 'semantic'` and contains the cluster's distilled knowledge.
- `SCHEMA_INSTANCE` edges connect the original traces to the derived insight.
- Guarded by `maxDerivedPerCycle` (default: 5) to prevent unbounded graph growth.
- **Skipped entirely** when no `llmInvoker` function is provided.

### Step 5: Compact

Promote old, high-retrieval episodic traces to semantic type. This is a lightweight episodic-to-semantic migration:

| Criterion | Threshold |
|-----------|-----------|
| Age | > 7 days (604,800,000 ms) |
| Retrieval count | >= 3 |

Compacted traces keep their content but change `type` from `episodic` to `semantic`, reflecting that frequently-accessed episodic memories have been consolidated into general knowledge.

### Step 6: Re-index

Rebuild the FTS5 full-text search index over `memory_traces` and log the consolidation run to the `consolidation_log` table with counts and duration.

---

## Running Consolidation

### Programmatic

```ts
import { Memory } from '@framers/agentos';

const mem = await Memory.create({
  path: './brain.sqlite',
  selfImprove: true,
  consolidation: {
    trigger: 'interval',
    every: 3_600_000,       // Run every hour
    pruneThreshold: 0.05,
    mergeThreshold: 0.95,
  },
});

// Manual trigger
const result = await mem.consolidate();
console.log(`Pruned: ${result.pruned}`);
console.log(`Merged: ${result.merged}`);
console.log(`Derived: ${result.derived}`);
console.log(`Compacted: ${result.compacted}`);
console.log(`Duration: ${result.durationMs}ms`);
```

### Programmatic Health Check

```ts
const health = await mem.health();
console.log(`Last consolidation: ${health.lastConsolidation}`);
console.log(`Active traces: ${health.activeTraces}`);
console.log(`Avg strength: ${health.avgStrength.toFixed(2)}`);
```

---

## Trigger Modes

| Mode | `trigger` | `every` | Behaviour |
|------|-----------|---------|-----------|
| **Timer** | `'interval'` | Milliseconds | Runs on a wall-clock interval (default: 1 hour) |
| **Turn-based** | `'turns'` | Turn count | Runs after every N conversation turns |
| **Manual** | `'manual'` | Ignored | Only runs when `consolidate()` is called explicitly |

```ts
// Turn-based: consolidate every 50 conversation turns
const mem = await Memory.create({
  path: './brain.sqlite',
  selfImprove: true,
  consolidation: {
    trigger: 'turns',
    every: 50,
  },
});

// Manual only
const mem2 = await Memory.create({
  path: './brain.sqlite',
  selfImprove: true,
  consolidation: {
    trigger: 'manual',
  },
});
```

---

## ConsolidationResult

```ts
interface ConsolidationResult {
  pruned: number;     // Traces soft-deleted (below strength threshold)
  merged: number;     // Trace pairs merged into single traces
  derived: number;    // New insight traces synthesised from clusters
  compacted: number;  // Episodic traces promoted to semantic
  durationMs: number; // Wall-clock time of the consolidation cycle
}
```

---

## Retrieval Feedback Signal

Source: `memory/feedback/RetrievalFeedbackSignal.ts`

After the LLM generates a response, the feedback signal detects which injected memory traces were actually referenced vs ignored.

### Detection Heuristic

1. Extract unique keywords (> 4 characters) from each trace's content.
2. Check how many of those keywords appear in the LLM's response text.
3. If `matchRatio > 0.30` the trace is marked `'used'`, otherwise `'ignored'`.

An optional `similarityFn` can be injected for higher-fidelity semantic detection.

### Effect on Decay

| Signal | Action |
|--------|--------|
| `'used'` | `updateOnRetrieval()` --- increases strength and stability, doubles reinforcement interval |
| `'ignored'` | `penalizeUnused()` --- accelerates decay for repeatedly-ignored traces |

### Persistence

Each feedback event is written synchronously to the `retrieval_feedback` table in the agent's brain database:

```sql
CREATE TABLE retrieval_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id   TEXT    NOT NULL REFERENCES memory_traces(id),
  signal     TEXT    NOT NULL,    -- 'used' or 'ignored'
  query      TEXT,                -- The query that triggered retrieval
  created_at INTEGER NOT NULL
);
```

### API

Use the public facade when you already have the injected traces and the final assistant reply:

```ts
await mem.feedbackFromResponse(injectedTraces, llmResponse, query);
```

If you want to persist explicit application-level feedback by trace ID instead, use:

```ts
await mem.feedback(traceId, 'used', query);
await mem.feedback(traceId, 'ignored', query);
```

---

## Observational Compression

The observation system compresses long-running conversations into dense, searchable memory traces. Three tiers:

```
Recent Messages (raw conversation turns)
  → Observations (concise notes via ObservationCompressor, 3-10x compression)
    → Reflections (long-term traces via ObservationReflector, 5-40x compression)
```

### ObservationCompressor

Source: `memory/observation/ObservationCompressor.ts`

Groups related observation notes by topic/entity overlap, produces 1-3 sentence summaries per group, assigns priority levels (`critical`, `important`, `informational`), and attaches three-date temporal metadata.

**Personality bias**: When HEXACO traits are provided, the system prompt is tuned to emphasise categories aligned with the agent's personality:

| High Trait | Observer Focus |
|------------|---------------|
| Emotionality | Emotional shifts, tone changes, sentiment transitions |
| Conscientiousness | Commitments, deadlines, action items, structured plans |
| Openness | Creative tangents, novel ideas, exploratory topics |
| Agreeableness | User preferences, rapport cues, communication style |
| Honesty | Corrections, retractions, contradictions |

### ObservationReflector

Source: `memory/observation/ObservationReflector.ts`

Consolidates accumulated observation notes into long-term `MemoryTrace` objects. Conflict resolution is personality-driven:

| Personality | Resolution Strategy |
|-------------|-------------------|
| High Honesty (> 0.6) | Prefer newer information, supersede old traces |
| High Agreeableness (> 0.6) | Keep both versions, note discrepancy |
| Default | Prefer higher confidence (only if difference > 0.2) |

### Temporal Reasoning

The three-date model tracks temporal context for every memory:

| Date | Field | Purpose |
|------|-------|---------|
| **Observed at** | `observedAt` | When the memory was recorded by the system |
| **Referenced at** | `referencedAt` | When the event the memory refers to actually occurred |
| **Relative label** | `relativeLabel` | Human-friendly label: "just now", "earlier today", "last Tuesday", "2 weeks ago" |

The `relativeTimeLabel()` function converts Unix-ms timestamps into natural-language labels. Labels are computed relative to the current time and cover granularities from seconds ("just now") through months ("last month") to years ("2 years ago").

---

## Configuration Reference

| Option | Default | Description |
|--------|---------|-------------|
| `consolidation.trigger` | `'interval'` | What triggers a consolidation run |
| `consolidation.every` | `3_600_000` | Interval (ms) or turn count depending on trigger |
| `consolidation.pruneThreshold` | `0.05` | Strength below which traces are pruned |
| `consolidation.mergeThreshold` | `0.95` | Cosine similarity above which traces are merged |
| `consolidation.deriveInsights` | `true` | Whether to synthesise insight traces from clusters |
| `consolidation.maxDerivedPerCycle` | `10` | Max new insight traces per cycle |
| `consolidation.maxTracesPerCycle` | `500` | Max traces processed per cycle |
| `consolidation.minClusterSize` | `5` | Min cluster size for schema integration |

---

## Source Files

| File | Purpose |
|------|---------|
| `memory/consolidation/ConsolidationLoop.ts` | 6-step consolidation pipeline |
| `memory/feedback/RetrievalFeedbackSignal.ts` | Used/ignored detection + decay modulation |
| `memory/observation/ObservationCompressor.ts` | LLM-backed 3-10x compression |
| `memory/observation/ObservationReflector.ts` | LLM-backed reflection + conflict resolution |
| `memory/observation/temporal.ts` | Three-date model + relativeTimeLabel() |
| `memory/decay/DecayModel.ts` | Ebbinghaus curve, updateOnRetrieval, penalizeUnused |
