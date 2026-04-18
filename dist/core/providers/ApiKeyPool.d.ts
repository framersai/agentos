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
/** Configuration for an ApiKeyPool instance. */
export interface ApiKeyPoolConfig {
    /** Cooldown before retrying an exhausted key. Default: 15 minutes. */
    cooldownMs?: number;
    /** Weight multiplier for the first key. Default: 2. Set to 1 for equal weighting. */
    primaryWeight?: number;
}
export declare class ApiKeyPool {
    private readonly keys;
    private readonly weightedSlots;
    private slotIndex;
    private readonly cooldownMs;
    constructor(keys: string | string[], config?: ApiKeyPoolConfig);
    /** Number of keys in the pool (including temporarily exhausted ones). */
    get size(): number;
    /** Whether any key exists at all. */
    get hasKeys(): boolean;
    /**
     * Get the next available key via weighted round-robin.
     * Skips keys currently in cooldown. Returns empty string if pool is empty.
     */
    next(): string;
    /**
     * Mark a key as quota-exhausted. It will be skipped during
     * rotation until the cooldown expires.
     */
    markExhausted(key: string): void;
}
//# sourceMappingURL=ApiKeyPool.d.ts.map