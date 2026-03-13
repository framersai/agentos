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

import type {
  MemoryTrace,
  MemoryType,
  MemoryScope,
  CognitiveRetrievalOptions,
  CognitiveRetrievalResult,
  AssembledMemoryContext,
  MemoryHealthReport,
  ContentFeatures,
} from './types.js';
import type {
  CognitiveMemoryConfig,
  PADState,
  HexacoTraits,
} from './config.js';
import { DEFAULT_ENCODING_CONFIG, DEFAULT_DECAY_CONFIG, DEFAULT_BUDGET_ALLOCATION } from './config.js';
import {
  computeEncodingStrength,
  buildEmotionalContext,
} from './encoding/EncodingModel.js';
import {
  createFeatureDetector,
  type IContentFeatureDetector,
} from './encoding/ContentFeatureDetector.js';
import { computeCurrentStrength } from './decay/DecayModel.js';
import { MemoryStore } from './store/MemoryStore.js';
import { CognitiveWorkingMemory } from './working/CognitiveWorkingMemory.js';
import { assembleMemoryContext, type MemoryAssemblerInput } from './prompt/MemoryPromptAssembler.js';

// Batch 2 imports
import type { IMemoryGraph, ActivatedNode } from './graph/IMemoryGraph.js';
import { GraphologyMemoryGraph } from './graph/GraphologyMemoryGraph.js';
import { KnowledgeGraphMemoryGraph } from './graph/KnowledgeGraphMemoryGraph.js';
import { MemoryObserver, type ObservationNote } from './observation/MemoryObserver.js';
import { MemoryReflector } from './observation/MemoryReflector.js';
import { ProspectiveMemoryManager, type ProspectiveMemoryItem } from './prospective/ProspectiveMemoryManager.js';
import { ConsolidationPipeline, type ConsolidationResult } from './consolidation/ConsolidationPipeline.js';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ICognitiveMemoryManager {
  initialize(config: CognitiveMemoryConfig): Promise<void>;

  /** Encode a new input into a memory trace. Called after each user message. */
  encode(
    input: string,
    mood: PADState,
    gmiMood: string,
    options?: {
      type?: MemoryType;
      scope?: MemoryScope;
      scopeId?: string;
      sourceType?: MemoryTrace['provenance']['sourceType'];
      contentSentiment?: number;
      tags?: string[];
      entities?: string[];
    },
  ): Promise<MemoryTrace>;

  /** Retrieve relevant memories for a query. Called before prompt construction. */
  retrieve(
    query: string,
    mood: PADState,
    options?: CognitiveRetrievalOptions,
  ): Promise<CognitiveRetrievalResult>;

  /** Assemble memory context for prompt injection within a token budget. */
  assembleForPrompt(
    query: string,
    tokenBudget: number,
    mood: PADState,
    options?: CognitiveRetrievalOptions,
  ): Promise<AssembledMemoryContext>;

  /** Feed a message to the observer (Batch 2). Returns notes if threshold reached. */
  observe?(role: 'user' | 'assistant' | 'system' | 'tool', content: string, mood?: PADState): Promise<ObservationNote[] | null>;

  /** Check prospective memory triggers (Batch 2). */
  checkProspective?(context: { now?: number; events?: string[]; queryText?: string; queryEmbedding?: number[] }): Promise<ProspectiveMemoryItem[]>;

  /** Run consolidation cycle (Batch 2). */
  runConsolidation?(): Promise<ConsolidationResult>;

  /** Get memory health diagnostics. */
  getMemoryHealth(): Promise<MemoryHealthReport>;

  /** Shutdown and release resources. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

let traceIdCounter = 0;
function generateTraceId(): string {
  return `mt_${Date.now()}_${++traceIdCounter}`;
}

export class CognitiveMemoryManager implements ICognitiveMemoryManager {
  private config!: CognitiveMemoryConfig;
  private store!: MemoryStore;
  private workingMemory!: CognitiveWorkingMemory;
  private featureDetector!: IContentFeatureDetector;
  private initialized = false;

  // Batch 2 modules (optional)
  private graph: IMemoryGraph | null = null;
  private observer: MemoryObserver | null = null;
  private reflector: MemoryReflector | null = null;
  private prospective: ProspectiveMemoryManager | null = null;
  private consolidation: ConsolidationPipeline | null = null;

  async initialize(config: CognitiveMemoryConfig): Promise<void> {
    this.config = config;

    // Memory store
    this.store = new MemoryStore({
      vectorStore: config.vectorStore,
      embeddingManager: config.embeddingManager,
      knowledgeGraph: config.knowledgeGraph,
      collectionPrefix: config.collectionPrefix ?? 'cogmem',
      decayConfig: config.decay ? { ...DEFAULT_DECAY_CONFIG, ...config.decay } : undefined,
    });

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
    this.featureDetector = createFeatureDetector(
      config.featureDetectionStrategy,
      config.featureDetectionLlmInvoker,
    );

    // --- Batch 2: Memory Graph ---
    if (config.graph) {
      const backend = config.graph.backend ?? 'knowledge-graph';
      if (backend === 'graphology') {
        this.graph = new GraphologyMemoryGraph();
      } else {
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
    if (config.consolidation || this.graph) {
      this.consolidation = new ConsolidationPipeline({
        store: this.store,
        graph: this.graph ?? undefined,
        traits: config.traits,
        agentId: config.agentId,
        decay: config.decay,
        consolidation: config.consolidation,
        llmInvoker: config.reflector?.llmInvoker ?? config.featureDetectionLlmInvoker,
      });
      // Auto-start periodic consolidation
      this.consolidation.start();
    }

    this.initialized = true;
  }

  // =========================================================================
  // Encode
  // =========================================================================

  async encode(
    input: string,
    mood: PADState,
    gmiMood: string,
    options: {
      type?: MemoryType;
      scope?: MemoryScope;
      scopeId?: string;
      sourceType?: MemoryTrace['provenance']['sourceType'];
      contentSentiment?: number;
      tags?: string[];
      entities?: string[];
    } = {},
  ): Promise<MemoryTrace> {
    this.ensureInitialized();

    const now = Date.now();
    const encodingConfig = { ...DEFAULT_ENCODING_CONFIG, ...this.config.encoding };

    // Detect content features
    const features: ContentFeatures = await this.featureDetector.detect(input);

    // Compute encoding strength
    const encoding = computeEncodingStrength(
      mood,
      this.config.traits,
      features,
      options.contentSentiment ?? 0,
      encodingConfig,
    );

    // Build emotional context
    const emotionalContext = buildEmotionalContext(mood, gmiMood, options.contentSentiment);

    // Create trace
    const trace: MemoryTrace = {
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
      reinforcementInterval: 3_600_000,
      associatedTraceIds: [],
      createdAt: now,
      updatedAt: now,
      isActive: true,
    };

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

  async retrieve(
    query: string,
    mood: PADState,
    options: CognitiveRetrievalOptions = {},
  ): Promise<CognitiveRetrievalResult> {
    this.ensureInitialized();

    const startTime = Date.now();

    const { scored, partial } = await this.store.query(query, mood, options);

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
            const w = { strength: 0.25, similarity: 0.35, recency: 0.10, emotionalCongruence: 0.15, graphActivation: 0.10, importance: 0.05 };
            match.retrievalScore = Math.max(0, Math.min(1,
              w.strength * match.scoreBreakdown.strengthScore +
              w.similarity * match.scoreBreakdown.similarityScore +
              w.recency * match.scoreBreakdown.recencyScore +
              w.emotionalCongruence * match.scoreBreakdown.emotionalCongruenceScore +
              w.graphActivation * node.activation +
              w.importance * match.scoreBreakdown.importanceScore,
            ));
          }
        }

        // Re-sort after graph activation adjustment
        scored.sort((a, b) => b.retrievalScore - a.retrievalScore);

        // Record co-activation for Hebbian learning
        const retrievedIds = scored.slice(0, 5).map((t) => t.id);
        await this.graph.recordCoActivation(
          retrievedIds,
          this.config.graph?.hebbianLearningRate ?? 0.1,
        );
      } catch {
        // Graph operations are non-critical
      }
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
      },
    };
  }

  // =========================================================================
  // Assemble for prompt
  // =========================================================================

  async assembleForPrompt(
    query: string,
    tokenBudget: number,
    mood: PADState,
    options: CognitiveRetrievalOptions = {},
  ): Promise<AssembledMemoryContext> {
    this.ensureInitialized();

    // Retrieve relevant memories
    const result = await this.retrieve(query, mood, options);

    // Get working memory state
    const wmText = this.workingMemory.formatForPrompt();

    // --- Batch 2: Check prospective memory ---
    const prospectiveAlerts: string[] = [];
    if (this.prospective) {
      let queryEmbedding: number[] | undefined;
      try {
        const resp = await this.config.embeddingManager.generateEmbeddings({ texts: query });
        queryEmbedding = resp.embeddings[0];
      } catch { /* non-critical */ }

      const triggered = await this.prospective.check({
        queryText: query,
        queryEmbedding,
      });
      for (const item of triggered) {
        prospectiveAlerts.push(`[${item.triggerType}] ${item.content}`);
      }
    }

    // --- Batch 2: Graph associations ---
    const graphContext: string[] = [];
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
      } catch { /* non-critical */ }
    }

    const input: MemoryAssemblerInput = {
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

  // =========================================================================
  // Batch 2: Observer
  // =========================================================================

  async observe(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    mood?: PADState,
  ): Promise<ObservationNote[] | null> {
    if (!this.observer) return null;

    const notes = await this.observer.observe(role, content, mood);

    // If notes were produced, feed them to the reflector
    if (notes && notes.length > 0 && this.reflector) {
      const reflectionResult = await this.reflector.addNotes(notes);

      // If reflection produced traces, encode them
      if (reflectionResult) {
        for (const traceData of reflectionResult.traces) {
          await this.encode(
            traceData.content,
            mood ?? { valence: 0, arousal: 0, dominance: 0 },
            '',
            {
              type: traceData.type,
              scope: traceData.scope,
              scopeId: traceData.scopeId,
              sourceType: traceData.provenance.sourceType,
              tags: traceData.tags,
              entities: traceData.entities,
            },
          );
        }

        // Soft-delete superseded traces
        for (const id of reflectionResult.supersededTraceIds) {
          await this.store.softDelete(id);
        }
      }
    }

    return notes;
  }

  // =========================================================================
  // Batch 2: Prospective Memory
  // =========================================================================

  async checkProspective(context: {
    now?: number;
    events?: string[];
    queryText?: string;
    queryEmbedding?: number[];
  }): Promise<ProspectiveMemoryItem[]> {
    if (!this.prospective) return [];
    return this.prospective.check(context);
  }

  // =========================================================================
  // Batch 2: Consolidation
  // =========================================================================

  async runConsolidation(): Promise<ConsolidationResult> {
    if (!this.consolidation) {
      return {
        prunedCount: 0,
        edgesCreated: 0,
        schemasCreated: 0,
        conflictsResolved: 0,
        reinforcedCount: 0,
        totalProcessed: 0,
        durationMs: 0,
      };
    }
    return this.consolidation.run();
  }

  // =========================================================================
  // Health
  // =========================================================================

  async getMemoryHealth(): Promise<MemoryHealthReport> {
    this.ensureInitialized();

    const now = Date.now();
    const totalTraces = this.store.getTraceCount();
    const activeTraces = this.store.getActiveTraceCount();

    let totalStrength = 0;
    let count = 0;
    const tracesPerType: Record<string, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      prospective: 0,
    };
    const tracesPerScope: Record<string, number> = {
      thread: 0,
      user: 0,
      persona: 0,
      organization: 0,
    };
    let weakestStrength = 1;

    for (const scope of ['user'] as const) {
      const traces = await this.store.getByScope(scope, this.config.agentId);
      for (const trace of traces) {
        if (!trace.isActive) continue;
        const strength = computeCurrentStrength(trace, now);
        totalStrength += strength;
        count++;
        tracesPerType[trace.type] = (tracesPerType[trace.type] ?? 0) + 1;
        tracesPerScope[trace.scope] = (tracesPerScope[trace.scope] ?? 0) + 1;
        if (strength < weakestStrength) weakestStrength = strength;
      }
    }

    return {
      totalTraces,
      activeTraces,
      avgStrength: count > 0 ? totalStrength / count : 0,
      weakestTraceStrength: count > 0 ? weakestStrength : 0,
      workingMemoryUtilization: this.workingMemory.getUtilization(),
      lastConsolidationAt: this.consolidation?.getLastRunAt(),
      tracesPerType: tracesPerType as Record<MemoryType, number>,
      tracesPerScope: tracesPerScope as Record<MemoryScope, number>,
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async shutdown(): Promise<void> {
    this.consolidation?.stop();
    await this.graph?.shutdown();
    this.initialized = false;
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  getStore(): MemoryStore {
    return this.store;
  }

  getWorkingMemory(): CognitiveWorkingMemory {
    return this.workingMemory;
  }

  getConfig(): CognitiveMemoryConfig {
    return this.config;
  }

  getGraph(): IMemoryGraph | null {
    return this.graph;
  }

  getObserver(): MemoryObserver | null {
    return this.observer;
  }

  getProspective(): ProspectiveMemoryManager | null {
    return this.prospective;
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CognitiveMemoryManager not initialized. Call initialize() first.');
    }
  }
}
