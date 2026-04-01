/**
 * CompactionEngine — Strategy dispatcher for context window compaction.
 *
 * Selects and executes the appropriate compaction strategy based on config.
 * Manages strategy lifecycle and provides a unified interface for the
 * ContextWindowManager.
 */
import { HierarchicalStrategy } from './strategies/HierarchicalStrategy.js';
import { HybridStrategy } from './strategies/HybridStrategy.js';
import { SlidingSummaryStrategy } from './strategies/SlidingSummaryStrategy.js';
export class CompactionEngine {
    constructor(llmInvoker, observer, reflector) {
        this.strategies = new Map();
        this.strategies.set('sliding', new SlidingSummaryStrategy(llmInvoker));
        this.strategies.set('hierarchical', new HierarchicalStrategy(llmInvoker));
        this.strategies.set('hybrid', new HybridStrategy(llmInvoker, observer, reflector));
    }
    /** Run compaction using the configured strategy. */
    async compact(input, config) {
        const strategy = this.strategies.get(config.strategy);
        if (!strategy) {
            throw new Error(`Unknown compaction strategy: ${config.strategy}`);
        }
        return strategy.compact(input, config);
    }
    /** Get a specific strategy instance. */
    getStrategy(name) {
        return this.strategies.get(name);
    }
    /** List available strategy names. */
    getAvailableStrategies() {
        return Array.from(this.strategies.keys());
    }
}
//# sourceMappingURL=CompactionEngine.js.map