/**
 * @fileoverview Slot-based cognitive working memory (Baddeley's model).
 *
 * Wraps the existing IWorkingMemory interface and adds:
 * - Capacity-limited slots (7±2, personality-modulated)
 * - Activation levels per slot (0-1)
 * - Attention weights and rehearsal
 * - Overflow eviction → episodic encoding callback
 *
 * @module agentos/memory/working/CognitiveWorkingMemory
 */
const DEFAULT_CONFIG = {
    baseCapacity: 7,
    traits: {},
    activationDecayRate: 0.1,
    minActivation: 0.15,
};
// ---------------------------------------------------------------------------
// Personality → capacity modulation
// ---------------------------------------------------------------------------
const clamp01 = (v) => v == null ? 0.5 : Math.max(0, Math.min(1, v));
/**
 * Personality-modulated slot capacity:
 * - High openness → +1 slot (broader attention)
 * - High conscientiousness → -1 slot (deeper focus per slot)
 * - Result clamped to [5, 9] (Miller's 7±2)
 */
function computeCapacity(base, traits) {
    const o = clamp01(traits.openness);
    const c = clamp01(traits.conscientiousness);
    let capacity = base;
    if (o > 0.6)
        capacity += 1;
    if (c > 0.6)
        capacity -= 1;
    return Math.max(5, Math.min(9, capacity));
}
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Cognitive working memory with Baddeley-inspired slot management.
 *
 * Also implements IWorkingMemory for backward compatibility —
 * `get/set/delete/clear/has/size/getAll` delegate to the backing store,
 * while slot management is layered on top.
 */
export class CognitiveWorkingMemory {
    constructor(backing, config) {
        this.slots = new Map();
        this.nextSlotIndex = 0;
        this.backing = backing;
        this.id = backing.id;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.capacity = computeCapacity(this.config.baseCapacity, this.config.traits);
    }
    // =========================================================================
    // IWorkingMemory delegation
    // =========================================================================
    async initialize(gmiInstanceId, config) {
        return this.backing.initialize(gmiInstanceId, config);
    }
    async set(key, value) {
        return this.backing.set(key, value);
    }
    async get(key) {
        return this.backing.get(key);
    }
    async delete(key) {
        return this.backing.delete(key);
    }
    async getAll() {
        return this.backing.getAll();
    }
    async clear() {
        this.slots.clear();
        return this.backing.clear();
    }
    async size() {
        return this.backing.size();
    }
    async has(key) {
        return this.backing.has(key);
    }
    async close() {
        return this.backing.close?.();
    }
    // =========================================================================
    // Cognitive slot management
    // =========================================================================
    /** Current number of occupied slots. */
    getSlotCount() {
        return this.slots.size;
    }
    /** Maximum slot capacity (personality-modulated). */
    getCapacity() {
        return this.capacity;
    }
    /** Get all active slots. */
    getSlots() {
        return Array.from(this.slots.values());
    }
    /** Get a specific slot by ID. */
    getSlot(slotId) {
        return this.slots.get(slotId);
    }
    /**
     * Focus attention on a trace, adding it to working memory.
     * If at capacity, the lowest-activation slot is evicted first.
     *
     * @returns The slot ID assigned to this trace.
     */
    async focus(traceId, initialActivation = 0.8) {
        // Check if this trace already has a slot
        for (const [slotId, slot] of this.slots) {
            if (slot.traceId === traceId) {
                // Refresh activation
                slot.activationLevel = Math.min(1.0, slot.activationLevel + 0.2);
                slot.rehearsalCount++;
                return slotId;
            }
        }
        // Evict if at capacity
        if (this.slots.size >= this.capacity) {
            await this.evictLowestActivation();
        }
        const slotId = `wm-slot-${this.nextSlotIndex++}`;
        const slot = {
            slotId,
            traceId,
            activationLevel: Math.min(1.0, initialActivation),
            enteredAt: Date.now(),
            rehearsalCount: 0,
            attentionWeight: 1.0 / (this.slots.size + 1),
        };
        this.slots.set(slotId, slot);
        this.rebalanceAttention();
        return slotId;
    }
    /**
     * Rehearse a slot (maintenance rehearsal), bumping its activation.
     */
    rehearse(slotId) {
        const slot = this.slots.get(slotId);
        if (!slot)
            return;
        slot.activationLevel = Math.min(1.0, slot.activationLevel + 0.15);
        slot.rehearsalCount++;
    }
    /**
     * Apply per-turn activation decay to all slots.
     * Slots that drop below minActivation become eviction candidates.
     */
    async decayActivations() {
        const evicted = [];
        for (const [slotId, slot] of this.slots) {
            slot.activationLevel = Math.max(0, slot.activationLevel - this.config.activationDecayRate);
            if (slot.activationLevel < this.config.minActivation) {
                await this.evictSlot(slotId);
                evicted.push(slotId);
            }
        }
        if (evicted.length > 0) {
            this.rebalanceAttention();
        }
        return evicted;
    }
    /**
     * Get working memory utilisation (0-1).
     */
    getUtilization() {
        return this.slots.size / this.capacity;
    }
    /**
     * Serialise current slots as a formatted string for prompt injection.
     */
    formatForPrompt() {
        if (this.slots.size === 0)
            return '';
        const lines = [];
        const sorted = Array.from(this.slots.values())
            .sort((a, b) => b.activationLevel - a.activationLevel);
        for (const slot of sorted) {
            const focus = slot.activationLevel > 0.7 ? '[ACTIVE]' : slot.activationLevel > 0.4 ? '[fading]' : '[weak]';
            lines.push(`- ${focus} ${slot.traceId} (activation: ${slot.activationLevel.toFixed(2)})`);
        }
        return lines.join('\n');
    }
    // =========================================================================
    // Internal helpers
    // =========================================================================
    async evictLowestActivation() {
        let lowestSlotId = null;
        let lowestActivation = Infinity;
        for (const [slotId, slot] of this.slots) {
            if (slot.activationLevel < lowestActivation) {
                lowestActivation = slot.activationLevel;
                lowestSlotId = slotId;
            }
        }
        if (lowestSlotId) {
            await this.evictSlot(lowestSlotId);
        }
    }
    async evictSlot(slotId) {
        const slot = this.slots.get(slotId);
        if (!slot)
            return;
        if (this.config.onEvict) {
            await this.config.onEvict(slotId, slot.traceId);
        }
        this.slots.delete(slotId);
    }
    rebalanceAttention() {
        const total = this.slots.size;
        if (total === 0)
            return;
        // Distribute attention proportional to activation level
        let totalActivation = 0;
        for (const slot of this.slots.values()) {
            totalActivation += slot.activationLevel;
        }
        if (totalActivation === 0)
            return;
        for (const slot of this.slots.values()) {
            slot.attentionWeight = slot.activationLevel / totalActivation;
        }
    }
}
//# sourceMappingURL=CognitiveWorkingMemory.js.map