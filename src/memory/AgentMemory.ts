/**
 * @fileoverview AgentMemory — high-level facade for the cognitive memory system.
 *
 * Provides a simple, developer-friendly API that wraps CognitiveMemoryManager.
 * Users don't need to know about PAD mood models, HEXACO traits, or internal
 * memory architecture.
 *
 * Usage:
 * ```typescript
 * import { AgentMemory } from '@framers/agentos';
 *
 * // Option A: Wrap an existing CognitiveMemoryManager (wunderland does this)
 * const memory = AgentMemory.wrap(existingManager);
 *
 * // Option B: Create standalone (you provide the manager config)
 * const memory = new AgentMemory(cognitiveMemoryManager);
 * await memory.initialize(config);
 *
 * // Simple API
 * await memory.remember("User prefers dark mode");
 * const results = await memory.recall("what does the user prefer?");
 * await memory.observe('user', "Can you help me with my TMJ?");
 * const context = await memory.getContext("TMJ treatment", { tokenBudget: 2000 });
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
} from './types.js';
import type { PADState, CognitiveMemoryConfig } from './config.js';
import type { ICognitiveMemoryManager } from './CognitiveMemoryManager.js';
import { CognitiveMemoryManager } from './CognitiveMemoryManager.js';
import type { ObservationNote } from './observation/MemoryObserver.js';
import type { ProspectiveMemoryItem } from './prospective/ProspectiveMemoryManager.js';

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
  trace: MemoryTrace;
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

/**
 * High-level memory facade for AI agents.
 *
 * Wraps `ICognitiveMemoryManager` with a simple API that hides
 * PAD mood models, HEXACO traits, and internal architecture.
 */
export class AgentMemory {
  private manager: ICognitiveMemoryManager;
  private _initialized = false;

  constructor(manager?: ICognitiveMemoryManager) {
    this.manager = manager ?? new CognitiveMemoryManager();
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
   * Initialize with full config. Only needed when constructing standalone
   * (not via `AgentMemory.wrap()`).
   */
  async initialize(config: CognitiveMemoryConfig): Promise<void> {
    if (this._initialized) return;
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
      const trace = await this.manager.encode(content, NEUTRAL_MOOD, 'neutral', {
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
      return { trace: null as unknown as MemoryTrace, success: false };
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
    const result = await this.manager.retrieve(query, NEUTRAL_MOOD, {
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
    return this.manager.registerProspective?.(input) ?? null;
  }

  /** List active reminders. */
  async reminders(): Promise<ProspectiveMemoryItem[]> {
    this.ensureReady();
    return this.manager.listProspective?.() ?? [];
  }

  /** Run consolidation cycle. */
  async consolidate(): Promise<void> {
    this.ensureReady();
    await this.manager.runConsolidation?.();
  }

  /** Memory health diagnostics. */
  async health(): Promise<MemoryHealthReport> {
    this.ensureReady();
    return this.manager.getMemoryHealth();
  }

  /** Shutdown and release resources. */
  async shutdown(): Promise<void> {
    if (!this._initialized) return;
    await this.manager.shutdown();
    this._initialized = false;
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Access the underlying manager for advanced usage. */
  get raw(): ICognitiveMemoryManager {
    return this.manager;
  }

  private ensureReady(): void {
    if (!this._initialized) {
      throw new Error('AgentMemory not initialized. Call await memory.initialize(config) or use AgentMemory.wrap().');
    }
  }
}
