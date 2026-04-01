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
import { sha256 } from '../../core/util/crossPlatformCrypto.js';
const DAY_MS = 86400000;
/** Maximum gists per consolidation cycle to prevent runaway compression. */
const MAX_GISTS_PER_CYCLE = 20;
/** Flashbulb-grade encoding strength threshold. */
const FLASHBULB_STRENGTH = 0.9;
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
// ---------------------------------------------------------------------------
// Gist extraction
// ---------------------------------------------------------------------------
/**
 * Truncate content to first N words + emotion label.
 * Used as fallback when no LLM is available.
 */
function truncateToGist(content, emotion, maxWords = 30) {
    const words = content.split(/\s+/).slice(0, maxWords);
    const truncated = words.join(' ');
    const suffix = words.length < content.split(/\s+/).length ? '...' : '';
    return `${truncated}${suffix} [${emotion}]`;
}
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
export async function applyTemporalGist(traces, config, llmFn) {
    if (!config.enabled)
        return 0;
    const now = Date.now();
    const minAge = config.ageThresholdDays * DAY_MS;
    let gistedCount = 0;
    for (const trace of traces) {
        if (gistedCount >= MAX_GISTS_PER_CYCLE)
            break;
        // Only gist episodic and semantic types
        if (trace.type !== 'episodic' && trace.type !== 'semantic')
            continue;
        // Skip inactive traces
        if (!trace.isActive)
            continue;
        // Skip traces that aren't old enough
        if ((now - trace.createdAt) < minAge)
            continue;
        // Skip frequently-retrieved traces
        if (trace.retrievalCount >= config.minRetrievalCount)
            continue;
        // Skip flashbulb-grade traces
        if (trace.encodingStrength >= FLASHBULB_STRENGTH)
            continue;
        // Skip already-gisted traces
        const meta = getMeta(trace);
        if (meta.gisted)
            continue;
        // Store original content hash for audit
        const originalHash = await sha256(trace.content);
        // Extract gist
        let gist;
        if (llmFn) {
            const entityHint = trace.entities.length > 0
                ? `Entities: ${trace.entities.join(', ')}.`
                : '';
            const prompt = [
                'Extract 2-3 core assertions from this memory. Keep it under 50 words.',
                entityHint,
                config.preserveEntities ? 'Preserve entity names.' : '',
                `Memory: "${trace.content}"`,
            ].filter(Boolean).join('\n');
            try {
                gist = await llmFn(prompt);
            }
            catch {
                // Fallback to truncation on LLM failure
                gist = truncateToGist(trace.content, trace.emotionalContext.gmiMood);
            }
        }
        else {
            gist = truncateToGist(trace.content, trace.emotionalContext.gmiMood);
        }
        // Apply gist
        trace.content = gist;
        trace.encodingStrength *= 0.8; // verbatim detail loss weakens the trace
        // Record in metadata
        meta.gisted = true;
        meta.originalContentHash = originalHash;
        gistedCount++;
    }
    return gistedCount;
}
//# sourceMappingURL=TemporalGist.js.map