/**
 * @fileoverview Involuntary Recall — random old memory surfacing.
 *
 * Cognitive science foundations:
 * - **Involuntary autobiographical memory** (Berntsen, 2009): Memories
 *   frequently surface without deliberate retrieval effort, triggered by
 *   contextual cues. These involuntary memories tend to be more
 *   emotionally intense and specific than voluntary retrievals.
 * - **Diary study** (Berntsen & Hall, 2004): Involuntary memories are
 *   predominantly episodic, emotionally charged, and cue-driven.
 *
 * @module agentos/memory/mechanisms/retrieval/InvoluntaryRecall
 */
const DAY_MS = 86400000;
/**
 * Probabilistically select an involuntary memory from the trace pool.
 *
 * Selection is weighted by emotional intensity (`|valence| * arousal`) —
 * emotionally vivid memories surface involuntarily more often, matching
 * empirical findings (Berntsen, 2009).
 *
 * @param allTraces         Full pool of available memory traces.
 * @param alreadyRetrievedIds IDs already in the retrieved set (excluded).
 * @param config            Resolved involuntary recall config.
 * @returns The selected trace, or null if probability check fails or no candidates qualify.
 */
export function selectInvoluntaryMemory(allTraces, alreadyRetrievedIds, config) {
    if (!config.enabled)
        return null;
    // Probability gate
    if (Math.random() >= config.probability)
        return null;
    const now = Date.now();
    const minAge = config.minAgeDays * DAY_MS;
    // Filter candidates: active, old enough, strong enough, not already retrieved
    const candidates = allTraces.filter((t) => t.isActive &&
        !alreadyRetrievedIds.has(t.id) &&
        (now - t.createdAt) > minAge &&
        t.encodingStrength >= config.minStrength);
    if (candidates.length === 0)
        return null;
    // Weighted selection by emotional intensity
    const weights = candidates.map((t) => {
        const intensity = Math.abs(t.emotionalContext.valence) * Math.max(0, t.emotionalContext.arousal);
        return Math.max(0.01, intensity); // floor to avoid zero-weight
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i];
        if (roll <= 0)
            return candidates[i];
    }
    return candidates[candidates.length - 1];
}
//# sourceMappingURL=InvoluntaryRecall.js.map