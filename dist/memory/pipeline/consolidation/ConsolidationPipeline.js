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
import { DEFAULT_DECAY_CONFIG } from '../../core/config.js';
import { findPrunableTraces } from '../../core/decay/DecayModel.js';
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_CONSOLIDATION = {
    intervalMs: 3600000,
    maxTracesPerCycle: 500,
    mergeSimilarityThreshold: 0.92,
    minClusterSize: 5,
    // Facade-level lifecycle extensions — defaults match ExtendedConsolidationConfig.
    trigger: 'interval',
    every: 3600000,
    pruneThreshold: 0.05,
    mergeThreshold: 0.92,
    deriveInsights: true,
    maxDerivedPerCycle: 10,
};
// ---------------------------------------------------------------------------
// ConsolidationPipeline
// ---------------------------------------------------------------------------
export class ConsolidationPipeline {
    constructor(config) {
        this.timer = null;
        this.lastRunAt = 0;
        this.config = config;
        this.consolidationConfig = {
            ...DEFAULT_CONSOLIDATION,
            ...config.consolidation,
        };
        this.decayConfig = { ...DEFAULT_DECAY_CONFIG, ...config.decay };
    }
    /**
     * Start the periodic consolidation timer.
     */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => { void this.run(); }, this.consolidationConfig.intervalMs);
    }
    /**
     * Stop the periodic consolidation timer.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /**
     * Run a single consolidation cycle.
     */
    async run() {
        const startTime = Date.now();
        const result = {
            prunedCount: 0,
            edgesCreated: 0,
            schemasCreated: 0,
            conflictsResolved: 0,
            reinforcedCount: 0,
            totalProcessed: 0,
            durationMs: 0,
            archivedPruned: 0,
        };
        const now = Date.now();
        // Gather traces from the store (scope: user for this agent)
        const traces = await this.config.store.getByScope('user', this.config.agentId);
        const batch = traces.slice(0, this.consolidationConfig.maxTracesPerCycle);
        result.totalProcessed = batch.length;
        // --- Step 1: Decay sweep ---
        result.prunedCount = await this.decaySweep(batch, now);
        // --- Step 2: Co-activation replay ---
        if (this.config.graph) {
            result.edgesCreated = await this.replayCoActivation(batch, now);
        }
        // --- Step 3: Schema integration ---
        if (this.config.graph && this.config.llmInvoker) {
            result.schemasCreated = await this.schemaIntegration();
        }
        // --- Step 4: Conflict resolution ---
        if (this.config.graph) {
            result.conflictsResolved = await this.resolveConflicts(batch);
        }
        // --- Step 5: Spaced repetition reinforcement ---
        result.reinforcedCount = await this.spacedRepetitionSweep(batch, now);
        // --- Step 6: Cognitive mechanisms (temporal gist, source decay, emotion regulation) ---
        if (this.config.mechanismsEngine) {
            const llmFn = this.config.llmInvoker
                ? (prompt) => this.config.llmInvoker('You are a memory consolidation assistant.', prompt)
                : undefined;
            await this.config.mechanismsEngine.onConsolidation(batch, llmFn);
        }
        // --- Step 7: Prune archive (retention sweep with access-log awareness) ---
        result.archivedPruned = 0;
        if (this.config.archive) {
            const maxAgeMs = this.config.archiveRetention?.maxAgeMs ?? 365 * 86400000;
            const candidates = await this.config.archive.list({ olderThanMs: maxAgeMs });
            for (const candidate of candidates) {
                // Skip traces that were recently rehydrated — they're still in active use
                const lastAccess = await this.config.archive.lastAccessedAt(candidate.traceId);
                if (lastAccess !== null && (Date.now() - lastAccess) < maxAgeMs) {
                    continue;
                }
                await this.config.archive.drop(candidate.traceId);
                result.archivedPruned++;
            }
        }
        result.durationMs = Date.now() - startTime;
        this.lastRunAt = now;
        return result;
    }
    /** Get timestamp of last consolidation run. */
    getLastRunAt() {
        return this.lastRunAt;
    }
    // =========================================================================
    // Step 1: Decay sweep
    // =========================================================================
    async decaySweep(traces, now) {
        const prunable = findPrunableTraces(traces, now, this.decayConfig);
        for (const traceId of prunable) {
            await this.config.store.softDelete(traceId);
        }
        return prunable.length;
    }
    // =========================================================================
    // Step 2: Co-activation replay
    // =========================================================================
    async replayCoActivation(traces, now) {
        if (!this.config.graph)
            return 0;
        let edgesCreated = 0;
        const recentTraces = traces.filter((t) => t.isActive && (now - t.createdAt) < 86400000);
        // Find traces that share entities → create SHARED_ENTITY edges
        const entityIndex = new Map();
        for (const trace of recentTraces) {
            for (const entity of trace.entities) {
                const list = entityIndex.get(entity) ?? [];
                list.push(trace.id);
                entityIndex.set(entity, list);
            }
        }
        for (const [, traceIds] of entityIndex) {
            if (traceIds.length < 2)
                continue;
            for (let i = 0; i < traceIds.length && i < 10; i++) {
                for (let j = i + 1; j < traceIds.length && j < 10; j++) {
                    if (this.config.graph.hasNode(traceIds[i]) && this.config.graph.hasNode(traceIds[j])) {
                        await this.config.graph.addEdge({
                            sourceId: traceIds[i],
                            targetId: traceIds[j],
                            type: 'SHARED_ENTITY',
                            weight: 0.5,
                            createdAt: now,
                        });
                        edgesCreated++;
                    }
                }
            }
        }
        // Find temporally adjacent traces → create TEMPORAL_SEQUENCE edges
        const sorted = [...recentTraces].sort((a, b) => a.createdAt - b.createdAt);
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].createdAt - sorted[i].createdAt;
            if (gap < 300000) { // Within 5 minutes
                if (this.config.graph.hasNode(sorted[i].id) && this.config.graph.hasNode(sorted[i + 1].id)) {
                    await this.config.graph.addEdge({
                        sourceId: sorted[i].id,
                        targetId: sorted[i + 1].id,
                        type: 'TEMPORAL_SEQUENCE',
                        weight: 0.3,
                        createdAt: now,
                    });
                    edgesCreated++;
                }
            }
        }
        return edgesCreated;
    }
    // =========================================================================
    // Step 3: Schema integration
    // =========================================================================
    async schemaIntegration() {
        if (!this.config.graph || !this.config.llmInvoker)
            return 0;
        const clusters = await this.config.graph.detectClusters(this.consolidationConfig.minClusterSize);
        let schemasCreated = 0;
        for (const cluster of clusters) {
            // Gather content from cluster members
            const contents = [];
            for (const id of cluster.memberIds) {
                const trace = this.config.store.getTrace(id);
                if (trace)
                    contents.push(trace.content);
            }
            if (contents.length < this.consolidationConfig.minClusterSize)
                continue;
            try {
                const summary = await this.config.llmInvoker('Summarize the following related memories into a single semantic knowledge statement. Be concise (1-2 sentences). Output only the summary.', contents.join('\n---\n'));
                if (summary.trim()) {
                    // Store as a new semantic trace
                    const now = Date.now();
                    const schemaTrace = {
                        id: `schema_${now}_${schemasCreated}`,
                        type: 'semantic',
                        scope: 'user',
                        scopeId: this.config.agentId,
                        content: summary.trim(),
                        entities: [],
                        tags: ['schema', 'consolidated'],
                        provenance: {
                            sourceType: 'reflection',
                            sourceTimestamp: now,
                            confidence: 0.8,
                            verificationCount: cluster.memberIds.length,
                        },
                        emotionalContext: { valence: 0, arousal: 0, dominance: 0, intensity: 0, gmiMood: '' },
                        encodingStrength: 0.7,
                        stability: 7200000, // 2 hours (schemas are more stable)
                        retrievalCount: 0,
                        lastAccessedAt: now,
                        accessCount: 0,
                        reinforcementInterval: 7200000,
                        associatedTraceIds: cluster.memberIds,
                        createdAt: now,
                        updatedAt: now,
                        consolidatedAt: now,
                        isActive: true,
                    };
                    await this.config.store.store(schemaTrace);
                    // Add SCHEMA_INSTANCE edges from cluster members to schema
                    if (this.config.graph) {
                        await this.config.graph.addNode(schemaTrace.id, {
                            type: 'semantic',
                            scope: 'user',
                            scopeId: this.config.agentId,
                            strength: 0.7,
                            createdAt: now,
                        });
                        for (const memberId of cluster.memberIds) {
                            if (this.config.graph.hasNode(memberId)) {
                                await this.config.graph.addEdge({
                                    sourceId: memberId,
                                    targetId: schemaTrace.id,
                                    type: 'SCHEMA_INSTANCE',
                                    weight: 0.6,
                                    createdAt: now,
                                });
                            }
                        }
                    }
                    schemasCreated++;
                }
            }
            catch {
                // LLM failure is non-critical
            }
        }
        return schemasCreated;
    }
    // =========================================================================
    // Step 4: Conflict resolution
    // =========================================================================
    async resolveConflicts(traces) {
        if (!this.config.graph)
            return 0;
        const clamp = (v) => v == null ? 0.5 : Math.max(0, Math.min(1, v));
        const honesty = clamp(this.config.traits.honesty);
        let resolved = 0;
        for (const trace of traces) {
            if (!trace.isActive)
                continue;
            const conflicts = this.config.graph.getConflicts(trace.id);
            for (const conflict of conflicts) {
                const otherId = conflict.sourceId === trace.id ? conflict.targetId : conflict.sourceId;
                const other = this.config.store.getTrace(otherId);
                if (!other || !other.isActive)
                    continue;
                // Determine which trace to keep
                if (honesty > 0.6) {
                    // High honesty: prefer newer information
                    const loser = trace.createdAt > other.createdAt ? other : trace;
                    await this.config.store.softDelete(loser.id);
                    resolved++;
                }
                else {
                    // Default: prefer higher confidence
                    if (Math.abs(trace.provenance.confidence - other.provenance.confidence) > 0.2) {
                        const loser = trace.provenance.confidence < other.provenance.confidence ? trace : other;
                        await this.config.store.softDelete(loser.id);
                        resolved++;
                    }
                    // If confidence is similar, let both coexist
                }
            }
        }
        return resolved;
    }
    // =========================================================================
    // Step 5: Spaced repetition sweep
    // =========================================================================
    async spacedRepetitionSweep(traces, now) {
        let reinforced = 0;
        for (const trace of traces) {
            if (!trace.isActive)
                continue;
            if (!trace.nextReinforcementAt)
                continue;
            if (now < trace.nextReinforcementAt)
                continue;
            // Boost the trace via recordAccess
            await this.config.store.recordAccess(trace.id);
            reinforced++;
        }
        return reinforced;
    }
}
//# sourceMappingURL=ConsolidationPipeline.js.map