/**
 * @fileoverview PerspectiveObserver — multi-agent subjective memory encoding.
 *
 * Takes objective events and an array of witnesses, applies gating predicates,
 * then produces per-witness first-person memory traces via LLM rewriting.
 * Each witness's HEXACO traits, current mood, and relationships to entities
 * in the event shape what they notice, feel, and remember.
 *
 * Standalone pipeline stage — sibling to ObservationCompressor and
 * ObservationReflector, not an extension of either.
 *
 * @module agentos/memory/observation/PerspectiveObserver
 * @see {@link ObservationCompressor} for note compression (different job).
 * @see {@link ObservationReflector} for pattern extraction (different job).
 */
import { sha256 } from '../../core/util/crossPlatformCrypto.js';
import { buildPerspectiveSystemPrompt, buildPerspectiveUserPrompt, } from './perspective-prompt.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Multi-agent subjective memory encoder.
 *
 * @example
 * ```ts
 * const observer = new PerspectiveObserver({
 *   llmInvoker: (sys, usr) => callHaiku(sys, usr),
 * });
 * const result = await observer.rewrite(events, witnesses);
 * for (const trace of result.traces) {
 *   await npcBrains.get(trace.witnessId)?.remember(trace.content, {
 *     type: 'episodic',
 *     tags: ['perspective-encoded'],
 *   });
 * }
 * ```
 */
export class PerspectiveObserver {
    constructor(config) {
        this.llmInvoker = config.llmInvoker;
        this.importanceThreshold = config.importanceThreshold ?? 0.3;
        this.batchSize = config.batchSize ?? 10;
    }
    /**
     * Rewrite objective events from each witness's perspective.
     *
     * Applies gating predicates, batches events per witness, invokes the LLM,
     * and returns per-witness subjective traces. Failures fall back to objective
     * encoding with a reason string.
     *
     * @param events - Objective events to rewrite.
     * @param witnesses - Agents who witnessed the events.
     * @returns Subjective traces + fallback records + LLM call count.
     */
    async rewrite(events, witnesses) {
        const traces = [];
        const fallbacks = [];
        let llmCallCount = 0;
        // Pre-compute event hashes
        const eventHashes = new Map();
        for (const event of events) {
            eventHashes.set(event.eventId, await sha256(event.content));
        }
        for (const witness of witnesses) {
            // Gate: tier
            if (witness.tier !== 'important') {
                fallbacks.push({ witnessId: witness.agentId, reason: `Skipped: tier is '${witness.tier}', not 'important'` });
                continue;
            }
            // Gate: filter events by importance and entity overlap
            const qualifying = events.filter((e) => {
                if (e.importance < this.importanceThreshold)
                    return false;
                const witnessEntityNames = new Set(witness.relationships.map((r) => r.entityName.toLowerCase()));
                const eventEntityNames = e.entities.map((n) => n.toLowerCase());
                const hasOverlap = eventEntityNames.some((n) => witnessEntityNames.has(n));
                const witnessNameInEvent = eventEntityNames.includes(witness.agentName.toLowerCase());
                return hasOverlap || witnessNameInEvent;
            });
            if (qualifying.length === 0) {
                const allBelowThreshold = events.every((e) => e.importance < this.importanceThreshold);
                if (allBelowThreshold) {
                    fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: all events below importance threshold' });
                }
                else {
                    fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: no entity overlap with witness relationships' });
                }
                continue;
            }
            // Batch events and invoke LLM per batch
            const systemPrompt = buildPerspectiveSystemPrompt(witness);
            const batches = this.chunk(qualifying, this.batchSize);
            for (const batch of batches) {
                const userPrompt = buildPerspectiveUserPrompt(batch);
                try {
                    const response = await this.llmInvoker(systemPrompt, userPrompt);
                    llmCallCount++;
                    const parsed = this.parseResponse(response, batch.length);
                    if (!parsed) {
                        const reason = response.trim().startsWith('[')
                            ? `Fallback: LLM returned wrong count (expected ${batch.length})`
                            : 'Fallback: LLM response failed to parse as JSON array';
                        fallbacks.push({ witnessId: witness.agentId, reason });
                        continue;
                    }
                    for (let i = 0; i < parsed.length; i++) {
                        const event = batch[i];
                        traces.push({
                            witnessId: witness.agentId,
                            content: parsed[i],
                            sourceEventId: event.eventId,
                            originalEventHash: eventHashes.get(event.eventId) ?? '',
                            perspectiveMetadata: {
                                hexacoSnapshot: { ...witness.hexaco },
                                moodSnapshot: { ...witness.mood },
                                relationshipSnapshot: witness.relationships.map((r) => ({ ...r })),
                            },
                        });
                    }
                }
                catch (err) {
                    llmCallCount++;
                    fallbacks.push({
                        witnessId: witness.agentId,
                        reason: `Fallback: ${err instanceof Error ? err.message : String(err)}`,
                    });
                }
            }
        }
        return { traces, fallbacks, llmCallCount };
    }
    /**
     * Parse LLM response as a JSON array of strings.
     *
     * @param response - Raw LLM response text.
     * @param expectedCount - Number of events in the batch.
     * @returns Parsed string array, or null on failure.
     */
    parseResponse(response, expectedCount) {
        try {
            const cleaned = response.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
            const parsed = JSON.parse(cleaned);
            if (!Array.isArray(parsed))
                return null;
            if (parsed.length !== expectedCount)
                return null;
            if (!parsed.every((item) => typeof item === 'string'))
                return null;
            return parsed;
        }
        catch {
            return null;
        }
    }
    /** Split an array into chunks of `size`. */
    chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }
}
//# sourceMappingURL=PerspectiveObserver.js.map