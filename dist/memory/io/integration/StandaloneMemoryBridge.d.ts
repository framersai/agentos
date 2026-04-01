/**
 * @fileoverview Adapters that let the standalone SQLite-first `Memory`
 * facade participate in AgentOS long-term memory flows.
 *
 * These bridges intentionally use the public `Memory` API so the same memory
 * instance can power:
 * - agent-editable memory tools
 * - prompt-time long-term memory retrieval
 * - rolling-summary persistence
 *
 * @module agentos/memory/integration/StandaloneMemoryBridge
 */
import type { ILongTermMemoryRetriever } from '../../../core/conversation/ILongTermMemoryRetriever.js';
import type { IRollingSummaryMemorySink } from '../../../core/conversation/IRollingSummaryMemorySink.js';
import type { Memory } from '../../io/facade/Memory.js';
type RuntimeStandaloneMemory = Pick<Memory, 'remember' | 'forget'> & Partial<Pick<Memory, 'close'>>;
type FeedbackCapableLongTermMemory = Pick<Memory, 'recall'> & Partial<Pick<Memory, 'feedbackFromResponse'>>;
export interface StandaloneMemoryLongTermRetrieverOptions {
    /**
     * Fallback result limit for scopes that do not have an explicit cap.
     * @default 4
     */
    defaultLimitPerScope?: number;
    /**
     * Conversation-scope cap. `topKByScope` only covers user/persona/org.
     * @default 4
     */
    conversationLimit?: number;
    /**
     * Include markdown headings for each scope block in the returned context.
     * @default true
     */
    includeScopeHeadings?: boolean;
}
export interface StandaloneMemoryRollingSummarySinkOptions {
    /**
     * Tags added to every persisted rolling-memory trace.
     * @default ['agentos', 'long_term_memory']
     */
    baseTags?: string[];
    /**
     * Importance assigned to summary snapshot traces.
     * @default 0.9
     */
    summaryImportance?: number;
    /**
     * Importance assigned to atomic `memory_json` item traces.
     * @default 1.0
     */
    atomicDocImportance?: number;
}
export declare function buildStandaloneMemoryPersonaScopeId(userId: string, personaId: string): string;
export declare function createStandaloneMemoryLongTermRetriever(memory: FeedbackCapableLongTermMemory, options?: StandaloneMemoryLongTermRetrieverOptions): ILongTermMemoryRetriever;
export declare function createStandaloneMemoryRollingSummarySink(memory: RuntimeStandaloneMemory, options?: StandaloneMemoryRollingSummarySinkOptions): IRollingSummaryMemorySink;
export {};
//# sourceMappingURL=StandaloneMemoryBridge.d.ts.map