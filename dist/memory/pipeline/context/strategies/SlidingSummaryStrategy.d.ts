/**
 * SlidingSummaryStrategy — Default compaction strategy.
 *
 * Summarizes the oldest N messages into a single paragraph, preserving
 * the most recent K turns raw. Simple, predictable, low latency.
 */
import type { CompactionInput, CompactionResult, ICompactionStrategy, InfiniteContextConfig } from '../../../core/types.js';
export declare class SlidingSummaryStrategy implements ICompactionStrategy {
    readonly name: "sliding";
    private readonly llmInvoker;
    constructor(llmInvoker: (prompt: string) => Promise<string>);
    compact(input: CompactionInput, config: InfiniteContextConfig): Promise<CompactionResult>;
    /** Extract likely entity names from summary text. */
    private extractEntities;
    /** Detect content fragments from compacted messages missing from summary. */
    private detectDropped;
    /** Crude fallback when LLM is unavailable. */
    private fallbackSummary;
    /** No-op result when nothing needs compaction. */
    private noopResult;
}
//# sourceMappingURL=SlidingSummaryStrategy.d.ts.map