/**
 * ContextWindowManager — Lifecycle orchestrator for infinite context conversations.
 *
 * Sits between the conversation loop and the LLM call. Before each turn:
 * 1. Tracks all messages and their token costs
 * 2. Checks if context window is approaching capacity
 * 3. Triggers compaction when threshold is reached
 * 4. Replaces old messages with compressed summaries
 * 5. Logs every compaction with full transparency
 * 6. Encodes important content as long-term memory traces
 *
 * The manager maintains a rolling summary chain so the agent always has
 * narrative context from the full conversation history.
 */
import type { EmotionalContext, MemoryTrace } from '../../core/types.js';
import { CompactionEngine } from './CompactionEngine.js';
import { CompactionLog, type CompactionLogStats } from './CompactionLog.js';
import type { CompactionEntry, ContextMessage, InfiniteContextConfig, SummaryChainNode } from './types.js';
import type { MemoryObserver } from '../../pipeline/observation/MemoryObserver.js';
import type { MemoryReflector } from '../../pipeline/observation/MemoryReflector.js';
export interface ContextWindowManagerConfig {
    /** Maximum context window size in tokens. */
    maxContextTokens: number;
    /** Infinite context configuration. */
    infiniteContext: Partial<InfiniteContextConfig>;
    /** LLM invoker for summarization. */
    llmInvoker: (prompt: string) => Promise<string>;
    /** Optional: MemoryObserver for hybrid strategy. */
    observer?: MemoryObserver;
    /** Optional: MemoryReflector for hybrid strategy. */
    reflector?: MemoryReflector;
    /** Callback to encode traces into long-term memory. */
    onTracesCreated?: (traces: Partial<MemoryTrace>[]) => Promise<void>;
}
export declare class ContextWindowManager {
    private messages;
    private turnCounter;
    private readonly config;
    private readonly maxContextTokens;
    private readonly engine;
    private readonly log;
    private readonly chain;
    private readonly onTracesCreated?;
    /** Total compactions performed in this session. */
    private compactionCount;
    /** Whether a compaction is currently running (prevent re-entry). */
    private compacting;
    constructor(managerConfig: ContextWindowManagerConfig);
    /**
     * Add a message to the tracked conversation.
     * Call this for every message (user, assistant, system, tool).
     */
    addMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void;
    /**
     * Check whether compaction is needed and perform it if so.
     * Call this BEFORE assembling the prompt for the LLM.
     *
     * Returns the current message list (potentially compacted).
     */
    beforeTurn(systemPromptTokens: number, memoryBudgetTokens: number, emotionalContext?: EmotionalContext): Promise<ContextMessage[]>;
    /**
     * Get the formatted summary chain for injection into the system prompt
     * or as a conversation-history block.
     */
    getSummaryContext(): string;
    /** Get all current messages (including any summary blocks). */
    getMessages(): readonly ContextMessage[];
    /** Get only the raw (non-compacted) messages. */
    getRawMessages(): ContextMessage[];
    /** Current total token estimate across all messages. */
    getCurrentTokens(): number;
    /** Current turn index. */
    getCurrentTurn(): number;
    /** Replace the message list (e.g. after external manipulation). */
    setMessages(messages: ContextMessage[]): void;
    /** Get the compaction log. */
    getLog(): CompactionLog;
    /** Get all compaction entries. */
    getCompactionHistory(): readonly CompactionEntry[];
    /** Get aggregate stats. */
    getStats(): ContextWindowStats;
    /** Get the summary chain for UI display. */
    getSummaryChain(): SummaryChainNode[];
    /** Search the compaction log for a keyword. */
    searchHistory(keyword: string): CompactionEntry[];
    /** Find what happened to a specific turn. */
    findTurnHistory(turnIndex: number): CompactionEntry[];
    /**
     * Format a transparency report for the agent's context.
     * Includes: current state, recent compactions, summary chain.
     */
    formatTransparencyReport(): string;
    /** Reset all state. */
    clear(): void;
    /** Get the compaction engine (for strategy inspection/testing). */
    getEngine(): CompactionEngine;
    /** Whether infinite context is enabled. */
    get enabled(): boolean;
    /** Current config (read-only). */
    getConfig(): Readonly<InfiniteContextConfig>;
}
export interface ContextWindowStats extends CompactionLogStats {
    currentTokens: number;
    maxTokens: number;
    utilization: number;
    currentTurn: number;
    messageCount: number;
    compactedMessageCount: number;
    summaryChainNodes: number;
    summaryChainTokens: number;
    strategy: string;
    enabled: boolean;
}
//# sourceMappingURL=ContextWindowManager.d.ts.map