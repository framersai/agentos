/**
 * HybridStrategy — Best-quality compaction using the full cognitive memory pipeline.
 *
 * Combines three approaches:
 * 1. MemoryObserver — personality-biased note extraction from conversation
 * 2. MemoryReflector — consolidation of notes into typed long-term traces
 * 3. Rolling summary — narrative continuity via SlidingSummaryStrategy
 *
 * Produces both a readable summary AND long-term memory traces, giving
 * the agent both narrative context and structured recall.
 */
import type { MemoryObserver } from '../../observation/MemoryObserver.js';
import type { MemoryReflector } from '../../observation/MemoryReflector.js';
import type { CompactionInput, CompactionResult, ICompactionStrategy, InfiniteContextConfig } from '../../../core/types.js';
export declare class HybridStrategy implements ICompactionStrategy {
    readonly name: "hybrid";
    private readonly llmInvoker;
    private readonly observer?;
    private readonly reflector?;
    constructor(llmInvoker: (prompt: string) => Promise<string>, observer?: MemoryObserver, reflector?: MemoryReflector);
    compact(input: CompactionInput, config: InfiniteContextConfig): Promise<CompactionResult>;
    private generateHybridSummary;
    private extractEntities;
    private noopResult;
}
//# sourceMappingURL=HybridStrategy.d.ts.map