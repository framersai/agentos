/**
 * @fileoverview Prospective Memory Manager — goal/intention-triggered reminders.
 *
 * Prospective memory = memory for future intentions (e.g., "remind me to...",
 * "I need to...", "when X happens, do Y").
 *
 * Trigger types:
 * - time_based: Fires at or after a specified timestamp
 * - event_based: Fires when a named event occurs
 * - context_based: Fires when semantic similarity to a cue exceeds threshold
 *
 * Checked each turn before prompt construction. Triggered items are
 * injected into the "Reminders" section of the assembled memory context.
 *
 * @module agentos/memory/prospective/ProspectiveMemoryManager
 */
import type { IEmbeddingManager } from '../../../core/embeddings/IEmbeddingManager.js';
export type ProspectiveTriggerType = 'time_based' | 'event_based' | 'context_based';
export interface ProspectiveMemoryItem {
    id: string;
    /** What the agent should remember to do. */
    content: string;
    /** How this memory is triggered. */
    triggerType: ProspectiveTriggerType;
    /** For time_based: Unix ms when this should fire. */
    triggerAt?: number;
    /** For event_based: event name to match. */
    triggerEvent?: string;
    /** For context_based: embedding of the cue phrase. */
    cueEmbedding?: number[];
    /** For context_based: raw cue text (for display). */
    cueText?: string;
    /** Minimum similarity for context-based triggers. @default 0.7 */
    similarityThreshold?: number;
    /** Importance / priority. */
    importance: number;
    /** Whether this has been triggered and delivered. */
    triggered: boolean;
    /** Whether to re-trigger (recurring). */
    recurring: boolean;
    /** Creation timestamp. */
    createdAt: number;
    /** Source trace ID (if linked to a memory trace). */
    sourceTraceId?: string;
}
export declare class ProspectiveMemoryManager {
    private items;
    private embeddingManager?;
    constructor(embeddingManager?: IEmbeddingManager);
    /**
     * Register a new prospective memory item.
     */
    register(input: Omit<ProspectiveMemoryItem, 'id' | 'triggered' | 'createdAt' | 'cueEmbedding'> & {
        cueText?: string;
    }): Promise<ProspectiveMemoryItem>;
    /**
     * Check all prospective memories against the current context.
     * Returns items that should fire this turn.
     */
    check(context: {
        now?: number;
        events?: string[];
        queryText?: string;
        queryEmbedding?: number[];
    }): Promise<ProspectiveMemoryItem[]>;
    /**
     * Remove a prospective memory item.
     */
    remove(id: string): boolean;
    /**
     * Get all active (non-triggered or recurring) items.
     */
    getActive(): ProspectiveMemoryItem[];
    /**
     * Get total item count.
     */
    getCount(): number;
    /**
     * Clear all items.
     */
    clear(): void;
}
//# sourceMappingURL=ProspectiveMemoryManager.d.ts.map