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

import type {
  MemoryTrace,
  MemoryType,
  MemoryScope,
  CognitiveRetrievalOptions,
  CognitiveRetrievalResult,
  AssembledMemoryContext,
  MemoryHealthReport,
  ContentFeatures,
} from './core/types.js';
import type { CognitiveMemoryConfig, PADState, HexacoTraits } from './core/config.js';
import {
  DEFAULT_ENCODING_CONFIG,
  DEFAULT_DECAY_CONFIG,
  DEFAULT_BUDGET_ALLOCATION,
  DEFAULT_GRAPH_CONFIG,
} from './core/config.js';
import { computeEncodingStrength, buildEmotionalContext } from './core/encoding/EncodingModel.js';
import {
  createFeatureDetector,
  type IContentFeatureDetector,
} from './core/encoding/ContentFeatureDetector.js';
import { computeCurrentStrength } from './core/decay/DecayModel.js';
import { MemoryStore } from './retrieval/store/MemoryStore.js';
import { CognitiveWorkingMemory } from './core/working/CognitiveWorkingMemory.js';
import {
  assembleMemoryContext,
  type MemoryAssemblerInput,
} from './core/prompt/MemoryPromptAssembler.js';

// Batch 2 imports
import type { IMemoryGraph, ActivatedNode } from './retrieval/graph/IMemoryGraph.js';
import { GraphologyMemoryGraph } from './retrieval/graph/GraphologyMemoryGraph.js';
import { KnowledgeGraphMemoryGraph } from './retrieval/graph/KnowledgeGraphMemoryGraph.js';
import { MemoryObserver, type ObservationNote } from './pipeline/observation/MemoryObserver.js';
import { MemoryReflector } from './pipeline/observation/MemoryReflector.js';
import {
  ProspectiveMemoryManager,
  type ProspectiveMemoryItem,
} from './retrieval/prospective/ProspectiveMemoryManager.js';
import {
  ConsolidationPipeline,
  type ConsolidationResult,
} from './pipeline/consolidation/ConsolidationPipeline.js';

// Batch 3: Infinite Context
import { ContextWindowManager } from './pipeline/context/ContextWindowManager.js';
import type { ContextMessage, CompactionEntry } from './pipeline/context/types.js';
import type { ContextWindowStats } from './pipeline/context/ContextWindowManager.js';
import {
  evaluateRetrievalConfidence,
  resolveMemoryRetrievalPolicy,
} from '../rag/unified/index.js';

// HyDE (Hypothetical Document Embedding) for improved memory retrieval
import type { HydeRetriever } from '../rag/HydeRetriever.js';

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
    }
  ): Promise<MemoryTrace>;

  /** Retrieve relevant memories for a query. Called before prompt construction. */
  retrieve(
    query: string,
    mood: PADState,
    options?: CognitiveRetrievalOptions
  ): Promise<CognitiveRetrievalResult>;

  /** Assemble memory context for prompt injection within a token budget. */
  assembleForPrompt(
    query: string,
    tokenBudget: number,
    mood: PADState,
    options?: CognitiveRetrievalOptions
  ): Promise<AssembledMemoryContext>;

  /** Feed a message to the observer (Batch 2). Returns notes if threshold reached. */
  observe?(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    mood?: PADState
  ): Promise<ObservationNote[] | null>;

  /** Check prospective memory triggers (Batch 2). */
  checkProspective?(context: {
    now?: number;
    events?: string[];
    queryText?: string;
    queryEmbedding?: number[];
  }): Promise<ProspectiveMemoryItem[]>;

  /** Register a new prospective reminder/intention. */
  registerProspective?(
    input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
      cueText?: string;
    }
  ): Promise<ProspectiveMemoryItem>;

  /** List active prospective reminders. */
  listProspective?(): Promise<ProspectiveMemoryItem[]>;

  /** Remove a prospective reminder. */
  removeProspective?(id: string): Promise<boolean>;

  /** Run consolidation cycle (Batch 2). */
  runConsolidation?(): Promise<ConsolidationResult>;

  /** Get memory health diagnostics. */
  getMemoryHealth(): Promise<MemoryHealthReport>;

  /** Access the underlying long-term memory store for diagnostics/devtools. */
  getStore(): MemoryStore;

  /**
   * Total number of memory traces currently resident in the manager's
   * in-memory trace cache. Ergonomic passthrough to
   * {@link MemoryStore.getTraceCount}; used by agentos-bench for
   * memory-footprint telemetry.
   */
  getTraceCount(): number;

  /** Access the working-memory model for diagnostics/devtools. */
  getWorkingMemory(): CognitiveWorkingMemory;

  /** Get the resolved cognitive-memory runtime config. */
  getConfig(): CognitiveMemoryConfig;

  /** Get graph module when enabled. */
  getGraph(): IMemoryGraph | null;

  /** Get observer module when enabled. */
  getObserver(): MemoryObserver | null;

  /** Get prospective-memory manager when enabled. */
  getProspective(): ProspectiveMemoryManager | null;

  /**
   * Attach a HyDE retriever for hypothesis-driven memory recall.
   * Pass `null` to disable.
   */
  setHydeRetriever?(retriever: HydeRetriever | null): void;

  /** Get the HyDE retriever if configured, or `null`. */
  getHydeRetriever?(): HydeRetriever | null;

  /**
   * Get the attached neural reranker, or `null` when none is
   * configured. Step 3 uses this so the bench-side `HybridRetriever`
   * can plumb the manager's reranker into the per-case retriever
   * without bracket-accessing a private field.
   */
  getRerankerService?(): import('../rag/reranking/RerankerService.js').RerankerService | null;

  /** Get infinite-context runtime stats when enabled. */
  getContextWindowStats(): ContextWindowStats | null;

  /** Get a human-readable compaction/transparency report when enabled. */
  getContextTransparencyReport(): string | null;

  /**
   * Return the verbatim content that was archived when this trace was
   * consolidated, or `null` if the trace is not gisted/archived or the
   * archive is unreachable.
   *
   * @param traceId - The trace id to rehydrate.
   * @param requestContext - Optional caller hint for audit.
   * @returns The original verbatim content, or `null`.
   */
  rehydrate?(traceId: string, requestContext?: string): Promise<string | null>;

  /** Shutdown and release resources. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generate a globally unique trace ID.
 * Previous implementation used a monotonic counter (`mt_{timestamp}_{counter}`)
 * which could collide across multiple processes or rapid restarts.
 */
function generateTraceId(): string {
  return `mt_${uuid()}`;
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

  // Batch 3: Infinite Context (optional)
  private contextWindow: ContextWindowManager | null = null;

  // Cognitive Mechanisms (optional)
  private mechanismsEngine: import('./mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine | null = null;

  // Optional neural reranker for post-retrieval quality improvement
  private rerankerService: import('../rag/reranking/RerankerService.js').RerankerService | null = null;

  // Memory archive for write-ahead verbatim preservation
  private archive: import('./archive/IMemoryArchive.js').IMemoryArchive | null = null;

  /**
   * Optional HyDE retriever for hypothesis-driven memory recall.
   *
   * When set and `options.hyde` is `true` on a `retrieve()` call, the manager
   * generates a hypothetical memory trace via LLM and uses that text for the
   * embedding-based memory search. This improves recall for vague or abstract
   * queries (e.g. "that deployment discussion last week").
   */
  private hydeRetriever: HydeRetriever | null = null;

  async initialize(config: CognitiveMemoryConfig): Promise<void> {
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
    this.featureDetector = createFeatureDetector(
      config.featureDetectionStrategy,
      config.featureDetectionLlmInvoker
    );

    // --- Memory Graph (enabled by default, opt-out via disabled: true) ---
    // The knowledge graph powers spreading activation (Collins & Quillian model),
    // Hebbian co-activation learning ("neurons that fire together wire together"),
    // and graph-boosted retrieval scoring. It is fundamental to associative memory.
    if (config.graph?.disabled !== true) {
      const graphConfig = { ...DEFAULT_GRAPH_CONFIG, ...config.graph };
      const backend = graphConfig.backend;
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
        const singlePromptInvoker = (prompt: string) =>
          llmInvoker('You are a conversation summarizer.', prompt);

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
                await this.encode(
                  partial.content,
                  mood,
                  'neutral',
                  {
                    type: partial.type ?? 'semantic',
                    scope: partial.scope ?? 'user',
                    sourceType: 'reflection',
                    tags: partial.tags,
                    entities: partial.entities,
                  },
                );
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
      this.hydeRetriever = new MemoryHydeRetriever(anyLlmInvoker) as unknown as HydeRetriever;
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
    } = {}
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
      encodingConfig
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

    // Cognitive mechanisms: schema encoding (before store, so adjusted strength persists)
    if (this.mechanismsEngine) {
      try {
        const embResp = await this.config.embeddingManager.generateEmbeddings({ texts: input });
        this.mechanismsEngine.onEncoding(trace, embResp.embeddings[0]);
      } catch {
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

  async retrieve(
    query: string,
    mood: PADState,
    options: CognitiveRetrievalOptions = {}
  ): Promise<CognitiveRetrievalResult> {
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
        const hypoResult = await this.hydeRetriever.generateHypothesis(
          `Recall a memory about: ${query}`,
        );
        if (hypoResult.hypothesis) {
          effectiveQuery = hypoResult.hypothesis;
        }
      } catch {
        // HyDE generation is non-critical — fall through to raw query.
      }
    }

    const { scored, partial, timings: storeTimings } = await this.store.query(
      effectiveQuery,
      mood,
      {
        ...options,
        topK: effectiveTopK,
      },
    );

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
            match.retrievalScore = Math.max(
              0,
              Math.min(
                1,
                w.strength * match.scoreBreakdown.strengthScore +
                  w.similarity * match.scoreBreakdown.similarityScore +
                  w.recency * match.scoreBreakdown.recencyScore +
                  w.emotionalCongruence * match.scoreBreakdown.emotionalCongruenceScore +
                  w.graphActivation * node.activation +
                  w.importance * match.scoreBreakdown.importanceScore
              )
            );
          }
        }

        // Re-sort after graph activation adjustment
        scored.sort((a, b) => b.retrievalScore - a.retrievalScore);

        // Record co-activation for Hebbian learning
        const retrievedIds = scored.slice(0, 5).map((t) => t.id);
        await this.graph.recordCoActivation(
          retrievedIds,
          this.config.graph?.hebbianLearningRate ?? 0.1
        );
      } catch {
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

        const rerankedScores = new Map(
          rerankerOutput.results.map((r) => [r.id, r.relevanceScore])
        );

        for (const trace of scored) {
          const neuralScore = rerankedScores.get(trace.id);
          if (neuralScore !== undefined) {
            trace.retrievalScore = 0.7 * trace.retrievalScore + 0.3 * neuralScore;
          }
        }

        scored.sort((a, b) => b.retrievalScore - a.retrievalScore);
      } catch {
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
          vectorSearchTimeMs: storeTimings.vectorSearchMs,
          scoringTimeMs: storeTimings.scoringMs,
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
        vectorSearchTimeMs: storeTimings.vectorSearchMs,
        scoringTimeMs: storeTimings.scoringMs,
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

  async assembleForPrompt(
    query: string,
    tokenBudget: number,
    mood: PADState,
    options: CognitiveRetrievalOptions = {}
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
      } catch {
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
    const graphContext: string[] = [];
    if (this.graph && result.retrieved.length > 0) {
      const seedIds = result.retrieved.slice(0, 3).map((t) => t.id);
      try {
        const activated = await this.graph.spreadingActivation(seedIds, { maxResults: 5 });
        for (const node of activated) {
          const trace = this.store.getTrace(node.memoryId);
          if (trace) {
            graphContext.push(
              `[associated, activation=${node.activation.toFixed(2)}] ${trace.content.substring(0, 150)}`
            );
          }
        }
      } catch {
        /* non-critical */
      }
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
  // Prospective auto-registration helpers
  // =========================================================================

  /**
   * Temporal patterns for extracting time-based triggers from observation notes.
   * Matches relative expressions ("tomorrow", "next Friday", "in 2 hours")
   * and absolute expressions ("on March 5th", "at 3pm").
   */
  private static readonly TEMPORAL_PATTERNS = [
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
  private static readonly EVENT_PATTERNS = [
    /\bwhen\s+(.{3,40}?)\s*(happens?|occurs?|starts?|ends?|finishes?|completes?)\b/i,
    /\bafter\s+(the\s+)?(.{3,30})\b/i,
    /\bonce\s+(.{3,30})\s+(is|are|has|have)\b/i,
  ];

  /**
   * Infer the prospective trigger type from an observation note's content.
   * Uses regex heuristics — no LLM call needed.
   *
   * Priority: temporal patterns (most specific) → event patterns → context-based fallback.
   *
   * @param note - The observation note to classify
   * @returns The most likely trigger type for ProspectiveMemoryManager
   */
  private inferTriggerType(note: ObservationNote): 'time_based' | 'event_based' | 'context_based' {
    for (const pattern of CognitiveMemoryManager.TEMPORAL_PATTERNS) {
      if (pattern.test(note.content)) return 'time_based';
    }
    for (const pattern of CognitiveMemoryManager.EVENT_PATTERNS) {
      if (pattern.test(note.content)) return 'event_based';
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
  private extractEventCue(note: ObservationNote): string | undefined {
    for (const pattern of CognitiveMemoryManager.EVENT_PATTERNS) {
      const match = note.content.match(pattern);
      if (match) return match[1] ?? match[2];
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
  async observe(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    mood?: PADState
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
            }
          );
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
          } catch {
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

  async checkProspective(context: {
    now?: number;
    events?: string[];
    queryText?: string;
    queryEmbedding?: number[];
  }): Promise<ProspectiveMemoryItem[]> {
    if (!this.prospective) return [];
    return this.prospective.check(context);
  }

  async registerProspective(
    input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
      cueText?: string;
    }
  ): Promise<ProspectiveMemoryItem> {
    if (!this.prospective) {
      throw new Error('Prospective memory is not initialized.');
    }
    return this.prospective.register(input);
  }

  async listProspective(): Promise<ProspectiveMemoryItem[]> {
    return this.prospective?.getActive() ?? [];
  }

  async removeProspective(id: string): Promise<boolean> {
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
  async rehydrate(traceId: string, requestContext?: string): Promise<string | null> {
    if (!this.archive) return null;
    const result = await this.archive.rehydrate(traceId, requestContext);
    return result?.verbatimContent ?? null;
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
        archivedPruned: 0,
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
  // Batch 3: Infinite Context Window
  // =========================================================================

  /**
   * Track a conversation message for context window management.
   * Call for every user/assistant/system/tool message in the conversation.
   */
  trackMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
    this.contextWindow?.addMessage(role, content);
  }

  /**
   * Run context window compaction if needed. Call BEFORE assembling the LLM prompt.
   * Returns the (potentially compacted) message list for the conversation.
   * If infinite context is disabled, returns null (caller should use original messages).
   */
  async compactIfNeeded(
    systemPromptTokens: number,
    memoryBudgetTokens: number,
  ): Promise<ContextMessage[] | null> {
    if (!this.contextWindow?.enabled) return null;
    const mood = this.config.moodProvider();
    const emotionalContext = buildEmotionalContext(
      { valence: mood.valence, arousal: mood.arousal, dominance: mood.dominance },
      'neutral',
    );
    return this.contextWindow.beforeTurn(
      systemPromptTokens,
      memoryBudgetTokens,
      emotionalContext,
    );
  }

  /** Get the rolling summary chain text for prompt injection. */
  getSummaryContext(): string {
    return this.contextWindow?.getSummaryContext() ?? '';
  }

  /** Get context window transparency stats. */
  getContextWindowStats(): ContextWindowStats | null {
    return this.contextWindow?.getStats() ?? null;
  }

  /** Get full transparency report (for agent self-inspection or UI). */
  getContextTransparencyReport(): string | null {
    return this.contextWindow?.formatTransparencyReport() ?? null;
  }

  /** Get compaction history for audit/UI. */
  getCompactionHistory(): readonly CompactionEntry[] {
    return this.contextWindow?.getCompactionHistory() ?? [];
  }

  /** Search compaction history for a keyword. */
  searchCompactionHistory(keyword: string): CompactionEntry[] {
    return this.contextWindow?.searchHistory(keyword) ?? [];
  }

  /** Get the context window manager (for advanced usage). */
  getContextWindowManager(): ContextWindowManager | null {
    return this.contextWindow;
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

  /**
   * Total number of memory traces currently resident in the manager's
   * in-memory trace cache. Ergonomic passthrough to
   * {@link MemoryStore.getTraceCount}; used by agentos-bench for
   * memory-footprint telemetry without reaching into `getStore()`.
   */
  getTraceCount(): number {
    this.ensureInitialized();
    return this.store.getTraceCount();
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

  /**
   * Export the full brain state as a JSON string.
   * Delegates to JsonExporter through the MemoryStore's brain.
   * Throws if no brain is attached.
   */
  async exportToString(options?: import('./io/facade/types.js').ExportOptions): Promise<string> {
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
  async importFromString(
    json: string,
    options?: Pick<import('./io/facade/types.js').ImportOptions, 'dedup'>
  ): Promise<import('./io/facade/types.js').ImportResult> {
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
  setHydeRetriever(retriever: HydeRetriever | null): void {
    this.hydeRetriever = retriever;
  }

  /** Get the HyDE retriever if configured, or `null`. */
  getHydeRetriever(): HydeRetriever | null {
    return this.hydeRetriever;
  }

  /**
   * Return the attached neural reranker, or `null` when none is
   * configured. Public read-only accessor for Step-3 bench wiring:
   * the bench constructs a per-case `HybridRetriever` that needs the
   * same reranker the manager uses, without bracket-accessing the
   * private field.
   */
  getRerankerService(): import('../rag/reranking/RerankerService.js').RerankerService | null {
    return this.rerankerService;
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
