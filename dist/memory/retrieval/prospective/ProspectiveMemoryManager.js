/**
 * @fileoverview Prospective Memory Manager — goal/intention-triggered reminders.
 *
 * Prospective memory = memory for future intentions (e.g., "remind me to...",
 * "I need to...", "when X happens, do Y").
 *
 * Trigger types:
 * - time_based: Fires at or after a specified timestamp
 * - event_based: Fires when a named event occurs
 * - context_based: Fires when semantic similarity to a cue exceeds threshold
 *
 * Checked each turn before prompt construction. Triggered items are
 * injected into the "Reminders" section of the assembled memory context.
 *
 * @module agentos/memory/prospective/ProspectiveMemoryManager
 */
// ---------------------------------------------------------------------------
// ProspectiveMemoryManager
// ---------------------------------------------------------------------------
let pmIdCounter = 0;
export class ProspectiveMemoryManager {
    constructor(embeddingManager) {
        this.items = new Map();
        this.embeddingManager = embeddingManager;
    }
    /**
     * Register a new prospective memory item.
     */
    async register(input) {
        const id = `pm_${Date.now()}_${++pmIdCounter}`;
        let cueEmbedding;
        if (input.triggerType === 'context_based' && input.cueText && this.embeddingManager) {
            const resp = await this.embeddingManager.generateEmbeddings({ texts: input.cueText });
            cueEmbedding = resp.embeddings[0];
        }
        const item = {
            ...input,
            id,
            cueEmbedding,
            triggered: false,
            createdAt: Date.now(),
        };
        this.items.set(id, item);
        return item;
    }
    /**
     * Check all prospective memories against the current context.
     * Returns items that should fire this turn.
     */
    async check(context) {
        const now = context.now ?? Date.now();
        const triggered = [];
        for (const item of this.items.values()) {
            if (item.triggered && !item.recurring)
                continue;
            let shouldFire = false;
            switch (item.triggerType) {
                case 'time_based':
                    if (item.triggerAt && now >= item.triggerAt) {
                        shouldFire = true;
                    }
                    break;
                case 'event_based':
                    if (item.triggerEvent && context.events?.includes(item.triggerEvent)) {
                        shouldFire = true;
                    }
                    break;
                case 'context_based':
                    if (item.cueEmbedding && context.queryEmbedding) {
                        const similarity = cosineSimilarity(item.cueEmbedding, context.queryEmbedding);
                        if (similarity >= (item.similarityThreshold ?? 0.7)) {
                            shouldFire = true;
                        }
                    }
                    break;
            }
            if (shouldFire) {
                item.triggered = true;
                triggered.push(item);
            }
        }
        // Sort by importance descending
        triggered.sort((a, b) => b.importance - a.importance);
        return triggered;
    }
    /**
     * Remove a prospective memory item.
     */
    remove(id) {
        return this.items.delete(id);
    }
    /**
     * Get all active (non-triggered or recurring) items.
     */
    getActive() {
        return Array.from(this.items.values()).filter((item) => !item.triggered || item.recurring);
    }
    /**
     * Get total item count.
     */
    getCount() {
        return this.items.size;
    }
    /**
     * Clear all items.
     */
    clear() {
        this.items.clear();
    }
}
// ---------------------------------------------------------------------------
// Utility
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
//# sourceMappingURL=ProspectiveMemoryManager.js.map