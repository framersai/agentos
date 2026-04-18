/**
 * @module core/providers/ApiKeyPoolRegistry
 *
 * Singleton registry for API key pools keyed by environment variable name.
 * Providers that share the same env var (e.g., all ElevenLabs providers
 * share ELEVENLABS_API_KEY) get the same pool instance so exhaustion
 * state is consistent across the process.
 */
import { ApiKeyPool, type ApiKeyPoolConfig } from './ApiKeyPool.js';
/**
 * Get or create an ApiKeyPool for the given environment variable.
 * Returns a singleton -- the same pool is returned on subsequent calls
 * with the same env var name.
 */
export declare function getKeyPool(envVar: string, config?: ApiKeyPoolConfig): ApiKeyPool;
/** Reset all pools. For testing only. */
export declare function resetAllPools(): void;
//# sourceMappingURL=ApiKeyPoolRegistry.d.ts.map