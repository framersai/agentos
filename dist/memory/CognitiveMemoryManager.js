/**
 * @fileoverview Top-level orchestrator for the Cognitive Memory System.
 *
 * Ties together encoding, decay, working memory, store, prompt assembly,
 * and Batch 2 modules (observer, reflector, graph, prospective, consolidation).
 *
 * Batch 2 hooks activate automatically when the relevant config is provided.
 * They degrade gracefully (no-op) when modules are absent.
 *
 * @module agentos/memory/CognitiveMemoryManager
 */
import { uuid } from './core/util/crossPlatformCrypto.js';
import { DEFAULT_ENCODING_CONFIG, DEFAULT_DECAY_CONFIG, DEFAULT_GRAPH_CONFIG, } from './core/config.js';
import { computeEncodingStrength, buildEmotionalContext } from './core/encoding/EncodingModel.js';
import { createFeatureDetector, } from './core/encoding/ContentFeatureDetector.js';
import { computeCurrentStrength } from './core/decay/DecayModel.js';
import { MemoryStore } from './retrieval/store/MemoryStore.js';
import { CognitiveWorkingMemory } from './core/working/CognitiveWorkingMemory.js';
import { assembleMemoryContext, } from './core/prompt/MemoryPromptAssembler.js';
import { GraphologyMemoryGraph } from './retrieval/graph/GraphologyMemoryGraph.js';
import { KnowledgeGraphMemoryGraph } from './retrieval/graph/KnowledgeGraphMemoryGraph.js';
import { MemoryObserver } from './pipeline/observation/MemoryObserver.js';
import { MemoryReflector } from './pipeline/observation/MemoryReflector.js';
import { ProspectiveMemoryManager, } from './retrieval/prospective/ProspectiveMemoryManager.js';
import { ConsolidationPipeline, } from './pipeline/consolidation/ConsolidationPipeline.js';
// Batch 3: Infinite Context
import { ContextWindowManager } from './pipeline/context/ContextWindowManager.js';
import { evaluateRetrievalConfidence, resolveMemoryRetrievalPolicy, } from '../rag/unified/index.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Generate a globally unique trace ID.
 * Previous implementation used a monotonic counter (`mt_{timestamp}_{counter}`)
 * which could collide across multiple processes or rapid restarts.
 */
function generateTraceId() {
    return `mt_${uuid()}`;
}
export class CognitiveMemoryManager {
    constructor() {
        this.initialized = false;
        // Batch 2 modules (optional)
        this.graph = null;
        this.observer = null;
        this.reflector = null;
        this.prospective = null;
        this.consolidation = null;
        // Batch 3: Infinite Context (optional)
        this.contextWindow = null;
        // Cognitive Mechanisms (optional)
        this.mechanismsEngine = null;
        // Optional neural reranker for post-retrieval quality improvement
        this.rerankerService = null;
        // Memory archive for write-ahead verbatim preservation
        this.archive = null;
        /**
         * Optional HyDE retriever for hypothesis-driven memory recall.
         *
         * When set and `options.hyde` is `true` on a `retrieve()` call, the manager
         * generates a hypothetical memory trace via LLM and uses that text for the
         * embedding-based memory search. This improves recall for vague or abstract
         * queries (e.g. "that deployment discussion last week").
         */
        this.hydeRetriever = null;
    }
    async initialize(config) {
        this.config = config;
        // Cognitive Mechanisms (optional — dynamic import to avoid loading when unused)
        if (config.cognitiveMechanisms) {
            const { CognitiveMechanismsEngine } = await import('./mechanisms/CognitiveMechanismsEngine.js');
            this.mechanismsEngine = new CognitiveMechanismsEngine(config.cognitiveMechanisms, config.traits);
        }
        // Memory store — in-memory vector index for fast reads, with optional
        // SqliteBrain write-through for durable persistence across restarts.
        this.store = new MemoryStore({
            vectorStore: config.vectorStore,
            embeddingManager: config.embeddingManager,
            knowledgeGraph: config.knowledgeGraph,
            collectionPrefix: config.collectionPrefix ?? 'cogmem',
            decayConfig: config.decay ? { ...DEFAULT_DECAY_CONFIG, ...config.decay } : undefined,
            mechanismsEngine: this.mechanismsEngine ?? undefined,
            moodProvider: config.moodProvider,
        });
        // Attach SqliteBrain for durable write-through when configured.
        // All store/softDelete/recordAccess operations mirror to SQL.
        if (config.brain) {
            this.store.setBrain(config.brain);
        }
        // Optional neural reranker for post-retrieval quality improvement
        if (config.rerankerService) {
            this.rerankerService = config.rerankerService;
        }
        // Cognitive working memory (wraps the existing IWorkingMemory)
        this.workingMemory = new CognitiveWorkingMemory(config.workingMemory, {
            baseCapacity: config.workingMemoryCapacity ?? 7,
            traits: config.traits,
            activationDecayRate: 0.1,
            minActivation: 0.15,
            onEvict: async (_slotId, traceId) => {
                const trace = this.store.getTrace(traceId);
                if (trace && !trace.isActive) {
                    trace.isActive = true;
                }
            },
        });
        // Feature detector
        this.featureDetector = createFeatureDetector(config.featureDetectionStrategy, config.featureDetectionLlmInvoker);
        // --- Memory Graph (enabled by default, opt-out via disabled: true) ---
        // The knowledge graph powers spreading activation (Collins & Quillian model),
        // Hebbian co-activation learning ("neurons that fire together wire together"),
        // and graph-boosted retrieval scoring. It is fundamental to associative memory.
        if (config.graph?.disabled !== true) {
            const graphConfig = { ...DEFAULT_GRAPH_CONFIG, ...config.graph };
            const backend = graphConfig.backend;
            if (backend === 'graphology') {
                this.graph = new GraphologyMemoryGraph();
            }
            else {
                this.graph = new KnowledgeGraphMemoryGraph(config.knowledgeGraph);
            }
            await this.graph.initialize();
        }
        // --- Batch 2: Observer ---
        if (config.observer?.llmInvoker) {
            this.observer = new MemoryObserver(config.traits, config.observer);
        }
        // --- Batch 2: Reflector ---
        if (config.reflector?.llmInvoker) {
            this.reflector = new MemoryReflector(config.traits, config.reflector);
        }
        // --- Batch 2: Prospective Memory ---
        this.prospective = new ProspectiveMemoryManager(config.embeddingManager);
        // --- Batch 2: Consolidation Pipeline ---
        // We construct the pipeline whenever consolidation config is
        // supplied OR a graph is present (so `runConsolidation()` is
        // always callable on-demand). The auto-started periodic timer is
        // only armed when `config.consolidation.enabled !== false`.
        // Short-lived contexts (bench runs, tests, one-shot scripts) can
        // suppress the timer by passing `{ enabled: false }` so they
        // don't leak setInterval handles that keep the Node event loop
        // alive past the meaningful work.
        if (config.consolidation || this.graph) {
            this.consolidation = new ConsolidationPipeline({
                store: this.store,
                graph: this.graph ?? undefined,
                traits: config.traits,
                agentId: config.agentId,
                decay: config.decay,
                consolidation: config.consolidation,
                llmInvoker: config.reflector?.llmInvoker ?? config.featureDetectionLlmInvoker,
                mechanismsEngine: this.mechanismsEngine ?? undefined,
            });
            if (config.consolidation?.enabled !== false) {
                this.consolidation.start();
            }
        }
        // --- Batch 3: Infinite Context Window ---
        if (config.infiniteContext?.enabled && config.maxContextTokens) {
            const llmInvoker = config.infiniteContext.llmInvoker
                ?? config.reflector?.llmInvoker
                ?? config.observer?.llmInvoker
                ?? config.featureDetectionLlmInvoker;
            if (llmInvoker) {
                // Wrap the (system, user) invoker into a single-prompt invoker.
                const singlePromptInvoker = (prompt) => llmInvoker('You are a conversation summarizer.', prompt);
                this.contextWindow = new ContextWindowManager({
                    maxContextTokens: config.maxContextTokens,
                    infiniteContext: config.infiniteContext,
                    llmInvoker: singlePromptInvoker,
                    observer: this.observer ?? undefined,
                    reflector: this.reflector ?? undefined,
                    onTracesCreated: async (traces) => {
                        for (const partial of traces) {
                            if (partial.content) {
                                const mood = config.moodProvider();
                                await this.encode(partial.content, mood, 'neutral', {
                                    type: partial.type ?? 'semantic',
                                    scope: partial.scope ?? 'user',
                                    sourceType: 'reflection',
                                    tags: partial.tags,
                                    entities: partial.entities,
                                });
                            }
                        }
                    },
                });
            }
        }
        // --- HyDE Retriever (auto-attached when any LLM invoker is available) ---
        // Generates hypothetical memory traces for improved recall on vague queries.
        // Opt-in per query via retrieve({ hyde: true }). Based on the "generation
        // effect" — generating what a memory WOULD look like activates retrieval
        // pathways more effectively than raw query embedding.
        const anyLlmInvoker = config.reflector?.llmInvoker
            ?? config.observer?.llmInvoker
            ?? config.featureDetectionLlmInvoker;
        if (anyLlmInvoker && !this.hydeRetriever) {
            const { MemoryHydeRetriever } = await import('./retrieval/hyde/MemoryHydeRetriever.js');
            this.hydeRetriever = new MemoryHydeRetriever(anyLlmInvoker);
        }
        // --- Memory Archive ---
        if (config.archive) {
            this.archive = config.archive;
        }
        this.initialized = true;
    }
    // =========================================================================
    // Encode
    // =========================================================================
    async encode(input, mood, gmiMood, options = {}) {
        this.ensureInitialized();
        const now = Date.now();
        const encodingConfig = { ...DEFAULT_ENCODING_CONFIG, ...this.config.encoding };
        // Detect content features
        const features = await this.featureDetector.detect(input);
        // Compute encoding strength
        const encoding = computeEncodingStrength(mood, this.config.traits, features, options.contentSentiment ?? 0, encodingConfig);
        // Build emotional context
        const emotionalContext = buildEmotionalContext(mood, gmiMood, options.contentSentiment);
        // Create trace
        const trace = {
            id: generateTraceId(),
            type: options.type ?? 'episodic',
            scope: options.scope ?? 'user',
            scopeId: options.scopeId ?? this.config.agentId,
            content: input,
            entities: options.entities ?? [],
            tags: options.tags ?? [],
            provenance: {
                sourceType: options.sourceType ?? 'user_statement',
                sourceTimestamp: now,
                confidence: 0.8,
                verificationCount: 0,
            },
            emotionalContext,
            encodingStrength: encoding.initialStrength,
            stability: encoding.stability,
            retrievalCount: 0,
            lastAccessedAt: now,
            accessCount: 0,
            reinforcementInterval: 3600000,
            associatedTraceIds: [],
            createdAt: now,
            updatedAt: now,
            isActive: true,
        };
        // Cognitive mechanisms: schema encoding (before store, so adjusted strength persists)
        if (this.mechanismsEngine) {
            try {
                const embResp = await this.config.embeddingManager.generateEmbeddings({ texts: input });
                this.mechanismsEngine.onEncoding(trace, embResp.embeddings[0]);
            }
            catch {
                // Non-critical — schema encoding is best-effort
            }
        }
        // Store in long-term memory
        await this.store.store(trace);
        // Add to working memory
        await this.workingMemory.focus(trace.id, encoding.initialStrength);
        // --- Batch 2: Register in memory graph ---
        if (this.graph) {
            await this.graph.addNode(trace.id, {
                type: trace.type,
                scope: trace.scope,
                scopeId: trace.scopeId,
                strength: trace.encodingStrength,
                createdAt: trace.createdAt,
            });
        }
        return trace;
    }
    // =========================================================================
    // Retrieve
    // =========================================================================
    async retrieve(query, mood, options = {}) {
        this.ensureInitialized();
        const startTime = Date.now();
        const resolvedPolicy = options.policy ? resolveMemoryRetrievalPolicy(options.policy) : null;
        const effectiveTopK = options.topK ?? resolvedPolicy?.topK;
        const effectiveHyde = options.hyde ?? (resolvedPolicy?.hyde === 'always');
        // When HyDE is enabled and a retriever is available, generate a
        // hypothetical memory trace and use it as the search query. The
        // hypothesis is a plausible memory that the agent *would* have stored,
        // producing an embedding that's semantically closer to actual stored
        // traces than the raw recall query.
        let effectiveQuery = query;
        if (effectiveHyde && this.hydeRetriever) {
            try {
                const hypoResult = await this.hydeRetriever.generateHypothesis(`Recall a memory about: ${query}`);
                if (hypoResult.hypothesis) {
                    effectiveQuery = hypoResult.hypothesis;
                }
            }
            catch {
                // HyDE generation is non-critical — fall through to raw query.
            }
        }
        const { scored, partial } = await this.store.query(effectiveQuery, mood, {
            ...options,
            topK: effectiveTopK,
        });
        // --- Batch 2: Spreading activation ---
        if (this.graph && scored.length > 0) {
            const seedIds = scored.slice(0, 5).map((t) => t.id);
            try {
                const activated = await this.graph.spreadingActivation(seedIds, {
                    maxDepth: this.config.graph?.maxDepth,
                    decayPerHop: this.config.graph?.decayPerHop,
                    activationThreshold: this.config.graph?.activationThreshold,
                });
                // Boost graph activation scores in scored results
                for (const node of activated) {
                    const match = scored.find((s) => s.id === node.memoryId);
                    if (match) {
                        match.scoreBreakdown.graphActivationScore = node.activation;
                        // Re-compute composite score with graph activation
                        const w = {
                            strength: 0.25,
                            similarity: 0.35,
                            recency: 0.1,
                            emotionalCongruence: 0.15,
                            graphActivation: 0.1,
                            importance: 0.05,
                        };
                        match.retrievalScore = Math.max(0, Math.min(1, w.strength * match.scoreBreakdown.strengthScore +
                            w.similarity * match.scoreBreakdown.similarityScore +
                            w.recency * match.scoreBreakdown.recencyScore +
                            w.emotionalCongruence * match.scoreBreakdown.emotionalCongruenceScore +
                            w.graphActivation * node.activation +
                            w.importance * match.scoreBreakdown.importanceScore));
                    }
                }
                // Re-sort after graph activation adjustment
                scored.sort((a, b) => b.retrievalScore - a.retrievalScore);
                // Record co-activation for Hebbian learning
                const retrievedIds = scored.slice(0, 5).map((t) => t.id);
                await this.graph.recordCoActivation(retrievedIds, this.config.graph?.hebbianLearningRate ?? 0.1);
            }
            catch {
                // Graph operations are non-critical
            }
        }
        // --- Optional neural reranking ---
        // Blends Cohere/LLM-Judge cross-encoder scores with the existing
        // cognitive composite. Weight: 0.7 cognitive + 0.3 neural reranker.
        // This preserves decay, mood congruence, and graph activation signals
        // while boosting semantically relevant results the bi-encoder missed.
        if (this.rerankerService && scored.length > 0) {
            try {
                const rerankerOutput = await this.rerankerService.rerank({
                    query,
                    documents: scored.map((t) => ({
                        id: t.id,
                        content: t.content,
                        originalScore: t.retrievalScore,
                    })),
                }, { topN: effectiveTopK });
                const rerankedScores = new Map(rerankerOutput.results.map((r) => [r.id, r.relevanceScore]));
                for (const trace of scored) {
                    const neuralScore = rerankedScores.get(trace.id);
                    if (neuralScore !== undefined) {
                        trace.retrievalScore = 0.7 * trace.retrievalScore + 0.3 * neuralScore;
                    }
                }
                scored.sort((a, b) => b.retrievalScore - a.retrievalScore);
            }
            catch {
                // Reranking is non-critical — use cognitive scores as-is
            }
        }
        const confidence = evaluateRetrievalConfidence(scored, {
            adaptive: resolvedPolicy?.adaptive ?? false,
            minScore: resolvedPolicy?.minScore ?? 0,
        });
        if (resolvedPolicy && confidence.suppressResults) {
            await this.workingMemory.decayActivations();
            const totalTime = Date.now() - startTime;
            return {
                retrieved: [],
                partiallyRetrieved: partial,
                diagnostics: {
                    candidatesScanned: scored.length + partial.length,
                    vectorSearchTimeMs: totalTime,
                    scoringTimeMs: 0,
                    totalTimeMs: totalTime,
                    policyProfile: resolvedPolicy.profile,
                    suppressed: 'weak_hits',
                    confidence,
                    escalations: [],
                },
            };
        }
        // Record access for retrieved memories (spaced repetition)
        for (const trace of scored.slice(0, 5)) {
            await this.store.recordAccess(trace.id);
            await this.workingMemory.focus(trace.id, trace.retrievalScore);
        }
        // Decay working memory activations each turn
        await this.workingMemory.decayActivations();
        const totalTime = Date.now() - startTime;
        return {
            retrieved: scored,
            partiallyRetrieved: partial,
            diagnostics: {
                candidatesScanned: scored.length + partial.length,
                vectorSearchTimeMs: totalTime,
                scoringTimeMs: 0,
                totalTimeMs: totalTime,
                policyProfile: resolvedPolicy?.profile,
                confidence: resolvedPolicy ? confidence : undefined,
                escalations: resolvedPolicy ? [] : undefined,
            },
        };
    }
    // =========================================================================
    // Assemble for prompt
    // =========================================================================
    async assembleForPrompt(query, tokenBudget, mood, options = {}) {
        this.ensureInitialized();
        // Retrieve relevant memories
        const result = await this.retrieve(query, mood, options);
        // Get working memory state
        const wmText = this.workingMemory.formatForPrompt();
        // --- Batch 2: Check prospective memory ---
        const prospectiveAlerts = [];
        if (this.prospective) {
            let queryEmbedding;
            try {
                const resp = await this.config.embeddingManager.generateEmbeddings({ texts: query });
                queryEmbedding = resp.embeddings[0];
            }
            catch {
                /* non-critical */
            }
            const triggered = await this.prospective.check({
                queryText: query,
                queryEmbedding,
            });
            for (const item of triggered) {
                prospectiveAlerts.push(`[${item.triggerType}] ${item.content}`);
            }
        }
        // --- Batch 2: Graph associations ---
        const graphContext = [];
        if (this.graph && result.retrieved.length > 0) {
            const seedIds = result.retrieved.slice(0, 3).map((t) => t.id);
            try {
                const activated = await this.graph.spreadingActivation(seedIds, { maxResults: 5 });
                for (const node of activated) {
                    const trace = this.store.getTrace(node.memoryId);
                    if (trace) {
                        graphContext.push(`[associated, activation=${node.activation.toFixed(2)}] ${trace.content.substring(0, 150)}`);
                    }
                }
            }
            catch {
                /* non-critical */
            }
        }
        const input = {
            totalTokenBudget: tokenBudget,
            allocation: this.config.tokenBudget,
            traits: this.config.traits,
            workingMemoryText: wmText,
            retrievedTraces: result.retrieved,
            prospectiveAlerts,
            graphContext,
            observationNotes: [], // Filled externally by the GMI turn loop
        };
        return assembleMemoryContext(input);
    }
    /**
     * Infer the prospective trigger type from an observation note's content.
     * Uses regex heuristics — no LLM call needed.
     *
     * Priority: temporal patterns (most specific) → event patterns → context-based fallback.
     *
     * @param note - The observation note to classify
     * @returns The most likely trigger type for ProspectiveMemoryManager
     */
    inferTriggerType(note) {
        for (const pattern of CognitiveMemoryManager.TEMPORAL_PATTERNS) {
            if (pattern.test(note.content))
                return 'time_based';
        }
        for (const pattern of CognitiveMemoryManager.EVENT_PATTERNS) {
            if (pattern.test(note.content))
                return 'event_based';
        }
        // Default: context-based — fires when topic becomes relevant via embedding similarity
        return 'context_based';
    }
    /**
     * Extract an event cue string from "when X" / "after X" patterns.
     * Returns undefined if no event language is detected.
     *
     * @param note - The observation note to extract from
     * @returns Event cue string, or undefined
     */
    extractEventCue(note) {
        for (const pattern of CognitiveMemoryManager.EVENT_PATTERNS) {
            const match = note.content.match(pattern);
            if (match)
                return match[1] ?? match[2];
        }
        return undefined;
    }
    // =========================================================================
    // Batch 2: Observer
    // =========================================================================
    /**
     * Feed a conversation message to the observation pipeline.
     *
     * Pipeline flow:
     * 1. Observer extracts typed observation notes from buffered messages
     * 2. Notes are fed to the Reflector for consolidation into long-term traces
     * 3. Reflected traces are encoded via `encode()` (typed as semantic/episodic/etc.)
     * 4. Superseded traces are soft-deleted
     * 5. Commitment and intention notes are auto-registered with ProspectiveMemoryManager
     *
     * @param role - Message role (user, assistant, system, tool)
     * @param content - Message text content
     * @param mood - Optional PAD emotional state at observation time
     * @returns Observation notes if threshold was reached, null otherwise
     */
    async observe(role, content, mood) {
        if (!this.observer)
            return null;
        const notes = await this.observer.observe(role, content, mood);
        // If notes were produced, feed them to the reflector
        if (notes && notes.length > 0 && this.reflector) {
            const reflectionResult = await this.reflector.addNotes(notes);
            // If reflection produced traces, encode them
            if (reflectionResult) {
                for (const traceData of reflectionResult.traces) {
                    await this.encode(traceData.content, mood ?? { valence: 0, arousal: 0, dominance: 0 }, '', {
                        type: traceData.type,
                        scope: traceData.scope,
                        scopeId: traceData.scopeId,
                        sourceType: traceData.provenance.sourceType,
                        tags: traceData.tags,
                        entities: traceData.entities,
                    });
                }
                // Soft-delete superseded traces
                for (const id of reflectionResult.supersededTraceIds) {
                    await this.store.softDelete(id);
                }
            }
        }
        // Auto-register commitment and intention notes as prospective memory items.
        // Commitment notes above 0.5 importance represent real intentions, not hedging
        // ("maybe I'll..." vs "I will..."). Preference notes expressing future desire
        // also register as low-priority context-based items so they surface naturally
        // when the topic comes up again.
        if (notes && notes.length > 0 && this.prospective) {
            for (const note of notes) {
                const isCommitment = note.type === 'commitment' && note.importance >= 0.5;
                const isFuturePreference = note.type === 'preference' && note.importance >= 0.6
                    && /\b(love to|want to|been meaning to|plan to|going to|hope to)\b/i.test(note.content);
                if (isCommitment || isFuturePreference) {
                    const triggerType = this.inferTriggerType(note);
                    try {
                        await this.prospective.register({
                            content: note.content,
                            triggerType,
                            triggerEvent: triggerType === 'event_based' ? this.extractEventCue(note) : undefined,
                            cueText: note.content,
                            // Future preferences get a lower importance than explicit commitments
                            importance: isFuturePreference ? note.importance * 0.7 : note.importance,
                            recurring: false,
                        });
                    }
                    catch {
                        // Prospective registration is non-critical — don't fail the observe() call
                    }
                }
            }
        }
        return notes;
    }
    // =========================================================================
    // Batch 2: Prospective Memory
    // =========================================================================
    async checkProspective(context) {
        if (!this.prospective)
            return [];
        return this.prospective.check(context);
    }
    async registerProspective(input) {
        if (!this.prospective) {
            throw new Error('Prospective memory is not initialized.');
        }
        return this.prospective.register(input);
    }
    async listProspective() {
        return this.prospective?.getActive() ?? [];
    }
    async removeProspective(id) {
        return this.prospective?.remove(id) ?? false;
    }
    // =========================================================================
    // Archive: Rehydration
    // =========================================================================
    /**
     * Rehydrate a gisted/archived trace to its original verbatim content.
     *
     * Delegates to the configured `IMemoryArchive`. Returns `null` when no
     * archive is configured or when the trace is not found/integrity fails.
     *
     * @param traceId - The trace id to rehydrate.
     * @param requestContext - Optional caller hint for audit.
     * @returns The original verbatim content, or `null`.
     */
    async rehydrate(traceId, requestContext) {
        if (!this.archive)
            return null;
        const result = await this.archive.rehydrate(traceId, requestContext);
        return result?.verbatimContent ?? null;
    }
    // =========================================================================
    // Batch 2: Consolidation
    // =========================================================================
    async runConsolidation() {
        if (!this.consolidation) {
            return {
                prunedCount: 0,
                edgesCreated: 0,
                schemasCreated: 0,
                conflictsResolved: 0,
                reinforcedCount: 0,
                totalProcessed: 0,
                durationMs: 0,
                archivedPruned: 0,
            };
        }
        return this.consolidation.run();
    }
    // =========================================================================
    // Health
    // =========================================================================
    async getMemoryHealth() {
        this.ensureInitialized();
        const now = Date.now();
        const totalTraces = this.store.getTraceCount();
        const activeTraces = this.store.getActiveTraceCount();
        let totalStrength = 0;
        let count = 0;
        const tracesPerType = {
            episodic: 0,
            semantic: 0,
            procedural: 0,
            prospective: 0,
        };
        const tracesPerScope = {
            thread: 0,
            user: 0,
            persona: 0,
            organization: 0,
        };
        let weakestStrength = 1;
        for (const scope of ['user']) {
            const traces = await this.store.getByScope(scope, this.config.agentId);
            for (const trace of traces) {
                if (!trace.isActive)
                    continue;
                const strength = computeCurrentStrength(trace, now);
                totalStrength += strength;
                count++;
                tracesPerType[trace.type] = (tracesPerType[trace.type] ?? 0) + 1;
                tracesPerScope[trace.scope] = (tracesPerScope[trace.scope] ?? 0) + 1;
                if (strength < weakestStrength)
                    weakestStrength = strength;
            }
        }
        return {
            totalTraces,
            activeTraces,
            avgStrength: count > 0 ? totalStrength / count : 0,
            weakestTraceStrength: count > 0 ? weakestStrength : 0,
            workingMemoryUtilization: this.workingMemory.getUtilization(),
            lastConsolidationAt: this.consolidation?.getLastRunAt(),
            tracesPerType: tracesPerType,
            tracesPerScope: tracesPerScope,
        };
    }
    // =========================================================================
    // Batch 3: Infinite Context Window
    // =========================================================================
    /**
     * Track a conversation message for context window management.
     * Call for every user/assistant/system/tool message in the conversation.
     */
    trackMessage(role, content) {
        this.contextWindow?.addMessage(role, content);
    }
    /**
     * Run context window compaction if needed. Call BEFORE assembling the LLM prompt.
     * Returns the (potentially compacted) message list for the conversation.
     * If infinite context is disabled, returns null (caller should use original messages).
     */
    async compactIfNeeded(systemPromptTokens, memoryBudgetTokens) {
        if (!this.contextWindow?.enabled)
            return null;
        const mood = this.config.moodProvider();
        const emotionalContext = buildEmotionalContext({ valence: mood.valence, arousal: mood.arousal, dominance: mood.dominance }, 'neutral');
        return this.contextWindow.beforeTurn(systemPromptTokens, memoryBudgetTokens, emotionalContext);
    }
    /** Get the rolling summary chain text for prompt injection. */
    getSummaryContext() {
        return this.contextWindow?.getSummaryContext() ?? '';
    }
    /** Get context window transparency stats. */
    getContextWindowStats() {
        return this.contextWindow?.getStats() ?? null;
    }
    /** Get full transparency report (for agent self-inspection or UI). */
    getContextTransparencyReport() {
        return this.contextWindow?.formatTransparencyReport() ?? null;
    }
    /** Get compaction history for audit/UI. */
    getCompactionHistory() {
        return this.contextWindow?.getCompactionHistory() ?? [];
    }
    /** Search compaction history for a keyword. */
    searchCompactionHistory(keyword) {
        return this.contextWindow?.searchHistory(keyword) ?? [];
    }
    /** Get the context window manager (for advanced usage). */
    getContextWindowManager() {
        return this.contextWindow;
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    async shutdown() {
        this.consolidation?.stop();
        await this.graph?.shutdown();
        this.initialized = false;
    }
    // =========================================================================
    // Accessors
    // =========================================================================
    getStore() {
        return this.store;
    }
    /**
     * Total number of memory traces currently resident in the manager's
     * in-memory trace cache. Ergonomic passthrough to
     * {@link MemoryStore.getTraceCount}; used by agentos-bench for
     * memory-footprint telemetry without reaching into `getStore()`.
     */
    getTraceCount() {
        this.ensureInitialized();
        return this.store.getTraceCount();
    }
    getWorkingMemory() {
        return this.workingMemory;
    }
    getConfig() {
        return this.config;
    }
    getGraph() {
        return this.graph;
    }
    getObserver() {
        return this.observer;
    }
    getProspective() {
        return this.prospective;
    }
    /**
     * Export the full brain state as a JSON string.
     * Delegates to JsonExporter through the MemoryStore's brain.
     * Throws if no brain is attached.
     */
    async exportToString(options) {
        const brain = this.store.getBrain();
        if (!brain) {
            throw new Error('Cannot export: no SqliteBrain attached to MemoryStore');
        }
        const { JsonExporter } = await import('./io/JsonExporter.js');
        return new JsonExporter(brain).exportToString(options);
    }
    /**
     * Import a JSON brain payload into the attached brain.
     * Delegates to JsonImporter through the MemoryStore's brain.
     * Throws if no brain is attached.
     */
    async importFromString(json, options) {
        const brain = this.store.getBrain();
        if (!brain) {
            throw new Error('Cannot import: no SqliteBrain attached to MemoryStore');
        }
        const { JsonImporter } = await import('./io/JsonImporter.js');
        return new JsonImporter(brain).importFromString(json, options);
    }
    /**
     * Attach a HyDE retriever to enable hypothesis-driven memory recall.
     *
     * When set, the `retrieve()` and `assembleForPrompt()` methods can accept
     * `options.hyde = true` to generate a hypothetical memory trace before
     * searching. This improves recall for vague or abstract queries by
     * producing embeddings that are semantically closer to stored traces.
     *
     * @param retriever - A pre-configured HydeRetriever instance, or `null`
     *   to disable HyDE.
     *
     * @example
     * ```typescript
     * memoryManager.setHydeRetriever(new HydeRetriever({
     *   llmCaller: myLlmCaller,
     *   embeddingManager: myEmbeddingManager,
     *   config: { enabled: true },
     * }));
     * ```
     */
    setHydeRetriever(retriever) {
        this.hydeRetriever = retriever;
    }
    /** Get the HyDE retriever if configured, or `null`. */
    getHydeRetriever() {
        return this.hydeRetriever;
    }
    // =========================================================================
    // Internal
    // =========================================================================
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('CognitiveMemoryManager not initialized. Call initialize() first.');
        }
    }
}
// =========================================================================
// Prospective auto-registration helpers
// =========================================================================
/**
 * Temporal patterns for extracting time-based triggers from observation notes.
 * Matches relative expressions ("tomorrow", "next Friday", "in 2 hours")
 * and absolute expressions ("on March 5th", "at 3pm").
 */
CognitiveMemoryManager.TEMPORAL_PATTERNS = [
    /\b(tomorrow|tonight|next\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
    /\b(in\s+\d+\s+(hours?|days?|weeks?|minutes?))\b/i,
    /\b(on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+)/i,
    /\b(at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
];
/**
 * Event-based patterns for extracting event triggers from observation notes.
 * Matches conditional language ("when X happens", "after the meeting").
 */
CognitiveMemoryManager.EVENT_PATTERNS = [
    /\bwhen\s+(.{3,40}?)\s*(happens?|occurs?|starts?|ends?|finishes?|completes?)\b/i,
    /\bafter\s+(the\s+)?(.{3,30})\b/i,
    /\bonce\s+(.{3,30})\s+(is|are|has|have)\b/i,
];
//# sourceMappingURL=CognitiveMemoryManager.js.map