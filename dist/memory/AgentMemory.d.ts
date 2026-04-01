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
import type { MemoryTrace, MemoryType, MemoryScope, MemorySourceType, ScoredMemoryTrace, AssembledMemoryContext, MemoryHealthReport, CognitiveRetrievalResult } from './core/types.js';
import type { CognitiveMemoryConfig } from './core/config.js';
import type { ICognitiveMemoryManager } from './CognitiveMemoryManager.js';
import type { ObservationNote } from './pipeline/observation/MemoryObserver.js';
import type { ProspectiveMemoryItem } from './retrieval/prospective/ProspectiveMemoryManager.js';
import { Memory as StandaloneMemory } from './io/facade/Memory.js';
import type { MemoryConfig, IngestOptions, IngestResult, ExportOptions, ImportOptions, ImportResult } from './io/facade/types.js';
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
type StandaloneMemoryBackend = Pick<StandaloneMemory, 'remember' | 'recall' | 'consolidate' | 'health' | 'close' | 'ingest' | 'importFrom' | 'export' | 'feedback'>;
/**
 * High-level memory facade for AI agents.
 *
 * Wraps either `ICognitiveMemoryManager` or the standalone `Memory` facade
 * with a simple API that hides PAD mood models, HEXACO traits, SQLite
 * storage details, and internal architecture.
 */
export declare class AgentMemory {
    private manager?;
    private standalone?;
    private _initialized;
    constructor(backend?: ICognitiveMemoryManager | StandaloneMemoryBackend);
    /**
     * Create an AgentMemory wrapping an existing CognitiveMemoryManager.
     * Use this in wunderland where the manager is already constructed.
     */
    static wrap(manager: ICognitiveMemoryManager): AgentMemory;
    /**
     * Create an AgentMemory wrapping the standalone SQLite-first Memory facade.
     */
    static wrapMemory(memory: StandaloneMemoryBackend): AgentMemory;
    /**
     * Create an initialized SQLite-backed AgentMemory for standalone usage.
     */
    static sqlite(config?: MemoryConfig): Promise<AgentMemory>;
    /**
     * Initialize the cognitive-manager path. Only needed when constructing the
     * legacy cognitive backend directly (not via `AgentMemory.wrap()` or
     * `AgentMemory.sqlite()`).
     */
    initialize(config: CognitiveMemoryConfig): Promise<void>;
    /**
     * Store information in long-term memory.
     *
     * @example
     * await memory.remember("User prefers dark mode");
     * await memory.remember("Deploy by Friday", { type: 'prospective', tags: ['deadline'] });
     */
    remember(content: string, options?: {
        type?: MemoryType;
        scope?: MemoryScope;
        scopeId?: string;
        sourceType?: MemorySourceType;
        tags?: string[];
        entities?: string[];
        importance?: number;
    }): Promise<RememberResult>;
    /**
     * Recall memories relevant to a query.
     *
     * @example
     * const results = await memory.recall("what does the user prefer?");
     * for (const m of results.memories) {
     *   console.log(m.content, m.retrievalScore);
     * }
     */
    recall(query: string, options?: SearchOptions): Promise<RecallResult>;
    /**
     * Search memories (alias for recall with simpler return).
     */
    search(query: string, options?: SearchOptions): Promise<ScoredMemoryTrace[]>;
    /**
     * Feed a conversation turn to the observational memory system.
     * The Observer creates dense notes when the token threshold is reached.
     *
     * @example
     * await memory.observe('user', "Can you help me debug this?");
     * await memory.observe('assistant', "Sure! The issue is in your useEffect...");
     */
    observe(role: 'user' | 'assistant' | 'system' | 'tool', content: string): Promise<ObservationNote[] | null>;
    /**
     * Get assembled memory context for prompt injection within a token budget.
     */
    getContext(query: string, options?: {
        tokenBudget?: number;
    }): Promise<AssembledMemoryContext>;
    /**
     * Register a prospective memory (reminder/intention).
     */
    remind(input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
        cueText?: string;
    }): Promise<ProspectiveMemoryItem | null>;
    /** List active reminders. */
    reminders(): Promise<ProspectiveMemoryItem[]>;
    /** Run consolidation cycle. */
    consolidate(): Promise<void>;
    /** Memory health diagnostics. */
    health(): Promise<MemoryHealthReport>;
    /** Shutdown and release resources. */
    shutdown(): Promise<void>;
    /**
     * Ingest files, directories, or URLs. Available only when backed by the
     * standalone SQLite-first Memory facade.
     */
    ingest(source: string, options?: IngestOptions): Promise<IngestResult>;
    /**
     * Import previously exported memory data. Available only when backed by the
     * standalone SQLite-first Memory facade.
     */
    importFrom(source: string, options?: ImportOptions): Promise<ImportResult>;
    /**
     * Export memory data. Available only when backed by the standalone
     * SQLite-first Memory facade.
     */
    export(outputPath: string, options?: ExportOptions): Promise<void>;
    /**
     * Record used/ignored retrieval feedback. Available only when backed by the
     * standalone SQLite-first Memory facade.
     */
    feedback(traceId: string, signal: 'used' | 'ignored', query?: string): void;
    get isInitialized(): boolean;
    /** Access the underlying manager for advanced usage. */
    get raw(): ICognitiveMemoryManager;
    /** Access the underlying standalone Memory facade for advanced usage. */
    get rawMemory(): StandaloneMemoryBackend | undefined;
    private ensureReady;
    private recallFromStandalone;
    private mapStandaloneHealth;
    private throwUnsupportedForStandalone;
    private throwUnsupportedForCognitive;
}
export {};
//# sourceMappingURL=AgentMemory.d.ts.map