/**
 * @module core/providers/ApiKeyPoolRegistry
 *
 * Singleton registry for API key pools keyed by environment variable name.
 * Providers that share the same env var (e.g., all ElevenLabs providers
 * share ELEVENLABS_API_KEY) get the same pool instance so exhaustion
 * state is consistent across the process.
 */
import { ApiKeyPool } from './ApiKeyPool.js';
const pools = new Map();
/**
 * Get or create an ApiKeyPool for the given environment variable.
 * Returns a singleton -- the same pool is returned on subsequent calls
 * with the same env var name.
 */
export function getKeyPool(envVar, config) {
    let pool = pools.get(envVar);
    if (!pool) {
        pool = new ApiKeyPool(process.env[envVar] ?? '', config);
        pools.set(envVar, pool);
    }
    return pool;
}
/** Reset all pools. For testing only. */
export function resetAllPools() {
    pools.clear();
}
//# sourceMappingURL=ApiKeyPoolRegistry.js.map