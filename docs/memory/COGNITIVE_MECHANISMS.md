# Cognitive Mechanisms — Package Implementation Guide

## File Structure

```
packages/agentos/src/memory/mechanisms/
├── types.ts                          # CognitiveMechanismsConfig + shared types
├── defaults.ts                       # DEFAULT_MECHANISMS_CONFIG + resolveConfig()
├── CognitiveMechanismsEngine.ts      # Lifecycle hook orchestrator
├── retrieval/
│   ├── Reconsolidation.ts            # Emotional drift on access
│   ├── RetrievalInducedForgetting.ts # Competitor suppression
│   ├── InvoluntaryRecall.ts          # Random memory surfacing
│   └── MetacognitiveFOK.ts           # Feeling-of-knowing scoring
├── consolidation/
│   ├── TemporalGist.ts               # Verbatim→gist compression
│   ├── SchemaEncoding.ts             # Schema-congruent detection
│   ├── SourceConfidenceDecay.ts      # Source-type decay multipliers
│   └── EmotionRegulation.ts          # Reappraisal & suppression
├── __tests__/
│   ├── types.test.ts                 # Config shapes, defaults
│   ├── retrieval.test.ts             # 4 retrieval mechanisms
│   ├── consolidation.test.ts         # 4 consolidation mechanisms
│   └── engine.test.ts                # Engine lifecycle hooks
└── index.ts                          # Barrel exports
```

## Hook Points

| Existing File | Method | Hook | When |
|---|---|---|---|
| `store/MemoryStore.ts` | `recordAccess()` | `engine.onAccess(trace, mood)` | After spaced repetition update |
| `store/MemoryStore.ts` | `query()` | `engine.onRetrieval(scored, candidates, cutoff, entities)` | After scoring, before return |
| `prompt/MemoryPromptAssembler.ts` | `assembleMemoryContext()` | `engine.onPromptAssembly(allTraces, retrievedIds)` | Before final return |
| `CognitiveMemoryManager.ts` | `initialize()` | Engine construction | Dynamic import when config present |

The consolidation hook (`engine.onConsolidation()`) is available on the engine but wiring into `ConsolidationLoop.run()` is deferred to when the loop is instantiated with a mechanisms-aware config.

## Mechanism API Summary

### Retrieval-Time (synchronous)

```typescript
// Reconsolidation: mutates trace.emotionalContext in place
applyReconsolidation(trace: MemoryTrace, currentMood: PADState, config): void

// RIF: mutates competitor.stability in place
applyRetrievalInducedForgetting(retrieved, competitors, config): { suppressedIds: string[] }

// Involuntary Recall: pure selection, no mutation
selectInvoluntaryMemory(allTraces, alreadyRetrievedIds, config): MemoryTrace | null

// FOK: pure detection, no mutation
detectFeelingOfKnowing(scoredCandidates, retrievalCutoff, config, queryEntities): MetacognitiveSignal[]
```

### Consolidation-Time (async for LLM gist extraction)

```typescript
// Temporal Gist: mutates trace.content, trace.encodingStrength, trace.structuredData
applyTemporalGist(traces, config, llmFn?): Promise<number>

// Schema Encoding: mutates trace.encodingStrength, trace.structuredData
applySchemaEncoding(trace, traceEmbedding, clusterCentroids, config): SchemaEncodingResult

// Source Confidence Decay: mutates trace.stability, trace.structuredData
applySourceConfidenceDecay(traces, config): number

// Emotion Regulation: mutates trace.emotionalContext, trace.encodingStrength, trace.structuredData
applyEmotionRegulation(traces, config): number
```

## Guard Conditions

All mechanisms share common guard patterns:

- **Flashbulb immunity:** Traces with `encodingStrength >= 0.9` are skipped by reconsolidation, RIF, temporal gist, and emotion regulation
- **Dead trace protection:** RIF skips traces with `encodingStrength < 0.1`
- **Inactive skip:** All consolidation mechanisms skip `isActive === false` traces
- **Disabled bypass:** Every mechanism returns immediately when `config.enabled === false`

## Metadata Storage

Mechanism metadata is stored in `trace.structuredData.mechanismMetadata` (type `MechanismMetadata`), avoiding changes to the core `MemoryTrace` interface. The metadata is persisted in the vector store's metadata JSON column.

## Testing

Each mechanism is a pure function testable in isolation:

```bash
# All mechanism tests
npx vitest run src/memory/mechanisms/

# Individual mechanism groups
npx vitest run src/memory/mechanisms/__tests__/retrieval.test.ts
npx vitest run src/memory/mechanisms/__tests__/consolidation.test.ts
npx vitest run src/memory/mechanisms/__tests__/engine.test.ts
npx vitest run src/memory/mechanisms/__tests__/types.test.ts
```

For more on the cognitive science foundations, see [docs/memory/cognitive-mechanisms.md](../../../docs/memory/cognitive-mechanisms.md).
