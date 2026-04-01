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
// ---------------------------------------------------------------------------
// Cosine similarity (inlined to avoid import dependency on rag/utils)
// ---------------------------------------------------------------------------
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------
function getMeta(trace) {
    if (!trace.structuredData)
        trace.structuredData = {};
    if (!trace.structuredData.mechanismMetadata) {
        trace.structuredData.mechanismMetadata = {};
    }
    return trace.structuredData.mechanismMetadata;
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
export function applySchemaEncoding(trace, traceEmbedding, clusterCentroids, config) {
    if (!config.enabled || clusterCentroids.size === 0) {
        return { isCongruent: false, adjustedStrength: trace.encodingStrength };
    }
    // Find nearest cluster centroid
    let bestSim = -1;
    let bestClusterId = '';
    for (const [clusterId, centroid] of clusterCentroids) {
        const sim = cosineSimilarity(traceEmbedding, centroid);
        if (sim > bestSim) {
            bestSim = sim;
            bestClusterId = clusterId;
        }
    }
    const meta = getMeta(trace);
    if (bestSim >= config.clusterSimilarityThreshold) {
        // Schema-congruent: efficient encoding, less distinctive
        trace.encodingStrength *= config.congruencyDiscount;
        meta.schemaCongruent = true;
        meta.schemaViolating = false;
        meta.schemaClusterId = bestClusterId;
        return {
            isCongruent: true,
            clusterId: bestClusterId,
            adjustedStrength: trace.encodingStrength,
        };
    }
    else {
        // Schema-violating: novel input, stronger encoding
        trace.encodingStrength = Math.min(1.0, trace.encodingStrength * config.noveltyBoost);
        meta.schemaCongruent = false;
        meta.schemaViolating = true;
        return {
            isCongruent: false,
            adjustedStrength: trace.encodingStrength,
        };
    }
}
//# sourceMappingURL=SchemaEncoding.js.map