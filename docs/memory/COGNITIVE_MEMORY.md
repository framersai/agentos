# Cognitive Memory System

:::tip See also
For CLI usage and agent configuration, see [Memory System on docs.wunderland.sh](https://docs.wunderland.sh/guides/memory-system).
:::

> Personality-modulated, decay-aware memory grounded in cognitive science — replacing flat key-value memory with Ebbinghaus forgetting curves, Baddeley's working memory, spreading activation, and HEXACO-driven encoding biases.

:::tip Cognitive Mechanisms
The memory system now includes 8 optional neuroscience-grounded cognitive mechanisms (reconsolidation, retrieval-induced forgetting, involuntary recall, metacognitive FOK, temporal gist, schema encoding, source confidence decay, emotion regulation). All are HEXACO personality-modulated and individually configurable via `cognitiveMechanisms` on `CognitiveMemoryConfig`. See [Cognitive Mechanisms Implementation Guide](./COGNITIVE_MECHANISMS.md) for hook points, APIs, and testing. See [Cognitive Mechanisms Reference](../../../../docs/memory/cognitive-mechanisms.md) for full science citations and Wunderland integration.
:::

---

## Overview

Traditional agent memory systems treat memory as a flat store: ingest text, embed it, retrieve by similarity. This ignores decades of cognitive science on how biological memory actually works — encoding strength varies with arousal and personality, memories decay over time, retrieval is biased by mood, and working memory has a finite capacity.

The **Cognitive Memory System** models memory as a dynamic, personality-modulated process:

- **Encoding** is shaped by the agent's HEXACO personality traits and current emotional state (PAD model)
- **Forgetting** follows the Ebbinghaus exponential decay curve with spaced repetition reinforcement
- **Retrieval** combines six signals (strength, similarity, recency, emotional congruence, graph activation, importance)
- **Working memory** enforces Baddeley's slot-based capacity limits (7 plus/minus 2, personality-modulated)
- **Consolidation** runs periodically to prune weak traces, merge clusters into schemas, and resolve conflicts

The system is implemented as a composable module within AgentOS. Core features (Batch 1) work with zero LLM calls. Advanced features (Batch 2 — observer, reflector, graph, consolidation) activate automatically when their config is provided and degrade gracefully when absent.

### Cognitive Science Foundations

| Model | Application in AgentOS |
|-------|----------------------|
| Atkinson-Shiffrin | Sensory input -> working memory -> long-term memory pipeline |
| Baddeley's working memory | Slot-based capacity limits with activation levels |
| Tulving's LTM taxonomy | Episodic, semantic, procedural, prospective memory types |
| Ebbinghaus forgetting curve | Exponential strength decay over time |
| Yerkes-Dodson law | Encoding quality peaks at moderate arousal (inverted U) |
| Brown & Kulik flashbulb memories | High-emotion events create vivid, persistent traces |
| Mood-congruent encoding | Content matching current mood valence is encoded more strongly |
| Anderson's ACT-R | Spreading activation through associative memory graph |
| Hebbian learning | "Neurons that fire together wire together" — co-retrieval strengthens edges |
| HEXACO personality model | Trait-driven attention weights and memory capacity modulation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CognitiveMemoryManager                          │
│                      (top-level orchestrator)                       │
└──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────┘
   │      │      │      │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────────┐
│Encod-││Decay ││Work- ││Memory││Prompt││Memory││Obser-││Consolida-│
│ ing  ││Model ││ ing  ││Store ││Assem-││Graph ││ver / ││tion Pipe-│
│Model ││      ││Memory││      ││bler  ││      ││Reflec││line      │
│      ││      ││      ││      ││      ││      ││tor   ││          │
└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───────┘
   │       │       │       │       │       │       │       │
   ▼       ▼       ▼       ▼       ▼       ▼       ▼       ▼
┌──────┐┌──────┐┌──────┐┌──────────────┐┌──────┐┌──────┐┌──────────┐
│HEXACO││Ebbng-││Badde-││  IVectorStore││Spread││LLM   ││Prospec-  │
│Traits││haus  ││ley   ││  + IKnowledge││ing   ││Invok-││tive Mem- │
│+ PAD ││Curve ││Slots ││    Graph     ││Activ.││er    ││ory Mgr   │
└──────┘└──────┘└──────┘└──────────────┘└──────┘└──────┘└──────────┘
```

**Per-turn data flow (GMI integration):**

```
User Message arrives
  1. encode()          — Create MemoryTrace from input (personality-modulated strength)
  2. retrieve()        — Query vector store + score with 6-signal composite
  3. assembleForPrompt — Token-budgeted context assembly → inject into system prompt
  4. [LLM generates response]
  5. observe()         — Feed response to observer buffer (Batch 2)
  6. checkProspective  — Check time/event/context triggers (Batch 2)
  7. runConsolidation   — Periodic background sweep (Batch 2, timer-based)
```

---

## Memory Types

Based on Tulving's long-term memory taxonomy with extensions:

| Type | Cognitive Model | AgentOS Usage | Example |
|------|----------------|---------------|---------|
| `episodic` | Autobiographical events | Conversation events, interactions | "User asked about deployment on Tuesday" |
| `semantic` | General knowledge/facts | Learned facts, preferences, schemas | "User prefers TypeScript over Python" |
| `procedural` | Skills and how-to | Workflows, tool usage patterns | "To deploy, run `wunderland deploy`" |
| `prospective` | Future intentions | Goals, reminders, planned actions | "Remind user about the PR review" |

---

## Memory Scopes

Each trace is scoped to control visibility and ownership:

| Scope | Visibility | Persistence | Use Case |
|-------|-----------|-------------|----------|
| `thread` | Single conversation | Conversation lifetime | In-conversation working context |
| `user` | All conversations with a user | Long-term | User preferences, facts, history |
| `persona` | All users of a persona | Long-term | Persona's learned knowledge |
| `organization` | All agents in an org | Long-term | Shared organizational knowledge |

Collections in the vector store are named `{prefix}_{scope}_{scopeId}` (default prefix: `cogmem`).

---

## The MemoryTrace Envelope

Every memory is wrapped in a `MemoryTrace` — the universal envelope carrying content, provenance, emotional context, and decay parameters:

| Field Group | Key Fields | Purpose |
|-------------|-----------|---------|
| **Identity** | `id`, `type`, `scope`, `scopeId` | Classification and routing |
| **Content** | `content`, `structuredData`, `entities`, `tags` | The actual memory data |
| **Provenance** | `sourceType`, `sourceId`, `confidence`, `verificationCount`, `contradictedBy` | Source monitoring to prevent confabulation |
| **Emotional Context** | `valence`, `arousal`, `dominance`, `intensity`, `gmiMood` | PAD snapshot at encoding time |
| **Decay Parameters** | `encodingStrength` (S0), `stability` (tau), `retrievalCount`, `lastAccessedAt` | Ebbinghaus curve inputs |
| **Spaced Repetition** | `reinforcementInterval`, `nextReinforcementAt` | Interval doubling schedule |
| **Graph** | `associatedTraceIds` | Links to related traces |
| **Lifecycle** | `createdAt`, `updatedAt`, `consolidatedAt`, `isActive` | Timestamps and soft-delete flag |

Source types: `user_statement`, `agent_inference`, `tool_result`, `observation`, `reflection`, `external`.

---

## Encoding Model

Source: `src/memory/core/encoding/EncodingModel.ts`

Encoding determines **how strongly** a new input is committed to memory. The system combines four cognitive mechanisms:

### 1. HEXACO Personality -> Encoding Weights

Each HEXACO trait modulates attention to specific content features:

| Trait | Attention Weight | Formula | Effect |
|-------|-----------------|---------|--------|
| Openness | `noveltyAttention` | `0.3 + O * 0.7` | High O notices novel, creative content |
| Conscientiousness | `proceduralAttention` | `0.3 + C * 0.7` | High C notices procedures, structure |
| Emotionality | `emotionalSensitivity` | `0.2 + E * 0.8` | High E amplifies emotional content |
| Extraversion | `socialAttention` | `0.2 + X * 0.8` | High X notices social dynamics |
| Agreeableness | `cooperativeAttention` | `0.2 + A * 0.8` | High A notices cooperation cues |
| Honesty | `ethicalAttention` | `0.2 + H * 0.8` | High H notices ethical/moral content |

The **composite attention multiplier** starts at 0.5 and adds weighted bonuses for each detected content feature (0.10-0.15 each), plus a base 0.15 for contradictions and topic relevance.

### 2. Yerkes-Dodson Arousal Curve

Encoding quality peaks at moderate arousal (inverted U):

```
f(a) = 1 - 4 * (a - 0.5)^2

where a = arousal normalised to [0, 1]
```

Returns a multiplier in `[0.3, 1.0]`, peaking at `a = 0.5`. Very low arousal (bored) and very high arousal (panicked) both impair encoding.

### 3. Mood-Congruent Encoding

Content whose emotional valence matches the current mood is encoded more strongly:

```
boost = 1 + max(0, currentValence * contentValence) * emotionalSensitivity * 0.3
```

Positive product means mood and content are congruent (both positive or both negative).

### 4. Flashbulb Memories

When emotional intensity exceeds the threshold (default: 0.8), the memory becomes a **flashbulb memory**:

- Strength multiplier: `2.0x` (default)
- Stability multiplier: `5.0x` (default)

These model the vivid, persistent memories formed during highly emotional events (Brown & Kulik, 1977).

### Composite Encoding Strength

```
S₀ = min(1.0, base * arousalBoost * emotionalBoost * attentionMultiplier * congruenceBoost * flashbulbBoost)
```

Default `base = 0.5`. The stability (time constant for decay) is computed as:

```
stability = baseStabilityMs * (1 + S₀ * 6) * flashbulbStabilityMultiplier
```

Default `baseStabilityMs = 3,600,000` (1 hour). Stronger memories are inherently more stable.

---

## Content Feature Detection

The encoding model needs to know **what features** the content contains. Three detection strategies are available:

| Strategy | Speed | Quality | LLM Calls | Best For |
|----------|-------|---------|-----------|----------|
| `keyword` | Fast | Moderate | 0 | Default; low-latency agents |
| `llm` | Slow | High | 1 per encode | High-fidelity agents with budget |
| `hybrid` | Medium | High | Periodic | Best balance; keyword first, LLM re-classification during consolidation |

Detected features (`ContentFeatures`): `hasNovelty`, `hasProcedure`, `hasEmotion`, `hasSocialContent`, `hasCooperation`, `hasEthicalContent`, `hasContradiction`, `topicRelevance`.

Configure via `featureDetectionStrategy` in `CognitiveMemoryConfig`.

---

## Forgetting & Decay

Source: `src/memory/core/decay/DecayModel.ts`

### Ebbinghaus Forgetting Curve

Memory strength decays exponentially over time:

```
S(t) = S₀ * e^(-dt / stability)

where:
  S₀       = initial encoding strength
  dt       = time elapsed since last access (ms)
  stability = time constant (ms); grows with each retrieval
```

### Spaced Repetition

Each successful retrieval updates the trace via the **desirable difficulty** effect:

- **Difficulty bonus**: `max(0.1, 1 - currentStrength)` — weaker memories get larger stability boosts
- **Diminishing returns**: `1 / (1 + 0.1 * retrievalCount)` — logarithmic saturation
- **Emotional bonus**: `1 + intensity * 0.3` — emotional memories consolidate faster
- **Growth factor**: `(1.5 + difficultyBonus * 2.0) * diminish * emotionalBonus`
- **Interval doubling**: `reinforcementInterval *= 2` after each retrieval

### Interference

When a new trace overlaps with existing traces (cosine similarity > threshold, default 0.7):

- **Retroactive interference**: New trace weakens old similar traces (strength reduction ~0.15 at similarity 1.0)
- **Proactive interference**: Old traces impair new encoding (capped at 0.3 total reduction)

### Pruning

Traces with `currentStrength < pruningThreshold` (default: 0.05) are soft-deleted during consolidation, **unless** their emotional intensity exceeds 0.3 (emotional memories are protected from pruning).

---

## Retrieval Priority Scoring

Source: `src/memory/core/decay/RetrievalPriorityScorer.ts`

Retrieval combines six signals into a composite score:

| Signal | Weight | Range | Computation |
|--------|--------|-------|-------------|
| `strength` | 0.25 | 0-1 | `S₀ * e^(-dt / stability)` |
| `similarity` | 0.35 | 0-1 | Cosine similarity from vector search |
| `recency` | 0.10 | 0-1 | `(e^(-elapsed / halfLife)) / 0.2` (normalised) |
| `emotionalCongruence` | 0.15 | 0-1 | `max(0, moodValence * traceValence) / 0.25` (normalised) |
| `graphActivation` | 0.10 | 0-1 | Spreading activation score (0 without graph) |
| `importance` | 0.05 | 0-1 | `confidence * 0.5 + 0.5` |

**Composite score:**

```
score = clamp(0, 1,
  w_str * strengthScore +
  w_sim * similarityScore +
  w_rec * recencyNorm +
  w_emo * emotionalNorm +
  w_graph * graphActivation +
  w_imp * importanceScore
)
```

Setting `neutralMood: true` in retrieval options disables emotional congruence bias (useful for factual lookups).

### Tip-of-the-Tongue Detection

Traces with high vector similarity (>0.6) but low strength (<0.3) or low confidence (<0.4) are returned as `PartiallyRetrievedTrace` — the agent "almost" remembers them. These include `suggestedCues` (tags) to help the user provide more context.

---

## Working Memory (Baddeley's Model)

Source: `src/memory/core/working/CognitiveWorkingMemory.ts`

Working memory is a **slot-based, capacity-limited** buffer that tracks what the agent is currently "thinking about."

### Capacity

Base capacity follows Miller's number (7), modulated by personality:

- High openness (>0.6): **+1 slot** (broader attention span)
- High conscientiousness (>0.6): **-1 slot** (deeper focus per item)
- Result clamped to `[5, 9]` (Miller's 7 plus/minus 2)

### Slot Mechanics

Each `WorkingMemorySlot` tracks:

| Field | Range | Purpose |
|-------|-------|---------|
| `activationLevel` | 0-1 | How "in focus" this item is |
| `attentionWeight` | 0-1 | Proportional share of attention (normalised) |
| `rehearsalCount` | 0+ | Maintenance rehearsal bumps (+0.15 per rehearse) |
| `enteredAt` | Unix ms | When the trace entered working memory |

### Activation Lifecycle

1. **Focus**: New trace enters at `initialActivation` (default 0.8). If at capacity, lowest-activation slot is evicted first.
2. **Rehearsal**: `rehearse(slotId)` bumps activation by 0.15 (capped at 1.0).
3. **Decay**: Each turn, all activations decrease by `activationDecayRate` (default 0.1).
4. **Eviction**: Slots below `minActivation` (default 0.15) are evicted. The `onEvict` callback can encode evicted items back to long-term memory.

### Prompt Formatting

`formatForPrompt()` outputs slots sorted by activation:

```
- [ACTIVE] mt_1234 (activation: 0.85)
- [fading] mt_1235 (activation: 0.52)
- [weak]   mt_1236 (activation: 0.20)
```

---

## Memory Store

Source: `src/memory/retrieval/store/MemoryStore.ts`

The `MemoryStore` wraps `IVectorStore` + `IKnowledgeGraph` into a unified persistence layer:

- **Store**: Embeds content via `IEmbeddingManager`, upserts into vector store, records as episodic memory in knowledge graph
- **Query**: Vector search -> decay-aware scoring -> tip-of-the-tongue detection
- **Access tracking**: Updates spaced repetition parameters on each retrieval
- **Soft delete**: Sets `isActive = false` without removing from store

### Collection Naming

Collections follow the pattern `{prefix}_{scope}_{scopeId}`:

```
cogmem_user_agent-123
cogmem_thread_conv-456
cogmem_persona_helper-bot
cogmem_organization_acme-org
```

---

## Memory Graph

Source: `src/memory/retrieval/graph/IMemoryGraph.ts`

The `IMemoryGraph` interface abstracts over two backends:

| Backend | Implementation | Use Case |
|---------|---------------|----------|
| `graphology` | `GraphologyMemoryGraph` | Dev/testing, in-memory, fast |
| `knowledge-graph` | `KnowledgeGraphMemoryGraph` | Production, wraps `IKnowledgeGraph` |

Configure via `graph.backend` (default: `'knowledge-graph'`).

### Edge Types

| Edge Type | Meaning | Weight |
|-----------|---------|--------|
| `SHARED_ENTITY` | Traces mention the same entity | 0.5 |
| `TEMPORAL_SEQUENCE` | Traces created within 5 minutes | 0.3 |
| `SAME_TOPIC` | Traces share topic cluster | varies |
| `CONTRADICTS` | Traces contain conflicting information | varies |
| `SUPERSEDES` | One trace replaces another | varies |
| `CAUSED_BY` | Causal relationship | varies |
| `CO_ACTIVATED` | Traces retrieved together (Hebbian) | grows |
| `SCHEMA_INSTANCE` | Episodic trace is instance of semantic schema | 0.6 |

---

## Spreading Activation

Source: `src/memory/retrieval/graph/SpreadingActivation.ts`

Implements Anderson's ACT-R spreading activation model. Given seed nodes (top retrieval results), activation spreads through the graph to surface associated memories.

### Algorithm (BFS)

1. Seed nodes start at `activation = 1.0`
2. Each hop: `neighbor_activation = current * edge_weight * decayPerHop`
3. Multi-path summation (capped at 1.0) — traces reachable by multiple paths get boosted
4. BFS with `maxDepth` (default 3) and `activationThreshold` (default 0.1) cutoffs
5. Results sorted by activation descending, capped at `maxResults` (default 20)

### Configuration

| Parameter | Default | Effect |
|-----------|---------|--------|
| `maxDepth` | 3 | Maximum hops from seed nodes |
| `decayPerHop` | 0.5 | Activation multiplier per hop |
| `activationThreshold` | 0.1 | Minimum activation to continue |
| `maxResults` | 20 | Maximum activated nodes returned |

### Hebbian Learning

After retrieval, co-retrieved memories are recorded via `recordCoActivation()`. This strengthens `CO_ACTIVATED` edges between memories that are frequently retrieved together, implementing the Hebbian rule: "neurons that fire together wire together."

The learning rate (default 0.1) controls how quickly edge weights grow.

---

## Observer/Reflector System

### Memory Observer

Source: `src/memory/pipeline/observation/MemoryObserver.ts`

The observer monitors accumulated conversation tokens via a buffer. When the threshold is reached (default: 30,000 tokens), it extracts concise observation notes via a persona-configured LLM.

**Personality bias in observation:**

| High Trait | Observer Focus |
|-----------|---------------|
| Emotionality | Emotional shifts, tone changes, sentiment transitions |
| Conscientiousness | Commitments, deadlines, action items, structured plans |
| Openness | Creative tangents, novel ideas, exploratory topics |
| Agreeableness | User preferences, rapport cues, communication style |
| Honesty | Corrections, retractions, contradictions |

Observation notes are typed: `factual`, `emotional`, `commitment`, `preference`, `creative`, `correction`.

### Memory Reflector

Source: `src/memory/pipeline/observation/MemoryReflector.ts`

The reflector consolidates accumulated observation notes into long-term memory traces. Activates when note tokens exceed threshold (default: 40,000 tokens).

**Pipeline:**
1. Merge redundant observations
2. Elevate important facts to long-term traces
3. Detect conflicts against existing memories
4. Resolve conflicts based on personality:
   - High honesty: prefer newer information, supersede old
   - High agreeableness: keep both versions, note discrepancy
   - Default: prefer higher confidence

**Target compression:** 5-40x (many observations -> few high-quality traces).

Personality also controls **memory style**:
- High conscientiousness: structured, well-organized traces
- High openness: rich, associative traces with connections
- Default: concise, factual traces

---

## Prospective Memory

Source: `src/memory/retrieval/prospective/ProspectiveMemoryManager.ts`

Prospective memory handles **future intentions** — "remember to do X when Y happens."

### Trigger Types

| Type | Fires When | Example |
|------|-----------|---------|
| `time_based` | Current time >= `triggerAt` | "Remind me at 3pm" |
| `event_based` | Named event in `context.events` | "When user mentions deployment" |
| `context_based` | Query embedding similarity > threshold | "When we discuss pricing" |

### Registration

```typescript
await manager.register({
  content: 'Remind user about the PR review',
  triggerType: 'time_based',
  triggerAt: Date.now() + 3_600_000, // 1 hour
  importance: 0.8,
  recurring: false,
});
```

### Checking

Checked each turn before prompt construction. Triggered items are injected into the "Reminders" section of the assembled memory context. Items can be `recurring` (re-trigger) or one-shot (marked `triggered` after firing).

Context-based triggers use cosine similarity between the cue embedding and the current query embedding, with a configurable `similarityThreshold` (default 0.7).

---

## Consolidation Pipeline

Source: `src/memory/pipeline/consolidation/ConsolidationPipeline.ts`

Runs periodically (default: every hour) to maintain memory health. Five steps:

### Step 1: Decay Sweep

Apply Ebbinghaus curve to all traces, soft-delete those below `pruningThreshold` (default 0.05). Emotional memories (intensity > 0.3) are protected.

### Step 2: Co-Activation Replay

Process recent traces (last 24 hours) to create graph edges:
- **SHARED_ENTITY**: Traces mentioning the same entity get connected (weight 0.5)
- **TEMPORAL_SEQUENCE**: Traces created within 5 minutes get connected (weight 0.3)

### Step 3: Schema Integration

Use `detectClusters()` on the memory graph (minimum cluster size: 5). For each cluster, invoke an LLM to summarize member traces into a single semantic knowledge node. Connect via `SCHEMA_INSTANCE` edges.

### Step 4: Conflict Resolution

Scan `CONTRADICTS` edges and resolve based on personality:
- High honesty (>0.6): Prefer newer information, soft-delete the older trace
- Default: Prefer higher confidence (only if confidence difference >0.2)

### Step 5: Spaced Repetition

Find traces past their `nextReinforcementAt` timestamp and boost them via `recordAccess()`, which increases stability and doubles the reinforcement interval.

### Result

```typescript
interface ConsolidationResult {
  prunedCount: number;        // Traces soft-deleted
  edgesCreated: number;       // Graph edges created
  schemasCreated: number;     // Semantic schemas from clusters
  conflictsResolved: number;  // Contradictions resolved
  reinforcedCount: number;    // Traces reinforced
  totalProcessed: number;     // Total traces examined
  durationMs: number;         // Cycle duration
}
```

---

## Prompt Assembly

Source: `src/memory/core/prompt/MemoryPromptAssembler.ts`

Assembles memory context into a single formatted string within a token budget, split across six sections with overflow redistribution.

### Default Budget Allocation

| Section | Budget % | Content |
|---------|---------|---------|
| Working Memory | 15% | Active context from slot buffer |
| Semantic Recall | 45% | Retrieved semantic/procedural traces |
| Recent Episodic | 25% | Retrieved episodic traces |
| Prospective Alerts | 5% | Triggered reminders (Batch 2) |
| Graph Associations | 5% | Spreading activation context (Batch 2) |
| Observation Notes | 5% | Recent observer notes (Batch 2) |

### Overflow Redistribution

If a section uses less than its budget, the overflow flows to Semantic Recall. If Batch 2 sections are empty (no observer, no graph, no prospective items), their budgets are also redistributed to Semantic Recall.

### Personality -> Formatting Style

The assembler selects a formatting style based on the dominant HEXACO trait:

| Dominant Trait | Style | Output |
|---------------|-------|--------|
| Conscientiousness | `structured` | Bullet points, categories |
| Openness | `narrative` | Flowing prose, connections |
| Emotionality | `emotional` | Emphasis on feelings, tone |

### Output Sections

```
## Active Context
- [ACTIVE] mt_1234 (activation: 0.85)

## Relevant Memories
- [semantic, score=0.82] User prefers TypeScript...

## Recent Experiences
- [episodic, score=0.71] Discussed deployment on Tuesday...

## Reminders
- [time_based] PR review is due

## Related Context
- [associated, activation=0.45] Related discussion about CI/CD...

## Observations
- User tends to ask follow-up questions about error handling
```

Token estimation uses ~4 chars per token heuristic.

---

## Configuration

### CognitiveMemoryConfig (Top-Level)

```typescript
interface CognitiveMemoryConfig {
  // --- Required dependencies ---
  workingMemory: IWorkingMemory;      // Existing AgentOS working memory
  knowledgeGraph: IKnowledgeGraph;    // Existing AgentOS knowledge graph
  vectorStore: IVectorStore;          // Vector store for embeddings
  embeddingManager: IEmbeddingManager; // Embedding generation

  // --- Agent identity ---
  agentId: string;
  traits: HexacoTraits;              // { honesty, emotionality, extraversion, agreeableness, conscientiousness, openness }
  moodProvider: () => PADState;      // Callback to get current mood

  // --- Feature detection ---
  featureDetectionStrategy: 'keyword' | 'llm' | 'hybrid'; // Default: 'keyword'
  featureDetectionLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;

  // --- Tuning ---
  encoding?: Partial<EncodingConfig>;        // See defaults below
  decay?: Partial<DecayConfig>;              // See defaults below
  workingMemoryCapacity?: number;            // Default: 7 (Miller's number)
  tokenBudget?: Partial<MemoryBudgetAllocation>;
  collectionPrefix?: string;                 // Default: 'cogmem'

  // --- Batch 2 (optional, no-op when absent) ---
  observer?: Partial<ObserverConfig>;
  reflector?: Partial<ReflectorConfig>;
  graph?: Partial<MemoryGraphConfig>;
  consolidation?: Partial<ConsolidationConfig>;
}
```

### Encoding Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `baseStrength` | 0.5 | Base encoding strength before modulation |
| `flashbulbThreshold` | 0.8 | Emotional intensity threshold for flashbulb |
| `flashbulbStrengthMultiplier` | 2.0 | Strength boost for flashbulb memories |
| `flashbulbStabilityMultiplier` | 5.0 | Stability boost for flashbulb memories |
| `baseStabilityMs` | 3,600,000 | Base stability (1 hour) |

### Decay Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `pruningThreshold` | 0.05 | Strength below which traces are pruned |
| `recencyHalfLifeMs` | 86,400,000 | Recency boost half-life (24 hours) |
| `interferenceThreshold` | 0.7 | Cosine similarity threshold for interference |

### Graph Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `backend` | `'knowledge-graph'` | Graph backend selection |
| `maxDepth` | 3 | Spreading activation max hops |
| `decayPerHop` | 0.5 | Activation decay per hop |
| `activationThreshold` | 0.1 | Minimum activation to continue |
| `hebbianLearningRate` | 0.1 | Co-activation edge strengthening rate |

### Consolidation Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `intervalMs` | 3,600,000 | Run interval (1 hour) |
| `maxTracesPerCycle` | 500 | Max traces per cycle |
| `mergeSimilarityThreshold` | 0.92 | Similarity threshold for merging |
| `minClusterSize` | 5 | Min cluster size for schema integration |

---

## Quick Start

Minimal setup with core features (no LLM calls, no Batch 2):

```typescript
import { CognitiveMemoryManager } from '@framers/agentos/memory';

const memory = new CognitiveMemoryManager();

await memory.initialize({
  workingMemory: existingWorkingMemory,
  knowledgeGraph: existingKnowledgeGraph,
  vectorStore: existingVectorStore,
  embeddingManager: existingEmbeddingManager,
  agentId: 'my-agent',
  traits: { openness: 0.7, conscientiousness: 0.8, emotionality: 0.5 },
  moodProvider: () => ({ valence: 0, arousal: 0.3, dominance: 0 }),
  featureDetectionStrategy: 'keyword',
});

// Encode a user message
const mood = { valence: 0.2, arousal: 0.4, dominance: 0 };
const trace = await memory.encode(
  'I prefer deploying with Docker Compose',
  mood,
  'content',
  { type: 'semantic', scope: 'user', tags: ['deployment', 'docker'] },
);

// Retrieve relevant memories before prompt construction
const result = await memory.retrieve('How should I deploy?', mood, { topK: 5 });

// Assemble for prompt injection (1000 token budget)
const context = await memory.assembleForPrompt('How should I deploy?', 1000, mood);
console.log(context.contextText);    // Formatted memory context
console.log(context.tokensUsed);     // Actual tokens used
```

Full setup with all Batch 2 features:

```typescript
const llmInvoker = async (system: string, user: string) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return response.choices[0].message.content ?? '';
};

await memory.initialize({
  // ... core config as above ...
  observer: { activationThresholdTokens: 30_000, llmInvoker },
  reflector: { activationThresholdTokens: 40_000, llmInvoker },
  graph: { backend: 'knowledge-graph', maxDepth: 3, decayPerHop: 0.5 },
  consolidation: { intervalMs: 3_600_000, minClusterSize: 5 },
});

// Observer: feed each message
await memory.observe('user', 'I need to deploy by Friday', mood);
await memory.observe('assistant', 'I can help with that deployment.', mood);

// Prospective: register a reminder
const pm = memory.getProspective();
await pm.register({
  content: 'User needs deployment done by Friday',
  triggerType: 'time_based',
  triggerAt: fridayTimestamp,
  importance: 0.9,
  recurring: false,
});

// Consolidation runs automatically on timer, or manually:
const result = await memory.runConsolidation();
console.log(`Pruned ${result.prunedCount}, created ${result.schemasCreated} schemas`);
```

---

## Integration with GMI

The Cognitive Memory System integrates into the GMI turn loop at three points:

### After User Message (Encode)

```typescript
// In the GMI turn handler, after receiving user input:
const mood = moodEngine.getCurrentState();
await cognitiveMemory.encode(userMessage, mood, gmiMood, {
  type: 'episodic',
  scope: 'user',
  scopeId: userId,
  sourceType: 'user_statement',
});
```

### Before Prompt Construction (Retrieve + Assemble)

```typescript
// Before building the system prompt:
const memoryContext = await cognitiveMemory.assembleForPrompt(
  userMessage,
  tokenBudget,
  mood,
);
// Inject memoryContext.contextText into the prompt via PromptBuilder
```

### After Response (Observe)

```typescript
// After the LLM generates a response:
await cognitiveMemory.observe('assistant', assistantResponse, mood);

// Also feed user messages to observer for conversation monitoring:
await cognitiveMemory.observe('user', userMessage, mood);
```

---

## Comparison with Mastra

The Cognitive Memory System addresses 12 limitations in Mastra's memory architecture:

| # | Mastra Limitation | AgentOS Improvement |
|---|-------------------|-------------------|
| 1 | Flat strength (all memories equal) | HEXACO-modulated encoding strength with Yerkes-Dodson arousal curve |
| 2 | No forgetting | Ebbinghaus exponential decay with configurable stability |
| 3 | No spaced repetition | Desirable difficulty effect with interval doubling |
| 4 | No working memory limits | Baddeley's model with personality-modulated capacity (5-9 slots) |
| 5 | No emotional context | PAD model snapshot at encoding, mood-congruent retrieval bias |
| 6 | Single retrieval signal (similarity) | 6-signal composite scoring (strength, similarity, recency, emotion, graph, importance) |
| 7 | No memory graph | IMemoryGraph with 8 edge types and spreading activation |
| 8 | No interference modeling | Proactive and retroactive interference with configurable thresholds |
| 9 | No consolidation | 5-step pipeline: decay sweep, replay, schema integration, conflict resolution, reinforcement |
| 10 | No prospective memory | Time, event, and context-based triggers with recurring support |
| 11 | No observer/reflector | Personality-biased observation + LLM-driven consolidation into traces |
| 12 | No provenance tracking | Full source monitoring with confidence, verification count, and contradiction detection |

---

## Source Files

All source lives in `packages/agentos/src/memory/`:

| File | Export |
|------|--------|
| `types.ts` | All types: `MemoryTrace`, `MemoryType`, `MemoryScope`, `ScoredMemoryTrace`, etc. |
| `config.ts` | `CognitiveMemoryConfig`, `EncodingConfig`, `DecayConfig`, defaults |
| `CognitiveMemoryManager.ts` | `CognitiveMemoryManager`, `ICognitiveMemoryManager` |
| `encoding/EncodingModel.ts` | `computeEncodingStrength`, `yerksDodson`, `buildEmotionalContext` |
| `encoding/ContentFeatureDetector.ts` | `createFeatureDetector`, `IContentFeatureDetector` |
| `decay/DecayModel.ts` | `computeCurrentStrength`, `updateOnRetrieval`, `computeInterference` |
| `decay/RetrievalPriorityScorer.ts` | `scoreAndRankTraces`, `detectPartiallyRetrieved` |
| `working/CognitiveWorkingMemory.ts` | `CognitiveWorkingMemory` |
| `store/MemoryStore.ts` | `MemoryStore` |
| `prompt/MemoryPromptAssembler.ts` | `assembleMemoryContext` |
| `prompt/MemoryFormatters.ts` | `formatMemoryTrace`, `FormattingStyle` |
| `graph/IMemoryGraph.ts` | `IMemoryGraph`, `MemoryEdgeType`, `ActivatedNode` |
| `graph/SpreadingActivation.ts` | `spreadActivation` |
| `graph/GraphologyMemoryGraph.ts` | `GraphologyMemoryGraph` |
| `graph/KnowledgeGraphMemoryGraph.ts` | `KnowledgeGraphMemoryGraph` |
| `observation/MemoryObserver.ts` | `MemoryObserver`, `ObservationNote` |
| `observation/MemoryReflector.ts` | `MemoryReflector`, `MemoryReflectionResult` |
| `observation/ObservationBuffer.ts` | `ObservationBuffer` |
| `prospective/ProspectiveMemoryManager.ts` | `ProspectiveMemoryManager`, `ProspectiveMemoryItem` |
| `consolidation/ConsolidationPipeline.ts` | `ConsolidationPipeline`, `ConsolidationResult` |

---

## Relationship to Persistent Working Memory

AgentOS provides two complementary working memory systems:

| | Baddeley Cognitive Working Memory | Persistent Markdown Working Memory |
|---|---|---|
| Purpose | In-session attention modeling | Cross-session user context |
| Lifespan | Single session (in-memory) | Persists on disk (~/.wunderland/agents/{id}/working-memory.md) |
| Updates | Automatic activation decay | Agent calls `update_working_memory` tool |
| Format | Capacity-limited slots (7±2) | Free-form markdown template |
| Budget | 15% of prompt tokens | 5% of prompt tokens |

Both are injected into the system prompt simultaneously. The persistent memory appears as `## Persistent Memory` before the cognitive slots. See [Persistent Working Memory](./WORKING_MEMORY.md) for details.
