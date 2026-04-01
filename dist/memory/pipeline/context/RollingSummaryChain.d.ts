/**
 * RollingSummaryChain — Linked chain of conversation summaries.
 *
 * Each compaction produces a summary node. When the chain itself exceeds
 * its token budget, older nodes are re-summarized into higher-level nodes
 * (summary-of-summaries), forming a tree structure:
 *
 *   [L2: turns 1-300]
 *     ├── [L1: turns 1-120]
 *     │     ├── [L0: turns 1-50]
 *     │     └── [L0: turns 51-120]
 *     └── [L1: turns 121-300]
 *           ├── [L0: turns 121-200]
 *           └── [L0: turns 201-300]
 *
 * The chain head (highest-level summary covering all compacted turns)
 * is always included in the prompt as "conversation so far".
 */
import type { SummaryChainNode } from './types.js';
export declare class RollingSummaryChain {
    private nodes;
    private readonly maxBudgetTokens;
    private readonly llmInvoker?;
    constructor(maxBudgetTokens?: number, llmInvoker?: (prompt: string) => Promise<string>);
    /** Add new leaf nodes from a compaction. */
    addNodes(nodes: SummaryChainNode[]): void;
    /**
     * Collapse the chain if it exceeds the token budget.
     * Merges the oldest leaf nodes into a higher-level summary.
     * Returns any newly created parent nodes.
     */
    collapse(): Promise<SummaryChainNode[]>;
    /** Get the active chain — top-level nodes without parents, sorted by turn range. */
    getActiveChain(): SummaryChainNode[];
    /** Format the chain for inclusion in a prompt. */
    formatForPrompt(): string;
    /** Total tokens across all active (non-absorbed) nodes. */
    getTotalTokens(): number;
    /** Get all nodes (including absorbed children, for audit/UI). */
    getAllNodes(): SummaryChainNode[];
    /** Get the full turn range covered by the chain. */
    getCoveredRange(): [number, number] | null;
    get size(): number;
    /** Active leaves = nodes without a parent, sorted by turn range. */
    private getActiveLeaves;
    /** Merge multiple nodes into a single higher-level summary. */
    private mergeNodes;
    /** Non-LLM fallback: concatenate and truncate to budget. */
    private fallbackMerge;
    /** Reset the chain. */
    clear(): void;
}
//# sourceMappingURL=RollingSummaryChain.d.ts.map