/**
 * @fileoverview CognitiveMechanismsEngine — lifecycle hook orchestrator.
 *
 * Instantiates and delegates to 8 cognitive mechanisms across 5 lifecycle
 * hooks: onAccess, onRetrieval, onEncoding, onConsolidation, onPromptAssembly.
 *
 * Cognitive science mechanisms:
 * - **Reconsolidation** (Nader, Schafe & Le Doux, 2000)
 * - **Retrieval-Induced Forgetting** (Anderson, Bjork & Bjork, 1994)
 * - **Involuntary Recall** (Berntsen, 2009)
 * - **Metacognitive FOK** (Nelson & Narens, 1990; Hart, 1965; Koriat, 1993)
 * - **Temporal Gist** (Reyna & Brainerd, 1995)
 * - **Schema Encoding** (Bartlett, 1932; Ghosh & Gilboa, 2014; Tse et al., 2007)
 * - **Source Confidence Decay** (Johnson, Hashtroudi & Lindsay, 1993)
 * - **Emotion Regulation** (Gross, 1998, 2015)
 *
 * @module agentos/memory/mechanisms/CognitiveMechanismsEngine
 */

import type {
  CognitiveMechanismsConfig,
  ResolvedMechanismsConfig,
  MetacognitiveSignal,
} from './types.js';
import type { MemoryTrace, ScoredMemoryTrace, AssembledMemoryContext } from '../core/types.js';
import type { PADState, HexacoTraits } from '../core/config.js';
import type { CandidateTrace } from '../core/decay/RetrievalPriorityScorer.js';
import { resolveConfig } from './defaults.js';
import { applyReconsolidation } from './retrieval/Reconsolidation.js';
import { applyRetrievalInducedForgetting } from './retrieval/RetrievalInducedForgetting.js';
import { selectInvoluntaryMemory } from './retrieval/InvoluntaryRecall.js';
import { detectFeelingOfKnowing } from './retrieval/MetacognitiveFOK.js';
import { applyTemporalGist } from './consolidation/TemporalGist.js';
import { applySchemaEncoding } from './consolidation/SchemaEncoding.js';
import { applySourceConfidenceDecay } from './consolidation/SourceConfidenceDecay.js';
import { applyEmotionRegulation } from './consolidation/EmotionRegulation.js';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HEXACO → mechanism modulation
// ---------------------------------------------------------------------------

const clamp01 = (v: number | undefined): number =>
  v == null ? 0.5 : Math.max(0, Math.min(1, v));

/**
 * Compute personality-modulated mechanism parameters from HEXACO traits.
 *
 * Cognitive science rationale for each mapping:
 * - **Emotionality → reconsolidation drift**: High-emotionality agents
 *   experience stronger emotional reconsolidation (broader mood influence
 *   on memory recall). Scales driftRate by 0.5 + E×1.0 (range 0.5x–1.5x).
 * - **Conscientiousness → RIF suppression**: High-conscientiousness agents
 *   are more focused retrievers, producing stronger competitor suppression.
 *   Scales suppressionFactor by 0.7 + C×0.6 (range 0.7x–1.3x).
 * - **Openness → involuntary recall**: High-openness agents are more
 *   receptive to spontaneous associations and unbidden memories.
 *   Scales probability by 0.5 + O×1.0 (range 0.5x–1.5x).
 * - **Honesty → source confidence decay**: High-honesty agents are more
 *   critical of self-generated content, applying stronger source decay
 *   to inferences/reflections. Scales reflection multiplier down by H×0.15.
 * - **Agreeableness → emotion regulation**: High-agreeableness agents
 *   regulate emotional memories more actively (social harmony motive).
 *   Scales reappraisalRate by 0.7 + A×0.6 (range 0.7x–1.3x).
 * - **Extraversion → FOK surfacing**: High-extraversion agents are more
 *   willing to surface partial/uncertain memories (social disclosure).
 *   Scales partialActivationThreshold down (lower = more signals).
 */
function applyPersonalityModulation(
  cfg: ResolvedMechanismsConfig,
  traits?: HexacoTraits,
): ResolvedMechanismsConfig {
  if (!traits) return cfg;

  const e = clamp01(traits.emotionality);
  const c = clamp01(traits.conscientiousness);
  const o = clamp01(traits.openness);
  const h = clamp01(traits.honesty);
  const a = clamp01(traits.agreeableness);
  const x = clamp01(traits.extraversion);

  return {
    reconsolidation: {
      ...cfg.reconsolidation,
      driftRate: cfg.reconsolidation.driftRate * (0.5 + e * 1.0),
    },
    retrievalInducedForgetting: {
      ...cfg.retrievalInducedForgetting,
      suppressionFactor: cfg.retrievalInducedForgetting.suppressionFactor * (0.7 + c * 0.6),
    },
    involuntaryRecall: {
      ...cfg.involuntaryRecall,
      probability: Math.min(1.0, cfg.involuntaryRecall.probability * (0.5 + o * 1.0)),
    },
    metacognitiveFOK: {
      ...cfg.metacognitiveFOK,
      // Higher extraversion → lower threshold → more TOT signals surfaced
      partialActivationThreshold: cfg.metacognitiveFOK.partialActivationThreshold * (1.3 - x * 0.6),
    },
    temporalGist: cfg.temporalGist, // not personality-modulated (cognitive, not dispositional)
    schemaEncoding: {
      ...cfg.schemaEncoding,
      // Higher openness → stronger novelty boost (more attention to schema violations)
      noveltyBoost: cfg.schemaEncoding.noveltyBoost * (0.8 + o * 0.4),
    },
    sourceConfidenceDecay: {
      ...cfg.sourceConfidenceDecay,
      decayMultipliers: {
        ...cfg.sourceConfidenceDecay.decayMultipliers,
        // Higher honesty → more skeptical of own inferences and reflections
        agent_inference: Math.max(0.5, cfg.sourceConfidenceDecay.decayMultipliers.agent_inference - h * 0.15),
        reflection: Math.max(0.4, cfg.sourceConfidenceDecay.decayMultipliers.reflection - h * 0.15),
      },
    },
    emotionRegulation: {
      ...cfg.emotionRegulation,
      reappraisalRate: cfg.emotionRegulation.reappraisalRate * (0.7 + a * 0.6),
    },
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Orchestrates 8 cognitive mechanisms across the memory pipeline lifecycle.
 *
 * When `cognitiveMechanisms` config is present on `CognitiveMemoryConfig`,
 * an instance is created during initialization. Existing pipeline files
 * call the lifecycle hooks at the appropriate points.
 *
 * If HEXACO traits are provided, mechanism parameters are personality-modulated:
 * emotionality → reconsolidation drift, conscientiousness → RIF strength,
 * openness → involuntary recall probability + novelty boost, honesty → source
 * skepticism, agreeableness → emotion regulation, extraversion → FOK surfacing.
 */
export class CognitiveMechanismsEngine {
  private readonly cfg: ResolvedMechanismsConfig;

  /** Lazily populated cluster centroids for schema encoding. */
  private clusterCentroids: Map<string, number[]> = new Map();

  constructor(config: CognitiveMechanismsConfig, traits?: HexacoTraits) {
    this.cfg = applyPersonalityModulation(resolveConfig(config), traits);
  }

  // =========================================================================
  // Lifecycle hooks
  // =========================================================================

  /**
   * Called by MemoryStore.recordAccess().
   * Applies reconsolidation drift to the trace's emotional context.
   */
  onAccess(trace: MemoryTrace, currentMood: PADState): void {
    applyReconsolidation(trace, currentMood, this.cfg.reconsolidation);
  }

  /**
   * Called by MemoryStore.query() after scoring.
   * Applies retrieval-induced forgetting to competitors and detects FOK signals.
   *
   * @returns Suppressed trace IDs and metacognitive signals.
   */
  onRetrieval(
    results: ScoredMemoryTrace[],
    allCandidates: CandidateTrace[],
    retrievalCutoff: number,
    queryEntities: string[],
  ): { suppressedIds: string[]; metacognitiveSignals: MetacognitiveSignal[] } {
    // RIF: competitors are candidates that didn't make the result set
    const resultIds = new Set(results.map((r) => r.id));
    const competitors = allCandidates
      .filter((c) => !resultIds.has(c.trace.id))
      .map((c) => c.trace);

    const { suppressedIds } = applyRetrievalInducedForgetting(
      results,
      competitors,
      this.cfg.retrievalInducedForgetting,
    );

    // FOK: detect partially activated traces
    // Build approximate ScoredMemoryTrace for non-retrieved candidates
    const allScored: ScoredMemoryTrace[] = allCandidates.map((c) => {
      const existing = results.find((r) => r.id === c.trace.id);
      if (existing) return existing;
      return {
        ...c.trace,
        retrievalScore: c.vectorSimilarity * 0.35, // approximate composite
        scoreBreakdown: {
          strengthScore: 0,
          similarityScore: c.vectorSimilarity,
          recencyScore: 0,
          emotionalCongruenceScore: 0,
          graphActivationScore: 0,
          importanceScore: 0,
        },
      };
    });

    const metacognitiveSignals = detectFeelingOfKnowing(
      allScored,
      retrievalCutoff,
      this.cfg.metacognitiveFOK,
      queryEntities,
    );

    return { suppressedIds, metacognitiveSignals };
  }

  /**
   * Called by EncodingModel.encode().
   * Classifies the trace as schema-congruent or schema-violating and adjusts
   * encoding strength accordingly.
   */
  onEncoding(
    trace: MemoryTrace,
    traceEmbedding: number[],
  ): void {
    if (this.clusterCentroids.size > 0) {
      applySchemaEncoding(trace, traceEmbedding, this.clusterCentroids, this.cfg.schemaEncoding);
    }
  }

  /**
   * Called by ConsolidationLoop.run() after step 5 (compact).
   * Runs temporal gist, source confidence decay, and emotion regulation.
   */
  async onConsolidation(
    traces: MemoryTrace[],
    llmFn?: (prompt: string) => Promise<string>,
  ): Promise<{ gistedCount: number; sourceDecayedCount: number; regulatedCount: number }> {
    const gistedCount = await applyTemporalGist(traces, this.cfg.temporalGist, llmFn);
    const sourceDecayedCount = applySourceConfidenceDecay(traces, this.cfg.sourceConfidenceDecay);
    const regulatedCount = applyEmotionRegulation(traces, this.cfg.emotionRegulation);
    return { gistedCount, sourceDecayedCount, regulatedCount };
  }

  /**
   * Called by MemoryPromptAssembler.
   * May inject an involuntary recall memory into the assembled context.
   */
  onPromptAssembly(
    allTraces: MemoryTrace[],
    retrievedIds: Set<string>,
  ): { involuntaryMemory: MemoryTrace | null } {
    const involuntaryMemory = selectInvoluntaryMemory(
      allTraces,
      retrievedIds,
      this.cfg.involuntaryRecall,
    );
    return { involuntaryMemory };
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /** Update cluster centroids (called after consolidation derive step). */
  setClusterCentroids(centroids: Map<string, number[]>): void {
    this.clusterCentroids = centroids;
  }

  /** Get resolved config for diagnostics. */
  getConfig(): ResolvedMechanismsConfig {
    return this.cfg;
  }
}
