/**
 * @fileoverview Consolidation Pipeline — background memory maintenance.
 *
 * Runs periodically (default: hourly) to maintain memory health:
 * 1. Decay sweep — apply Ebbinghaus to all traces, soft-delete below threshold
 * 2. Replay — re-process recent traces, find co-activation patterns, create graph edges
 * 3. Schema integration — cluster episodic traces, LLM-summarize into semantic nodes
 * 4. Conflict resolution — scan CONTRADICTS edges, resolve by confidence + personality
 * 5. Spaced repetition — boost traces past nextReinforcementAt
 * 6. Hybrid feature re-classification — if hybrid strategy, re-run LLM on keyword-only traces
 *
 * @module agentos/memory/consolidation/ConsolidationPipeline
 */
import type { ConsolidationConfig, DecayConfig, HexacoTraits } from '../../core/config.js';
import type { IMemoryGraph } from '../../retrieval/graph/IMemoryGraph.js';
import type { MemoryStore } from '../../retrieval/store/MemoryStore.js';
export interface ConsolidationResult {
    /** Traces pruned (soft-deleted). */
    prunedCount: number;
    /** Co-activation edges created. */
    edgesCreated: number;
    /** Schema nodes created from episodic clusters. */
    schemasCreated: number;
    /** Conflicts resolved. */
    conflictsResolved: number;
    /** Traces reinforced via spaced repetition. */
    reinforcedCount: number;
    /** Total traces processed. */
    totalProcessed: number;
    /** Duration in ms. */
    durationMs: number;
    /** Archived traces dropped by retention sweep. */
    archivedPruned: number;
}
export interface ConsolidationPipelineConfig {
    store: MemoryStore;
    graph?: IMemoryGraph;
    traits: HexacoTraits;
    agentId: string;
    decay?: Partial<DecayConfig>;
    consolidation?: Partial<ConsolidationConfig>;
    /** LLM invoker for schema integration (optional). */
    llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
    /** Optional cognitive mechanisms engine for consolidation-time hooks. */
    mechanismsEngine?: import('../../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;
    /** Optional memory archive for retention sweep (step 7). */
    archive?: import('../../archive/IMemoryArchive.js').IMemoryArchive;
    /** Retention configuration for the archive sweep. */
    archiveRetention?: import('../../archive/IMemoryArchive.js').MemoryArchiveRetentionConfig;
}
export declare class ConsolidationPipeline {
    private config;
    private consolidationConfig;
    private decayConfig;
    private timer;
    private lastRunAt;
    constructor(config: ConsolidationPipelineConfig);
    /**
     * Start the periodic consolidation timer.
     *
     * The timer is `.unref()`'d so it does NOT keep the Node event loop
     * alive on its own. Long-running agents keep the process alive
     * through their own mechanisms (HTTP server, message bus, etc.);
     * short-lived contexts (benches, scripts) can exit cleanly once
     * their meaningful work completes. Callers that need a guaranteed
     * consolidation cycle before shutdown should call `runConsolidation()`
     * directly or trigger it via {@link CognitiveMemoryManager.runConsolidation}.
     */
    start(): void;
    /**
     * Stop the periodic consolidation timer.
     */
    stop(): void;
    /**
     * Run a single consolidation cycle.
     */
    run(): Promise<ConsolidationResult>;
    /** Get timestamp of last consolidation run. */
    getLastRunAt(): number;
    private decaySweep;
    private replayCoActivation;
    private schemaIntegration;
    private resolveConflicts;
    private spacedRepetitionSweep;
}
//# sourceMappingURL=ConsolidationPipeline.d.ts.map