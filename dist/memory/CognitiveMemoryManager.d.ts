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
import type { MemoryTrace, MemoryType, MemoryScope, CognitiveRetrievalOptions, CognitiveRetrievalResult, AssembledMemoryContext, MemoryHealthReport } from './core/types.js';
import type { CognitiveMemoryConfig, PADState } from './core/config.js';
import { MemoryStore } from './retrieval/store/MemoryStore.js';
import { CognitiveWorkingMemory } from './core/working/CognitiveWorkingMemory.js';
import type { IMemoryGraph } from './retrieval/graph/IMemoryGraph.js';
import { MemoryObserver, type ObservationNote } from './pipeline/observation/MemoryObserver.js';
import { ProspectiveMemoryManager, type ProspectiveMemoryItem } from './retrieval/prospective/ProspectiveMemoryManager.js';
import { type ConsolidationResult } from './pipeline/consolidation/ConsolidationPipeline.js';
import { ContextWindowManager } from './pipeline/context/ContextWindowManager.js';
import type { ContextMessage, CompactionEntry } from './pipeline/context/types.js';
import type { ContextWindowStats } from './pipeline/context/ContextWindowManager.js';
import type { HydeRetriever } from '../rag/HydeRetriever.js';
export interface ICognitiveMemoryManager {
    initialize(config: CognitiveMemoryConfig): Promise<void>;
    /** Encode a new input into a memory trace. Called after each user message. */
    encode(input: string, mood: PADState, gmiMood: string, options?: {
        type?: MemoryType;
        scope?: MemoryScope;
        scopeId?: string;
        sourceType?: MemoryTrace['provenance']['sourceType'];
        contentSentiment?: number;
        tags?: string[];
        entities?: string[];
    }): Promise<MemoryTrace>;
    /** Retrieve relevant memories for a query. Called before prompt construction. */
    retrieve(query: string, mood: PADState, options?: CognitiveRetrievalOptions): Promise<CognitiveRetrievalResult>;
    /** Assemble memory context for prompt injection within a token budget. */
    assembleForPrompt(query: string, tokenBudget: number, mood: PADState, options?: CognitiveRetrievalOptions): Promise<AssembledMemoryContext>;
    /** Feed a message to the observer (Batch 2). Returns notes if threshold reached. */
    observe?(role: 'user' | 'assistant' | 'system' | 'tool', content: string, mood?: PADState): Promise<ObservationNote[] | null>;
    /** Check prospective memory triggers (Batch 2). */
    checkProspective?(context: {
        now?: number;
        events?: string[];
        queryText?: string;
        queryEmbedding?: number[];
    }): Promise<ProspectiveMemoryItem[]>;
    /** Register a new prospective reminder/intention. */
    registerProspective?(input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
        cueText?: string;
    }): Promise<ProspectiveMemoryItem>;
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
    /** Get infinite-context runtime stats when enabled. */
    getContextWindowStats(): ContextWindowStats | null;
    /** Get a human-readable compaction/transparency report when enabled. */
    getContextTransparencyReport(): string | null;
    /** Shutdown and release resources. */
    shutdown(): Promise<void>;
}
export declare class CognitiveMemoryManager implements ICognitiveMemoryManager {
    private config;
    private store;
    private workingMemory;
    private featureDetector;
    private initialized;
    private graph;
    private observer;
    private reflector;
    private prospective;
    private consolidation;
    private contextWindow;
    private mechanismsEngine;
    private rerankerService;
    /**
     * Optional HyDE retriever for hypothesis-driven memory recall.
     *
     * When set and `options.hyde` is `true` on a `retrieve()` call, the manager
     * generates a hypothetical memory trace via LLM and uses that text for the
     * embedding-based memory search. This improves recall for vague or abstract
     * queries (e.g. "that deployment discussion last week").
     */
    private hydeRetriever;
    initialize(config: CognitiveMemoryConfig): Promise<void>;
    encode(input: string, mood: PADState, gmiMood: string, options?: {
        type?: MemoryType;
        scope?: MemoryScope;
        scopeId?: string;
        sourceType?: MemoryTrace['provenance']['sourceType'];
        contentSentiment?: number;
        tags?: string[];
        entities?: string[];
    }): Promise<MemoryTrace>;
    retrieve(query: string, mood: PADState, options?: CognitiveRetrievalOptions): Promise<CognitiveRetrievalResult>;
    assembleForPrompt(query: string, tokenBudget: number, mood: PADState, options?: CognitiveRetrievalOptions): Promise<AssembledMemoryContext>;
    /**
     * Temporal patterns for extracting time-based triggers from observation notes.
     * Matches relative expressions ("tomorrow", "next Friday", "in 2 hours")
     * and absolute expressions ("on March 5th", "at 3pm").
     */
    private static readonly TEMPORAL_PATTERNS;
    /**
     * Event-based patterns for extracting event triggers from observation notes.
     * Matches conditional language ("when X happens", "after the meeting").
     */
    private static readonly EVENT_PATTERNS;
    /**
     * Infer the prospective trigger type from an observation note's content.
     * Uses regex heuristics — no LLM call needed.
     *
     * Priority: temporal patterns (most specific) → event patterns → context-based fallback.
     *
     * @param note - The observation note to classify
     * @returns The most likely trigger type for ProspectiveMemoryManager
     */
    private inferTriggerType;
    /**
     * Extract an event cue string from "when X" / "after X" patterns.
     * Returns undefined if no event language is detected.
     *
     * @param note - The observation note to extract from
     * @returns Event cue string, or undefined
     */
    private extractEventCue;
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
    observe(role: 'user' | 'assistant' | 'system' | 'tool', content: string, mood?: PADState): Promise<ObservationNote[] | null>;
    checkProspective(context: {
        now?: number;
        events?: string[];
        queryText?: string;
        queryEmbedding?: number[];
    }): Promise<ProspectiveMemoryItem[]>;
    registerProspective(input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
        cueText?: string;
    }): Promise<ProspectiveMemoryItem>;
    listProspective(): Promise<ProspectiveMemoryItem[]>;
    removeProspective(id: string): Promise<boolean>;
    runConsolidation(): Promise<ConsolidationResult>;
    getMemoryHealth(): Promise<MemoryHealthReport>;
    /**
     * Track a conversation message for context window management.
     * Call for every user/assistant/system/tool message in the conversation.
     */
    trackMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void;
    /**
     * Run context window compaction if needed. Call BEFORE assembling the LLM prompt.
     * Returns the (potentially compacted) message list for the conversation.
     * If infinite context is disabled, returns null (caller should use original messages).
     */
    compactIfNeeded(systemPromptTokens: number, memoryBudgetTokens: number): Promise<ContextMessage[] | null>;
    /** Get the rolling summary chain text for prompt injection. */
    getSummaryContext(): string;
    /** Get context window transparency stats. */
    getContextWindowStats(): ContextWindowStats | null;
    /** Get full transparency report (for agent self-inspection or UI). */
    getContextTransparencyReport(): string | null;
    /** Get compaction history for audit/UI. */
    getCompactionHistory(): readonly CompactionEntry[];
    /** Search compaction history for a keyword. */
    searchCompactionHistory(keyword: string): CompactionEntry[];
    /** Get the context window manager (for advanced usage). */
    getContextWindowManager(): ContextWindowManager | null;
    shutdown(): Promise<void>;
    getStore(): MemoryStore;
    getWorkingMemory(): CognitiveWorkingMemory;
    getConfig(): CognitiveMemoryConfig;
    getGraph(): IMemoryGraph | null;
    getObserver(): MemoryObserver | null;
    getProspective(): ProspectiveMemoryManager | null;
    /**
     * Export the full brain state as a JSON string.
     * Delegates to JsonExporter through the MemoryStore's brain.
     * Throws if no brain is attached.
     */
    exportToString(options?: import('./io/facade/types.js').ExportOptions): Promise<string>;
    /**
     * Import a JSON brain payload into the attached brain.
     * Delegates to JsonImporter through the MemoryStore's brain.
     * Throws if no brain is attached.
     */
    importFromString(json: string, options?: Pick<import('./io/facade/types.js').ImportOptions, 'dedup'>): Promise<import('./io/facade/types.js').ImportResult>;
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
    setHydeRetriever(retriever: HydeRetriever | null): void;
    /** Get the HyDE retriever if configured, or `null`. */
    getHydeRetriever(): HydeRetriever | null;
    private ensureInitialized;
}
//# sourceMappingURL=CognitiveMemoryManager.d.ts.map