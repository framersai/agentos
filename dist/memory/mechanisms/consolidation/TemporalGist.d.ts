/**
 * @fileoverview Temporal Gist Extraction — verbatim-to-gist compression.
 *
 * Cognitive science foundations:
 * - **Fuzzy-trace theory** (Reyna & Brainerd, 1995): Memory encodes two
 *   parallel representations — verbatim (exact detail) and gist (semantic
 *   meaning). Over time, verbatim traces decay faster while gist endures.
 * - **False memory implications** (Brainerd & Reyna, 2002): Gist extraction
 *   can produce meaning-consistent but factually imprecise memories.
 *
 * @module agentos/memory/mechanisms/consolidation/TemporalGist
 */
import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedTemporalGistConfig } from '../types.js';
/**
 * Apply temporal gist extraction to qualifying traces.
 *
 * Old, low-retrieval episodic/semantic traces have their content compressed
 * to core assertions while preserving emotional context and entities.
 *
 * @param traces All active traces (mutated in place for qualifying ones).
 * @param config Resolved temporal gist config.
 * @param llmFn  Optional LLM function for higher-quality gist extraction.
 * @returns Number of traces gisted in this cycle.
 */
export declare function applyTemporalGist(traces: MemoryTrace[], config: ResolvedTemporalGistConfig, llmFn?: (prompt: string) => Promise<string>): Promise<number>;
//# sourceMappingURL=TemporalGist.d.ts.map