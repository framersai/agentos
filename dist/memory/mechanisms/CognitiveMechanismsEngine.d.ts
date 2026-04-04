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
import type { CognitiveMechanismsConfig, ResolvedMechanismsConfig, MetacognitiveSignal } from './types.js';
import type { MemoryTrace, ScoredMemoryTrace } from '../core/types.js';
import type { PADState, HexacoTraits } from '../core/config.js';
import type { CandidateTrace } from '../core/decay/RetrievalPriorityScorer.js';
import { type PersonalityDriftProposal } from './PersonaDriftMechanism.js';
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
export declare class CognitiveMechanismsEngine {
    private readonly cfg;
    private readonly hexaco?;
    private readonly personaDriftCfg;
    /** Lazily populated cluster centroids for schema encoding. */
    private clusterCentroids;
    constructor(config: CognitiveMechanismsConfig, traits?: HexacoTraits);
    /**
     * Called by MemoryStore.recordAccess().
     * Applies reconsolidation drift to the trace's emotional context.
     */
    onAccess(trace: MemoryTrace, currentMood: PADState): void;
    /**
     * Called by MemoryStore.query() after scoring.
     * Applies retrieval-induced forgetting to competitors and detects FOK signals.
     *
     * @returns Suppressed trace IDs and metacognitive signals.
     */
    onRetrieval(results: ScoredMemoryTrace[], allCandidates: CandidateTrace[], retrievalCutoff: number, queryEntities: string[]): {
        suppressedIds: string[];
        metacognitiveSignals: MetacognitiveSignal[];
    };
    /**
     * Called by EncodingModel.encode().
     * Classifies the trace as schema-congruent or schema-violating and adjusts
     * encoding strength accordingly.
     */
    onEncoding(trace: MemoryTrace, traceEmbedding: number[]): void;
    /**
     * Called by ConsolidationLoop.run() after step 5 (compact).
     * Runs temporal gist, source confidence decay, and emotion regulation.
     */
    onConsolidation(traces: MemoryTrace[], llmFn?: (prompt: string) => Promise<string>): Promise<{
        gistedCount: number;
        sourceDecayedCount: number;
        regulatedCount: number;
        driftProposals: PersonalityDriftProposal[];
    }>;
    /**
     * Called by MemoryPromptAssembler.
     * May inject an involuntary recall memory into the assembled context.
     */
    onPromptAssembly(allTraces: MemoryTrace[], retrievedIds: Set<string>): {
        involuntaryMemory: MemoryTrace | null;
    };
    /** Update cluster centroids (called after consolidation derive step). */
    setClusterCentroids(centroids: Map<string, number[]>): void;
    /** Get resolved config for diagnostics. */
    getConfig(): ResolvedMechanismsConfig;
}
//# sourceMappingURL=CognitiveMechanismsEngine.d.ts.map