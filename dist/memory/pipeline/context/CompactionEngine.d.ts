/**
 * CompactionEngine — Strategy dispatcher for context window compaction.
 *
 * Selects and executes the appropriate compaction strategy based on config.
 * Manages strategy lifecycle and provides a unified interface for the
 * ContextWindowManager.
 */
import type { MemoryObserver } from '../../pipeline/observation/MemoryObserver.js';
import type { MemoryReflector } from '../../pipeline/observation/MemoryReflector.js';
import type { CompactionInput, CompactionResult, CompactionStrategy, ICompactionStrategy, InfiniteContextConfig } from './types.js';
export declare class CompactionEngine {
    private strategies;
    constructor(llmInvoker: (prompt: string) => Promise<string>, observer?: MemoryObserver, reflector?: MemoryReflector);
    /** Run compaction using the configured strategy. */
    compact(input: CompactionInput, config: InfiniteContextConfig): Promise<CompactionResult>;
    /** Get a specific strategy instance. */
    getStrategy(name: CompactionStrategy): ICompactionStrategy | undefined;
    /** List available strategy names. */
    getAvailableStrategies(): CompactionStrategy[];
}
//# sourceMappingURL=CompactionEngine.d.ts.map