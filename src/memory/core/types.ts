/**
 * @fileoverview Core types for the Cognitive Memory System.
 *
 * Grounded in cognitive science models:
 * - Atkinson-Shiffrin (sensory → STM → LTM)
 * - Baddeley's working memory (slot-based, capacity-limited)
 * - Tulving's LTM taxonomy (episodic vs semantic)
 * - Ebbinghaus forgetting curve (strength decay over time)
 * - PAD emotional model (valence/arousal/dominance tagging)
 *
 * @module agentos/memory/types
 */

// ---------------------------------------------------------------------------
// Memory classification
// ---------------------------------------------------------------------------

/** Long-term memory subtypes (Tulving's taxonomy + extensions). */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'prospective';

/** Visibility / ownership scope for a memory trace. */
export type MemoryScope = 'thread' | 'user' | 'persona' | 'organization';

/** How the content of this memory was originally produced. */
export type MemorySourceType =
  | 'user_statement'
  | 'agent_inference'
  | 'tool_result'
  | 'observation'
  | 'reflection'
  | 'external';

// ---------------------------------------------------------------------------
// Provenance (source monitoring — prevents confabulation)
// ---------------------------------------------------------------------------

export interface MemoryProvenance {
  sourceType: MemorySourceType;
  /** Back-reference to originating conversation, tool call, etc. */
  sourceId?: string;
  /** Timestamp of the original source information. */
  sourceTimestamp: number;
  /** 0-1 confidence we have in this memory's accuracy. */
  confidence: number;
  /** How many times this memory has been externally confirmed. */
  verificationCount: number;
  lastVerifiedAt?: number;
  /** IDs of other traces that contradict this one. */
  contradictedBy?: string[];
}

// ---------------------------------------------------------------------------
// Emotional context (PAD model snapshot at encoding time)
// ---------------------------------------------------------------------------

export interface EmotionalContext {
  /** Pleasure / valence dimension, -1 (negative) to 1 (positive). */
  valence: number;
  /** Arousal dimension, 0 (calm) to 1 (excited). */
  arousal: number;
  /** Dominance dimension, -1 (submissive) to 1 (dominant). */
  dominance: number;
  /** Derived emotional intensity: |valence| * arousal. */
  intensity: number;
  /** GMIMood enum string at encoding time. */
  gmiMood: string;
}

// ---------------------------------------------------------------------------
// Content feature classification
// ---------------------------------------------------------------------------

export interface ContentFeatures {
  hasNovelty: boolean;
  hasProcedure: boolean;
  hasEmotion: boolean;
  hasSocialContent: boolean;
  hasCooperation: boolean;
  hasEthicalContent: boolean;
  hasContradiction: boolean;
  /** 0-1 relevance to current task / active goal. */
  topicRelevance: number;
}

// ---------------------------------------------------------------------------
// The universal memory envelope
// ---------------------------------------------------------------------------

export interface MemoryTrace {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  scopeId: string;

  // --- Content ---
  content: string;
  structuredData?: Record<string, unknown>;
  entities: string[];
  tags: string[];

  // --- Provenance ---
  provenance: MemoryProvenance;

  // --- Emotional context ---
  emotionalContext: EmotionalContext;

  // --- Ebbinghaus decay model ---
  /** S_0: initial encoding strength, set at creation. */
  encodingStrength: number;
  /** Time constant (ms); grows with each successful retrieval. */
  stability: number;
  /** Number of times this trace has been successfully retrieved. */
  retrievalCount: number;
  /** Unix ms of last retrieval. */
  lastAccessedAt: number;
  /** Total access count (includes non-retrieval touches). */
  accessCount: number;

  // --- Spaced repetition ---
  /** Current interval (ms); doubles on each successful recall. */
  reinforcementInterval: number;
  /** When this memory is next due for reinforcement review. */
  nextReinforcementAt?: number;

  // --- Graph linkage ---
  associatedTraceIds: string[];

  // --- Lifecycle ---
  createdAt: number;
  updatedAt: number;
  consolidatedAt?: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Working memory slot (Baddeley's model)
// ---------------------------------------------------------------------------

export interface WorkingMemorySlot {
  slotId: string;
  /** Reference to the underlying MemoryTrace (or a transient key). */
  traceId: string;
  /** 0-1 activation level; determines if slot is "in focus". */
  activationLevel: number;
  /** When this trace entered working memory (Unix ms). */
  enteredAt: number;
  /** Maintenance rehearsal counter. */
  rehearsalCount: number;
  /** How much attention is allocated to this slot (0-1). */
  attentionWeight: number;
}

// ---------------------------------------------------------------------------
// Encoding weights (HEXACO → attention modulation)
// ---------------------------------------------------------------------------

export interface EncodingWeights {
  noveltyAttention: number;
  proceduralAttention: number;
  emotionalSensitivity: number;
  socialAttention: number;
  cooperativeAttention: number;
  ethicalAttention: number;
}

// ---------------------------------------------------------------------------
// Encoding result
// ---------------------------------------------------------------------------

export interface EncodingResult {
  initialStrength: number;
  stability: number;
  importance: number;
  isFlashbulb: boolean;
}

// ---------------------------------------------------------------------------
// Retrieval types
// ---------------------------------------------------------------------------

export interface CognitiveRetrievalOptions {
  topK?: number;
  types?: MemoryType[];
  scopes?: Array<{ scope: MemoryScope; scopeId: string }>;
  tags?: string[];
  entities?: string[];
  minConfidence?: number;
  timeRange?: { after?: number; before?: number };
  /** If true, skip emotional congruence bias (useful for factual lookups). */
  neutralMood?: boolean;
  /**
   * Enable HyDE (Hypothetical Document Embedding) for memory retrieval.
   *
   * When `true` and a HyDE retriever is configured on the memory manager,
   * the system generates a hypothetical memory trace matching the query
   * before embedding. This produces embeddings that are closer to actual
   * stored memories, improving recall — especially for vague or abstract
   * recall prompts (e.g. "that thing we discussed about deployment").
   *
   * Adds one LLM call per retrieval. Use for important lookups where
   * recall quality matters more than latency.
   *
   * @default false
   */
  hyde?: boolean;
}

export interface ScoredMemoryTrace extends MemoryTrace {
  /** Composite retrieval score (0-1). */
  retrievalScore: number;
  /** Individual score components for debugging. */
  scoreBreakdown: {
    strengthScore: number;
    similarityScore: number;
    recencyScore: number;
    emotionalCongruenceScore: number;
    graphActivationScore: number;
    importanceScore: number;
  };
}

export interface PartiallyRetrievedTrace {
  traceId: string;
  confidence: number;
  partialContent: string;
  suggestedCues: string[];
}

export interface CognitiveRetrievalResult {
  retrieved: ScoredMemoryTrace[];
  partiallyRetrieved: PartiallyRetrievedTrace[];
  diagnostics: {
    candidatesScanned: number;
    vectorSearchTimeMs: number;
    scoringTimeMs: number;
    totalTimeMs: number;
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly types
// ---------------------------------------------------------------------------

export interface MemoryBudgetAllocation {
  workingMemory: number;
  semanticRecall: number;
  recentEpisodic: number;
  prospectiveAlerts: number;
  graphAssociations: number;
  observationNotes: number;
  persistentMemory: number;
}

export interface AssembledMemoryContext {
  contextText: string;
  tokensUsed: number;
  allocation: MemoryBudgetAllocation;
  includedMemoryIds: string[];
}

// ---------------------------------------------------------------------------
// Health / diagnostics
// ---------------------------------------------------------------------------

export interface MemoryHealthReport {
  totalTraces: number;
  activeTraces: number;
  avgStrength: number;
  weakestTraceStrength: number;
  workingMemoryUtilization: number;
  lastConsolidationAt?: number;
  tracesPerType: Record<MemoryType, number>;
  tracesPerScope: Record<MemoryScope, number>;
}
