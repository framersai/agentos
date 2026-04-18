/**
 * @module core/providers/ApiKeyPool
 *
 * Weighted round-robin API key pool with quota-exhaustion cooldown.
 *
 * Accepts a single key or comma-separated keys. The first key gets
 * higher rotation weight (configurable). Exhausted keys are temporarily
 * removed from rotation and re-enter after a cooldown period.
 *
 * This is a core AgentOS primitive -- every provider that accepts an
 * API key can use it for automatic multi-key rotation and failover.
 *
 * @example
 * ```ts
 * // Single key (backward compatible, zero overhead):
 * const pool = new ApiKeyPool('sk_abc');
 * pool.next(); // 'sk_abc'
 *
 * // Multiple keys with round-robin + first-key priority:
 * const pool = new ApiKeyPool('sk_primary,sk_backup,sk_overflow');
 * pool.next(); // weighted rotation, primary selected ~2x more
 *
 * // Mark exhausted on quota error:
 * pool.markExhausted(key); // skipped for 15min cooldown
 * pool.next(); // returns next available key
 * ```
 */
const DEFAULT_COOLDOWN_MS = 15 * 60000;
const DEFAULT_PRIMARY_WEIGHT = 2;
export class ApiKeyPool {
    constructor(keys, config) {
        this.slotIndex = 0;
        this.cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        const primaryWeight = config?.primaryWeight ?? DEFAULT_PRIMARY_WEIGHT;
        const keyList = Array.isArray(keys)
            ? keys
            : keys.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
        this.keys = keyList.map((key) => ({ key, exhaustedUntil: 0 }));
        // Build weighted slot array: first key appears `primaryWeight` times, rest once each.
        this.weightedSlots = [];
        for (let i = 0; i < this.keys.length; i++) {
            const times = i === 0 ? primaryWeight : 1;
            for (let t = 0; t < times; t++) {
                this.weightedSlots.push(i);
            }
        }
    }
    /** Number of keys in the pool (including temporarily exhausted ones). */
    get size() {
        return this.keys.length;
    }
    /** Whether any key exists at all. */
    get hasKeys() {
        return this.keys.length > 0;
    }
    /**
     * Get the next available key via weighted round-robin.
     * Skips keys currently in cooldown. Returns empty string if pool is empty.
     */
    next() {
        if (this.keys.length === 0)
            return '';
        if (this.keys.length === 1)
            return this.keys[0].key;
        const now = Date.now();
        const totalSlots = this.weightedSlots.length;
        for (let i = 0; i < totalSlots; i++) {
            const slotIdx = (this.slotIndex + i) % totalSlots;
            const keyIdx = this.weightedSlots[slotIdx];
            const state = this.keys[keyIdx];
            if (state.exhaustedUntil <= now) {
                this.slotIndex = (slotIdx + 1) % totalSlots;
                return state.key;
            }
        }
        // All keys exhausted -- return the one whose cooldown expires soonest.
        const sorted = [...this.keys].sort((a, b) => a.exhaustedUntil - b.exhaustedUntil);
        return sorted[0].key;
    }
    /**
     * Mark a key as quota-exhausted. It will be skipped during
     * rotation until the cooldown expires.
     */
    markExhausted(key) {
        const state = this.keys.find((k) => k.key === key);
        if (state) {
            state.exhaustedUntil = Date.now() + this.cooldownMs;
        }
    }
}
//# sourceMappingURL=ApiKeyPool.js.map