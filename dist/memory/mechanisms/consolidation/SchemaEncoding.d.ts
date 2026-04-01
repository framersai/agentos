/**
 * @fileoverview Schema Encoding — schema-congruent vs. schema-violating detection.
 *
 * Cognitive science foundations:
 * - **Schema theory** (Bartlett, 1932): Memory is reconstructive, guided by
 *   pre-existing organized knowledge structures (schemas).
 * - **Modern neuroscience** (Ghosh & Gilboa, 2014): Medial prefrontal cortex
 *   and hippocampal interactions in schema processing.
 * - **Schema-accelerated consolidation** (Tse et al., 2007): Schema-congruent
 *   information consolidates into neocortical memory dramatically faster.
 *
 * @module agentos/memory/mechanisms/consolidation/SchemaEncoding
 */
import type { MemoryTrace } from '../../core/types.js';
import type { ResolvedSchemaEncodingConfig } from '../types.js';
export interface SchemaEncodingResult {
    isCongruent: boolean;
    clusterId?: string;
    adjustedStrength: number;
}
/**
 * Classify a new trace as schema-congruent or schema-violating and adjust
 * its encoding strength accordingly.
 *
 * Schema-congruent traces (matching existing memory clusters) are encoded
 * more efficiently but with less distinctiveness (0.85x). Schema-violating
 * traces (novel) demand more attention and encode stronger (1.3x).
 *
 * @param trace           The new memory trace (mutated in place).
 * @param traceEmbedding  Embedding vector for the trace content.
 * @param clusterCentroids Map of cluster ID → centroid embedding vector.
 * @param config          Resolved schema encoding config.
 * @returns Classification result with adjusted strength.
 */
export declare function applySchemaEncoding(trace: MemoryTrace, traceEmbedding: number[], clusterCentroids: Map<string, number[]>, config: ResolvedSchemaEncodingConfig): SchemaEncodingResult;
//# sourceMappingURL=SchemaEncoding.d.ts.map