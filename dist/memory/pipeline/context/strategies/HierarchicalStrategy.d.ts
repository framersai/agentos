/**
 * HierarchicalStrategy — Multi-level summary tree for very long conversations.
 *
 * Maintains 4 levels of compression:
 *   L0: Raw messages (last N turns)
 *   L1: Per-segment summaries (~50 turns each)
 *   L2: Per-session summaries (merges L1 nodes)
 *   L3: Overall conversation summary (single node)
 *
 * Each level compresses ~5-10x, giving total compression of up to 1000x
 * for multi-day conversations.
 */
import type { CompactionInput, CompactionResult, ICompactionStrategy, InfiniteContextConfig } from '../../../core/types.js';
export declare class HierarchicalStrategy implements ICompactionStrategy {
    readonly name: "hierarchical";
    private readonly llmInvoker;
    constructor(llmInvoker: (prompt: string) => Promise<string>);
    compact(input: CompactionInput, config: InfiniteContextConfig): Promise<CompactionResult>;
    private createL0Summary;
    private mergeLevel;
    private extractEntitiesFromText;
    private collectEntities;
    private noopResult;
}
//# sourceMappingURL=HierarchicalStrategy.d.ts.map