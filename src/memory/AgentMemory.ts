/**
 * @fileoverview AgentMemory — high-level facade spanning both AgentOS memory backends.
 *
 * Provides a simple, developer-friendly API that can either:
 * - wrap `CognitiveMemoryManager` for observer/reflector/prospective workflows, or
 * - wrap the standalone `Memory` facade for SQLite-first local memory.
 *
 * Users don't need to know about PAD mood models, HEXACO traits, SQLite table
 * layout, or the internal memory architecture.
 *
 * Usage:
 * ```typescript
 * import { AgentMemory } from '@framers/agentos';
 *
 * // Option A: Wrap an existing CognitiveMemoryManager (wunderland does this)
 * const cognitive = AgentMemory.wrap(existingManager);
 *
 * // Option B: Create SQLite-backed standalone memory
 * const memory = await AgentMemory.sqlite({ path: './brain.sqlite' });
 *
 * // Simple API
 * await memory.remember("User prefers dark mode");
 * const results = await memory.recall("what does the user prefer?");
 *
 * // Advanced cognitive-only APIs remain available when backed by
 * // CognitiveMemoryManager.
 * await cognitive.observe('user', "Can you help me with my TMJ?");
 * const context = await cognitive.getContext("TMJ treatment", { tokenBudget: 2000 });
 * ```
 *
 * @module agentos/memory/AgentMemory
 */

import type {
  MemoryTrace,
  MemoryType,
  MemoryScope,
  MemorySourceType,
  ScoredMemoryTrace,
  AssembledMemoryContext,
  MemoryHealthReport,
  CognitiveRetrievalResult,
} from './core/types.js';
import type { PADState, CognitiveMemoryConfig } from './core/config.js';
import type { ICognitiveMemoryManager } from './CognitiveMemoryManager.js';
import { CognitiveMemoryManager } from './CognitiveMemoryManager.js';
import type { ObservationNote } from './pipeline/observation/MemoryObserver.js';
import type { ProspectiveMemoryItem } from './retrieval/prospective/ProspectiveMemoryManager.js';
import { Memory as StandaloneMemory } from './io/facade/Memory.js';
import type {
  MemoryConfig,
  IngestOptions,
  IngestResult,
  ExportOptions,
  ImportOptions,
  ImportResult,
  MemoryHealth as StandaloneMemoryHealth,
} from './io/facade/types.js';

// ── Neutral mood (no emotional bias in encoding/retrieval) ──
const NEUTRAL_MOOD: PADState = { valence: 0, arousal: 0, dominance: 0 };

// ── Public types ──

export interface RecallResult {
  /** Relevant memory traces sorted by relevance. */
  memories: ScoredMemoryTrace[];
  /** Partially retrieved traces (tip-of-the-tongue). */
  partial: CognitiveRetrievalResult['partiallyRetrieved'];
  /** Retrieval diagnostics. */
  diagnostics: CognitiveRetrievalResult['diagnostics'];
}

export interface RememberResult {
  /** The stored trace. Undefined when `success` is false. */
  trace?: MemoryTrace;
  success: boolean;
}

export interface SearchOptions {
  /** Maximum results. Default: 10. */
  limit?: number;
  /** Memory type filter. */
  types?: MemoryType[];
  /** Tags filter. */
  tags?: string[];
  /** Minimum confidence. Default: 0. */
  minConfidence?: number;
}

type StandaloneMemoryBackend = Pick<
  StandaloneMemory,
  'remember' | 'recall' | 'consolidate' | 'health' | 'close' | 'ingest' | 'importFrom' | 'export' | 'feedback'
>;

function isStandaloneMemoryBackend(value: unknown): value is StandaloneMemoryBackend {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StandaloneMemoryBackend).remember === 'function' &&
    typeof (value as StandaloneMemoryBackend).recall === 'function' &&
    typeof (value as StandaloneMemoryBackend).close === 'function'
  );
}

/**
 * High-level memory facade for AI agents.
 *
 * Wraps either `ICognitiveMemoryManager` or the standalone `Memory` facade
 * with a simple API that hides PAD mood models, HEXACO traits, SQLite
 * storage details, and internal architecture.
 */
export class AgentMemory {
  private manager?: ICognitiveMemoryManager;
  private standalone?: StandaloneMemoryBackend;
  private _initialized = false;

  constructor(backend?: ICognitiveMemoryManager | StandaloneMemoryBackend) {
    if (isStandaloneMemoryBackend(backend)) {
      this.standalone = backend;
      this._initialized = true;
      return;
    }

    this.manager = backend ?? new CognitiveMemoryManager();
  }

  /**
   * Create an AgentMemory wrapping an existing CognitiveMemoryManager.
   * Use this in wunderland where the manager is already constructed.
   */
  static wrap(manager: ICognitiveMemoryManager): AgentMemory {
    const mem = new AgentMemory(manager);
    mem._initialized = true; // assume the passed manager is already initialized
    return mem;
  }

  /**
   * Create an AgentMemory wrapping the standalone SQLite-first Memory facade.
   */
  static wrapMemory(memory: StandaloneMemoryBackend): AgentMemory {
    return new AgentMemory(memory);
  }

  /**
   * Create an initialized SQLite-backed AgentMemory for standalone usage.
   */
  static async sqlite(config?: MemoryConfig): Promise<AgentMemory> {
    const memory = await StandaloneMemory.create(config);
    return AgentMemory.wrapMemory(memory);
  }

  /**
   * Initialize the cognitive-manager path. Only needed when constructing the
   * legacy cognitive backend directly (not via `AgentMemory.wrap()` or
   * `AgentMemory.sqlite()`).
   */
  async initialize(config: CognitiveMemoryConfig): Promise<void> {
    if (this._initialized) return;
    if (!this.manager) {
      this._initialized = true;
      return;
    }
    await this.manager.initialize(config);
    this._initialized = true;
  }

  /**
   * Store information in long-term memory.
   *
   * @example
   * await memory.remember("User prefers dark mode");
   * await memory.remember("Deploy by Friday", { type: 'prospective', tags: ['deadline'] });
   */
  async remember(
    content: string,
    options?: {
      type?: MemoryType;
      scope?: MemoryScope;
      scopeId?: string;
      sourceType?: MemorySourceType;
      tags?: string[];
      entities?: string[];
      importance?: number;
    },
  ): Promise<RememberResult> {
    this.ensureReady();
    try {
      const trace = this.standalone
        ? await this.standalone.remember(content, {
            type: options?.type ?? 'episodic',
            scope: options?.scope ?? 'thread',
            scopeId: options?.scopeId,
            tags: options?.tags,
            entities: options?.entities,
            importance: options?.importance,
          })
        : await this.manager!.encode(content, NEUTRAL_MOOD, 'neutral', {
            type: options?.type ?? 'episodic',
            scope: options?.scope ?? 'thread',
            scopeId: options?.scopeId,
            sourceType: options?.sourceType ?? 'user_statement',
            tags: options?.tags,
            entities: options?.entities,
            contentSentiment: options?.importance,
          });
      return { trace, success: true };
    } catch {
      return { trace: undefined, success: false };
    }
  }

  /**
   * Recall memories relevant to a query.
   *
   * @example
   * const results = await memory.recall("what does the user prefer?");
   * for (const m of results.memories) {
   *   console.log(m.content, m.retrievalScore);
   * }
   */
  async recall(query: string, options?: SearchOptions): Promise<RecallResult> {
    this.ensureReady();
    if (this.standalone) {
      return this.recallFromStandalone(query, options);
    }

    const result = await this.manager!.retrieve(query, NEUTRAL_MOOD, {
      topK: options?.limit ?? 10,
      types: options?.types,
      tags: options?.tags,
      minConfidence: options?.minConfidence,
    });
    return {
      memories: result.retrieved,
      partial: result.partiallyRetrieved,
      diagnostics: result.diagnostics,
    };
  }

  /**
   * Search memories (alias for recall with simpler return).
   */
  async search(query: string, options?: SearchOptions): Promise<ScoredMemoryTrace[]> {
    const result = await this.recall(query, options);
    return result.memories;
  }

  /**
   * Feed a conversation turn to the observational memory system.
   * The Observer creates dense notes when the token threshold is reached.
   *
   * @example
   * await memory.observe('user', "Can you help me debug this?");
   * await memory.observe('assistant', "Sure! The issue is in your useEffect...");
   */
  async observe(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
  ): Promise<ObservationNote[] | null> {
    this.ensureReady();
    if (!this.manager) {
      this.throwUnsupportedForStandalone('observe');
    }
    return this.manager.observe?.(role, content, NEUTRAL_MOOD) ?? null;
  }

  /**
   * Get assembled memory context for prompt injection within a token budget.
   */
  async getContext(
    query: string,
    options?: { tokenBudget?: number },
  ): Promise<AssembledMemoryContext> {
    this.ensureReady();
    if (!this.manager) {
      this.throwUnsupportedForStandalone('getContext');
    }
    return this.manager.assembleForPrompt(query, options?.tokenBudget ?? 2000, NEUTRAL_MOOD);
  }

  /**
   * Register a prospective memory (reminder/intention).
   */
  async remind(
    input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
      cueText?: string;
    },
  ): Promise<ProspectiveMemoryItem | null> {
    this.ensureReady();
    if (!this.manager) {
      this.throwUnsupportedForStandalone('remind');
    }
    return this.manager.registerProspective?.(input) ?? null;
  }

  /** List active reminders. */
  async reminders(): Promise<ProspectiveMemoryItem[]> {
    this.ensureReady();
    if (!this.manager) {
      this.throwUnsupportedForStandalone('reminders');
    }
    return this.manager.listProspective?.() ?? [];
  }

  /** Run consolidation cycle. */
  async consolidate(): Promise<void> {
    this.ensureReady();
    if (this.standalone) {
      await this.standalone.consolidate();
      return;
    }
    await this.manager?.runConsolidation?.();
  }

  /** Memory health diagnostics. */
  async health(): Promise<MemoryHealthReport> {
    this.ensureReady();
    if (this.standalone) {
      return this.mapStandaloneHealth(await this.standalone.health());
    }
    return this.manager!.getMemoryHealth();
  }

  /** Shutdown and release resources. */
  async shutdown(): Promise<void> {
    if (!this._initialized) return;
    if (this.standalone) {
      await this.standalone.close();
      this._initialized = false;
      return;
    }
    await this.manager?.shutdown();
    this._initialized = false;
  }

  /**
   * Ingest files, directories, or URLs. Available only when backed by the
   * standalone SQLite-first Memory facade.
   */
  async ingest(source: string, options?: IngestOptions): Promise<IngestResult> {
    this.ensureReady();
    if (!this.standalone) {
      this.throwUnsupportedForCognitive('ingest');
    }
    return this.standalone.ingest(source, options);
  }

  /**
   * Import previously exported memory data. Available only when backed by the
   * standalone SQLite-first Memory facade.
   */
  async importFrom(source: string, options?: ImportOptions): Promise<ImportResult> {
    this.ensureReady();
    if (!this.standalone) {
      this.throwUnsupportedForCognitive('importFrom');
    }
    return this.standalone.importFrom(source, options);
  }

  /**
   * Export memory data. Available only when backed by the standalone
   * SQLite-first Memory facade.
   */
  async export(outputPath: string, options?: ExportOptions): Promise<void> {
    this.ensureReady();
    if (!this.standalone) {
      this.throwUnsupportedForCognitive('export');
    }
    await this.standalone.export(outputPath, options);
  }

  /**
   * Record used/ignored retrieval feedback. Available only when backed by the
   * standalone SQLite-first Memory facade.
   */
  feedback(traceId: string, signal: 'used' | 'ignored', query?: string): void {
    this.ensureReady();
    if (!this.standalone) {
      this.throwUnsupportedForCognitive('feedback');
    }
    void this.standalone.feedback(traceId, signal, query);
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Access the underlying manager for advanced usage. */
  get raw(): ICognitiveMemoryManager {
    if (!this.manager) {
      throw new Error(
        'AgentMemory.raw is only available when backed by CognitiveMemoryManager. ' +
        'Use rawMemory for the standalone SQLite-backed Memory facade.',
      );
    }
    return this.manager;
  }

  /** Access the underlying standalone Memory facade for advanced usage. */
  get rawMemory(): StandaloneMemoryBackend | undefined {
    return this.standalone;
  }

  private ensureReady(): void {
    if (!this._initialized) {
      throw new Error(
        'AgentMemory not initialized. Call await memory.initialize(config), ' +
        'use AgentMemory.wrap(existingManager), or create a standalone instance with AgentMemory.sqlite(...).',
      );
    }
  }

  private async recallFromStandalone(query: string, options?: SearchOptions): Promise<RecallResult> {
    const requestedLimit = options?.limit ?? 10;
    const requestedTypes = options?.types ?? [];
    const needsPostFilter =
      requestedTypes.length > 1 ||
      (options?.tags?.length ?? 0) > 0 ||
      options?.minConfidence !== undefined;

    const resultLimit = needsPostFilter
      ? Math.max(requestedLimit * 3, 50)
      : requestedLimit;

    const recalled = await this.standalone!.recall(query, {
      limit: resultLimit,
      ...(requestedTypes.length === 1 ? { type: requestedTypes[0] } : {}),
    });

    const filtered = recalled.filter(({ trace }) => {
      if (requestedTypes.length > 1 && !requestedTypes.includes(trace.type)) {
        return false;
      }
      if ((options?.tags?.length ?? 0) > 0) {
        const traceTags = new Set(trace.tags);
        if (!options!.tags!.every((tag) => traceTags.has(tag))) {
          return false;
        }
      }
      if (
        options?.minConfidence !== undefined &&
        trace.provenance.confidence < options.minConfidence
      ) {
        return false;
      }
      return true;
    });

    return {
      memories: filtered.slice(0, requestedLimit).map(({ trace, score }) => ({
        ...trace,
        retrievalScore: score,
        scoreBreakdown: {
          strengthScore: trace.encodingStrength,
          similarityScore: score,
          recencyScore: 0,
          emotionalCongruenceScore: 0,
          graphActivationScore: 0,
          importanceScore: trace.provenance.confidence,
        },
      })),
      partial: [],
      diagnostics: {
        candidatesScanned: recalled.length,
        vectorSearchTimeMs: 0,
        scoringTimeMs: 0,
        totalTimeMs: 0,
      },
    };
  }

  private mapStandaloneHealth(health: StandaloneMemoryHealth): MemoryHealthReport {
    return {
      totalTraces: health.totalTraces,
      activeTraces: health.activeTraces,
      avgStrength: health.avgStrength,
      weakestTraceStrength: health.weakestTraceStrength,
      workingMemoryUtilization: 0,
      ...(health.lastConsolidation
        ? { lastConsolidationAt: Date.parse(health.lastConsolidation) }
        : {}),
      tracesPerType: {
        episodic: health.tracesPerType.episodic ?? 0,
        semantic: health.tracesPerType.semantic ?? 0,
        procedural: health.tracesPerType.procedural ?? 0,
        prospective: health.tracesPerType.prospective ?? 0,
      },
      tracesPerScope: {
        thread: health.tracesPerScope.thread ?? 0,
        user: health.tracesPerScope.user ?? 0,
        persona: health.tracesPerScope.persona ?? 0,
        organization: health.tracesPerScope.organization ?? 0,
      },
    };
  }

  private throwUnsupportedForStandalone(methodName: string): never {
    throw new Error(
      `AgentMemory.${methodName}() requires a CognitiveMemoryManager-backed instance. ` +
      `Use AgentMemory.wrap(existingManager) for observer, prompt-assembly, and reminder APIs.`,
    );
  }

  private throwUnsupportedForCognitive(methodName: string): never {
    throw new Error(
      `AgentMemory.${methodName}() requires the standalone SQLite-backed Memory facade. ` +
      `Use AgentMemory.sqlite(...) or import { Memory } from '@framers/agentos'.`,
    );
  }
}
