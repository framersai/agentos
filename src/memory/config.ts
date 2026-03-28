/**
 * @fileoverview Configuration types for the Cognitive Memory System.
 * @module agentos/memory/config
 */

import type { IWorkingMemory } from '../cognitive_substrate/memory/IWorkingMemory.js';
import type { IKnowledgeGraph } from '../knowledge/IKnowledgeGraph.js';
import type { IVectorStore } from '../core/vector-store/IVectorStore.js';
import type { IEmbeddingManager } from '../core/embeddings/IEmbeddingManager.js';
import type { MemoryBudgetAllocation } from './types.js';
import type { InfiniteContextConfig } from './context/types.js';

// ---------------------------------------------------------------------------
// PAD state (inlined to avoid circular dep with wunderland)
// ---------------------------------------------------------------------------

/** Pleasure-Arousal-Dominance emotional state. */
export interface PADState {
  valence: number;   // -1..1
  arousal: number;   // -1..1
  dominance: number; // -1..1
}

// ---------------------------------------------------------------------------
// HEXACO traits (inlined to avoid circular dep with wunderland)
// ---------------------------------------------------------------------------

export interface HexacoTraits {
  honesty?: number;
  emotionality?: number;
  extraversion?: number;
  agreeableness?: number;
  conscientiousness?: number;
  openness?: number;
}

// ---------------------------------------------------------------------------
// Sub-configs
// ---------------------------------------------------------------------------

export interface EncodingConfig {
  /** Base encoding strength before personality modulation. @default 0.5 */
  baseStrength: number;
  /** Emotional intensity threshold for flashbulb memory. @default 0.8 */
  flashbulbThreshold: number;
  /** Strength multiplier for flashbulb memories. @default 2.0 */
  flashbulbStrengthMultiplier: number;
  /** Stability multiplier for flashbulb memories. @default 5.0 */
  flashbulbStabilityMultiplier: number;
  /** Base stability in ms (how long before strength halves). @default 3_600_000 (1 hour) */
  baseStabilityMs: number;
}

export interface DecayConfig {
  /** Minimum strength before a trace is soft-deleted. @default 0.05 */
  pruningThreshold: number;
  /** Half-life for recency boost (ms). @default 86_400_000 (24 hours) */
  recencyHalfLifeMs: number;
  /** Cosine similarity threshold for interference detection. @default 0.7 */
  interferenceThreshold: number;
}

export interface ObserverConfig {
  /** Token threshold before observer activates. @default 30_000 */
  activationThresholdTokens: number;
  /** LLM model ID for observation extraction (per-persona). */
  modelId?: string;
  /** LLM invoker function. */
  llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export interface ReflectorConfig {
  /** Token threshold for notes before reflection triggers. @default 40_000 */
  activationThresholdTokens: number;
  /** LLM model ID for reflection/consolidation (per-persona). */
  modelId?: string;
  /** LLM invoker function. */
  llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

export interface MemoryGraphConfig {
  /** Which backend to use. @default 'knowledge-graph' */
  backend: 'graphology' | 'knowledge-graph';
  /** Max hops for spreading activation. @default 3 */
  maxDepth: number;
  /** Activation decay per hop. @default 0.5 */
  decayPerHop: number;
  /** Minimum activation to continue spreading. @default 0.1 */
  activationThreshold: number;
  /** Hebbian learning rate for co-activation edge strengthening. @default 0.1 */
  hebbianLearningRate: number;
}

export interface ConsolidationConfig {
  /** How often to run consolidation (ms). @default 3_600_000 (1 hour) */
  intervalMs: number;
  /** Max traces to process per cycle. @default 500 */
  maxTracesPerCycle: number;
  /** Similarity threshold for merging redundant traces. @default 0.92 */
  mergeSimilarityThreshold: number;
  /** Minimum cluster size for schema integration. @default 5 */
  minClusterSize: number;

  // ---- Facade / lifecycle extensions ----

  /**
   * What event or schedule triggers a consolidation run.
   * - `'turns'`    – fire after every N conversation turns (`every` = turn count).
   * - `'interval'` – fire on a wall-clock timer (`every` = milliseconds).
   * - `'manual'`   – only fire when explicitly requested.
   * @default 'interval'
   */
  trigger?: 'turns' | 'interval' | 'manual';

  /**
   * Numeric complement to `trigger`.
   * When `trigger='turns'` this is the turn count; when `trigger='interval'`
   * this is the millisecond period.
   * @default 3_600_000
   */
  every?: number;

  /**
   * Minimum Ebbinghaus strength below which a trace is pruned.
   * Must be between 0 and 1.
   * @default 0.05
   */
  pruneThreshold?: number;

  /**
   * Cosine similarity above which two traces are candidates for merging.
   * Must be between 0 and 1.
   * @default 0.92
   */
  mergeThreshold?: number;

  /**
   * Whether the consolidation engine should derive new insight traces from
   * clusters of related memories during each cycle.
   * @default true
   */
  deriveInsights?: boolean;

  /**
   * Maximum number of new insight traces the engine may derive per cycle.
   * Guards against unbounded graph growth.
   * @default 10
   */
  maxDerivedPerCycle?: number;
}

// ---------------------------------------------------------------------------
// Per-persona cognitive memory overrides
// ---------------------------------------------------------------------------

export interface CognitiveMemoryPersonaConfig {
  /** Feature detection strategy. @default 'keyword' */
  featureDetectionStrategy?: 'keyword' | 'llm' | 'hybrid';
  /** Working memory slot capacity override. */
  workingMemoryCapacity?: number;
  /** Token budget allocation percentages override. */
  tokenBudget?: Partial<MemoryBudgetAllocation>;
  /** Encoding config overrides. */
  encoding?: Partial<EncodingConfig>;
  /** Decay config overrides. */
  decay?: Partial<DecayConfig>;
  /** Observer config (Batch 2). */
  observer?: Partial<ObserverConfig>;
  /** Reflector config (Batch 2). */
  reflector?: Partial<ReflectorConfig>;
  /** Memory graph config (Batch 2). */
  graph?: Partial<MemoryGraphConfig>;
  /** Infinite context config (Batch 3). */
  infiniteContext?: Partial<InfiniteContextConfig>;
}

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

export interface CognitiveMemoryConfig {
  // --- Existing AgentOS dependencies ---
  workingMemory: IWorkingMemory;
  knowledgeGraph: IKnowledgeGraph;
  vectorStore: IVectorStore;
  embeddingManager: IEmbeddingManager;

  // --- Agent identity ---
  agentId: string;
  traits: HexacoTraits;
  /** Callback to get current mood from MoodEngine or similar. */
  moodProvider: () => PADState;

  // --- Feature detection ---
  /** @default 'keyword' */
  featureDetectionStrategy: 'keyword' | 'llm' | 'hybrid';
  /** Required when strategy is 'llm' or 'hybrid'. */
  featureDetectionLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;

  // --- Tuning ---
  encoding?: Partial<EncodingConfig>;
  decay?: Partial<DecayConfig>;
  /** @default 7 (Miller's number) */
  workingMemoryCapacity?: number;
  tokenBudget?: Partial<MemoryBudgetAllocation>;

  // --- Batch 2 (optional, no-op when absent) ---
  observer?: Partial<ObserverConfig>;
  reflector?: Partial<ReflectorConfig>;
  graph?: Partial<MemoryGraphConfig>;
  consolidation?: Partial<ConsolidationConfig>;

  // --- Cognitive Mechanisms (optional, no-op when absent) ---
  /** Optional per-mechanism cognitive science extensions (reconsolidation, RIF, FOK, etc.). */
  cognitiveMechanisms?: import('./mechanisms/types.js').CognitiveMechanismsConfig;

  // --- Batch 3: Infinite Context (optional, no-op when absent) ---
  /** Infinite context window config. Enables transparent compaction for forever conversations. */
  infiniteContext?: Partial<InfiniteContextConfig>;
  /** Max context window size in tokens (required for infinite context). */
  maxContextTokens?: number;

  // --- Vector store collection prefix ---
  /** @default 'cogmem' */
  collectionPrefix?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ENCODING_CONFIG: EncodingConfig = {
  baseStrength: 0.5,
  flashbulbThreshold: 0.8,
  flashbulbStrengthMultiplier: 2.0,
  flashbulbStabilityMultiplier: 5.0,
  baseStabilityMs: 3_600_000,
};

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  pruningThreshold: 0.05,
  recencyHalfLifeMs: 86_400_000,
  interferenceThreshold: 0.7,
};

export const DEFAULT_BUDGET_ALLOCATION: MemoryBudgetAllocation = {
  workingMemory: 0.15,
  semanticRecall: 0.40,
  recentEpisodic: 0.25,
  prospectiveAlerts: 0.05,
  graphAssociations: 0.05,
  observationNotes: 0.05,
  persistentMemory: 0.05,
};
