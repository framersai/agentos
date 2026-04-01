/**
 * @fileoverview Higher-level reflector that condenses compressed observations
 * into reflections — long-lived insights about user patterns, preferences,
 * capabilities, relationships, and goals.
 *
 * This is the "Reflector" agent in Mastra's agentic memory model. It runs
 * when compressed observations exceed a configurable token threshold
 * (default: 40,000 tokens) and extracts higher-level patterns that transcend
 * individual conversation turns.
 *
 * Each {@link Reflection} carries a pattern type classifier, confidence score,
 * source provenance, and temporal span metadata.
 *
 * @module agentos/memory/observation/ObservationReflector
 */
import { relativeTimeLabel } from './temporal.js';
// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildReflectorSystemPrompt() {
    return `You are a memory reflector. Your task is to analyze compressed observation summaries and extract higher-level patterns and insights.

Rules:
1. Look for recurring themes, preferences, behavioral patterns, capabilities, relationships, and goals.
2. Each reflection should be a high-level insight that transcends individual observations (1-3 sentences).
3. Assign a pattern type: "preference" (likes/dislikes, style choices), "behavior" (recurring actions, habits), "capability" (skills, knowledge domains), "relationship" (interpersonal dynamics), or "goal" (objectives, intentions, aspirations).
4. Assign a confidence score 0.0-1.0 (how confident are you in this pattern?).
5. Include the IDs of the compressed observations that support each reflection.
6. Aim for high-value insights that would be useful for future interactions.

Output a JSON array of objects:
{
  "insight": "high-level insight text",
  "patternType": "preference|behavior|capability|relationship|goal",
  "confidence": 0.0-1.0,
  "sourceIds": ["cobs_id_1", "cobs_id_2"]
}

Output ONLY a valid JSON array. No markdown, no explanation.`;
}
// ---------------------------------------------------------------------------
// Counter for unique IDs
// ---------------------------------------------------------------------------
let reflectionIdCounter = 0;
// ---------------------------------------------------------------------------
// ObservationReflector
// ---------------------------------------------------------------------------
/**
 * Condenses compressed observations into higher-level reflections.
 *
 * Runs when accumulated compressed observations exceed 40,000 tokens
 * (configurable). Each reflection captures a long-lived pattern such as
 * a user preference, behavioral habit, capability, relationship dynamic,
 * or goal.
 */
export class ObservationReflector {
    /**
     * @param llmInvoker - Function that calls an LLM with (system, user) prompts.
     */
    constructor(llmInvoker) {
        this.llmInvoker = llmInvoker;
    }
    /**
     * Reflect on compressed observations to extract higher-level patterns.
     *
     * @param observations - Compressed observations to reflect on.
     * @returns Array of reflections. Returns empty array on LLM failure.
     */
    async reflect(observations) {
        if (observations.length === 0)
            return [];
        const systemPrompt = buildReflectorSystemPrompt();
        // Format compressed observations for the LLM.
        const userPrompt = observations
            .map((o) => `[${o.id}] (priority=${o.priority}, importance=${o.importance.toFixed(2)}, ref=${o.temporal.relativeLabel}) ${o.summary}`)
            .join('\n');
        try {
            const response = await this.llmInvoker(systemPrompt, userPrompt);
            return this.parseReflections(response, observations);
        }
        catch {
            return [];
        }
    }
    // -------------------------------------------------------------------------
    // Internal parsing
    // -------------------------------------------------------------------------
    /**
     * Parse the LLM response into Reflection objects.
     */
    parseReflections(llmResponse, sourceObservations) {
        const now = Date.now();
        const obsMap = new Map(sourceObservations.map((o) => [o.id, o]));
        const results = [];
        // Try parsing as a JSON array first.
        let parsed;
        try {
            const cleaned = llmResponse
                .replace(/^```json\s*/i, '')
                .replace(/```\s*$/, '')
                .trim();
            parsed = JSON.parse(cleaned);
            if (!Array.isArray(parsed)) {
                parsed = [parsed];
            }
        }
        catch {
            // Fallback: try parsing line by line.
            parsed = [];
            for (const line of llmResponse.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === '[' || trimmed === ']')
                    continue;
                try {
                    const clean = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
                    parsed.push(JSON.parse(clean));
                }
                catch {
                    // Skip malformed lines.
                }
            }
        }
        for (const item of parsed) {
            if (typeof item !== 'object' || item === null)
                continue;
            const obj = item;
            if (typeof obj.insight !== 'string' || !obj.insight)
                continue;
            const validPatternTypes = [
                'preference', 'behavior', 'capability', 'relationship', 'goal',
            ];
            const patternType = validPatternTypes.includes(obj.patternType)
                ? obj.patternType
                : 'behavior';
            const confidence = typeof obj.confidence === 'number'
                ? Math.max(0, Math.min(1, obj.confidence))
                : 0.5;
            const sourceIds = Array.isArray(obj.sourceIds)
                ? obj.sourceIds.filter((id) => typeof id === 'string')
                : [];
            // Compute temporal span from source compressed observations.
            const sourceTimes = [];
            for (const id of sourceIds) {
                const obs = obsMap.get(id);
                if (obs) {
                    sourceTimes.push(obs.temporal.referencedAt);
                    sourceTimes.push(obs.temporal.observedAt);
                }
            }
            // Fallback: use all observations if no specific sources matched.
            if (sourceTimes.length === 0) {
                for (const obs of sourceObservations) {
                    sourceTimes.push(obs.temporal.referencedAt);
                    sourceTimes.push(obs.temporal.observedAt);
                }
            }
            const spanStart = sourceTimes.length > 0 ? Math.min(...sourceTimes) : now;
            const spanEnd = sourceTimes.length > 0 ? Math.max(...sourceTimes) : now;
            // Build a human-friendly span label.
            const spanLabel = this.buildSpanLabel(spanStart, spanEnd, now);
            results.push({
                id: `refl_${Date.now()}_${++reflectionIdCounter}`,
                insight: obj.insight,
                patternType,
                confidence,
                sourceIds,
                temporal: {
                    reflectedAt: now,
                    spanStart,
                    spanEnd,
                    relativeLabel: spanLabel,
                },
            });
        }
        return results;
    }
    /**
     * Build a human-friendly label describing a temporal span.
     *
     * @param start - Earliest timestamp in the span (Unix ms).
     * @param end - Latest timestamp in the span (Unix ms).
     * @param now - Current reference time (Unix ms).
     * @returns Label such as "over the past week" or "over the past 3 days".
     */
    buildSpanLabel(start, end, now) {
        const spanMs = end - start;
        const ageMs = now - start;
        const DAY = 24 * 60 * 60 * 1000;
        const WEEK = 7 * DAY;
        // If the span is very short (< 1 day), use the relative label for start.
        if (spanMs < DAY) {
            return relativeTimeLabel(start, now);
        }
        const ageDays = Math.floor(ageMs / DAY);
        if (ageDays <= 1)
            return 'over the past day';
        if (ageDays <= 7)
            return `over the past ${ageDays} days`;
        if (ageDays <= 14)
            return 'over the past week';
        const ageWeeks = Math.floor(ageMs / WEEK);
        if (ageWeeks <= 4)
            return `over the past ${ageWeeks} weeks`;
        const ageMonths = Math.floor(ageDays / 30);
        if (ageMonths <= 1)
            return 'over the past month';
        if (ageMonths <= 12)
            return `over the past ${ageMonths} months`;
        return `over the past ${Math.floor(ageDays / 365)} years`;
    }
}
//# sourceMappingURL=ObservationReflector.js.map