/**
 * @file ProviderPreferences.ts
 * Shared resolver for media provider selection across image, video, and audio
 * subsystems.
 *
 * Provides two complementary mechanisms:
 *
 * 1. **Deterministic ordering** via {@link resolveProviderOrder} — filters and
 *    reorders an "available" list according to user preferences (preferred
 *    providers first, blocked providers removed).
 *
 * 2. **Weighted random selection** via {@link selectWeightedProvider} — picks a
 *    single provider from a resolved list using optional per-provider weights
 *    (useful for load-balancing or A/B testing across providers).
 *
 * These utilities are intentionally stateless and side-effect-free so they can
 * be called from any subsystem without lifecycle concerns.
 *
 * @example
 * ```ts
 * import {
 *   resolveProviderOrder,
 *   resolveProviderChain,
 *   selectWeightedProvider,
 * } from './ProviderPreferences.js';
 *
 * const available = ['openai', 'stability', 'replicate'];
 *
 * // Deterministic: preferred order with blocklist
 * const ordered = resolveProviderOrder(available, {
 *   preferred: ['replicate', 'openai'],
 *   blocked: ['stability'],
 * });
 * // => ['replicate', 'openai']
 *
 * // Weighted primary selection with deterministic fallback ordering
 * const chain = resolveProviderChain(ordered, {
 *   weights: {
 *     replicate: 9,
 *     openai: 1,
 *   },
 * });
 * // => ['replicate', 'openai'] most of the time
 *
 * // Or pick a single weighted provider directly
 * const chosen = selectWeightedProvider(chain, {
 *   replicate: 9,
 *   openai: 1,
 * });
 * ```
 */
// ---------------------------------------------------------------------------
// resolveProviderOrder
// ---------------------------------------------------------------------------
/**
 * Filter and reorder an "available" provider list according to user
 * preferences.
 *
 * Resolution rules (applied in order):
 *
 * 1. If `preferences` is `undefined` or empty, return `available` unchanged.
 * 2. If `preferred` is set, keep only providers that appear in **both**
 *    `available` and `preferred`, preserving the order of `preferred`.
 * 3. If `blocked` is set, remove any provider whose ID appears in `blocked`.
 *
 * The result is never longer than `available` and never contains duplicates.
 *
 * @param available - Provider IDs currently available in the system.
 * @param preferences - Optional preference configuration.
 * @returns Filtered and reordered provider ID list.
 *
 * @example
 * ```ts
 * resolveProviderOrder(['a', 'b', 'c'], { preferred: ['c', 'a'] });
 * // => ['c', 'a']
 *
 * resolveProviderOrder(['a', 'b', 'c'], { blocked: ['b'] });
 * // => ['a', 'c']
 * ```
 */
export function resolveProviderOrder(available, preferences) {
    if (!preferences) {
        return available;
    }
    const blockedSet = new Set(preferences.blocked ?? []);
    // When preferred is specified, reorder to preferred order and keep only
    // providers that are actually available.
    let ordered;
    if (preferences.preferred && preferences.preferred.length > 0) {
        const availableSet = new Set(available);
        ordered = preferences.preferred.filter((id) => availableSet.has(id));
    }
    else {
        ordered = [...available];
    }
    // Remove blocked providers.
    if (blockedSet.size > 0) {
        ordered = ordered.filter((id) => !blockedSet.has(id));
    }
    return ordered;
}
// ---------------------------------------------------------------------------
// resolveProviderChain
// ---------------------------------------------------------------------------
/**
 * Resolve a full provider chain from the available providers and preferences.
 *
 * This combines deterministic filtering/reordering via
 * {@link resolveProviderOrder} with optional weighted primary selection via
 * {@link selectWeightedProvider}. When `weights` are present, a single primary
 * provider is chosen from the ordered list and moved to the front while the
 * remaining providers preserve their relative order as fallbacks.
 *
 * @param available - Provider IDs currently available in the system.
 * @param preferences - Optional preference configuration.
 * @returns Ordered provider chain with the chosen primary first.
 */
export function resolveProviderChain(available, preferences) {
    const ordered = resolveProviderOrder(available, preferences);
    if (ordered.length <= 1 || !preferences?.weights) {
        return ordered;
    }
    const primary = selectWeightedProvider(ordered, preferences.weights);
    return [primary, ...ordered.filter((id) => id !== primary)];
}
// ---------------------------------------------------------------------------
// selectWeightedProvider
// ---------------------------------------------------------------------------
/**
 * Select a single provider from a list using optional per-provider weights.
 *
 * Selection rules:
 *
 * - If `providers` is empty, throws an `Error`.
 * - If `weights` is `undefined` or `providers` has exactly one entry, the
 *   first provider is returned deterministically.
 * - Otherwise a weighted random selection is performed: each provider's
 *   weight is looked up in `weights` (defaulting to `1` for unlisted
 *   providers), weights are summed, and a random value in `[0, sum)` picks
 *   the winner proportionally.
 *
 * @param providers - Non-empty list of provider IDs to choose from.
 * @param weights - Optional weight map. Providers not listed get weight `1`.
 * @returns The selected provider ID.
 * @throws {Error} When `providers` is empty.
 *
 * @example
 * ```ts
 * // 90% suno, 10% udio (approximately)
 * selectWeightedProvider(['suno', 'udio'], { suno: 9, udio: 1 });
 * ```
 */
export function selectWeightedProvider(providers, weights) {
    if (providers.length === 0) {
        throw new Error('Cannot select from an empty provider list');
    }
    if (!weights || providers.length === 1) {
        return providers[0];
    }
    const resolved = providers
        .map((id) => {
        const weight = weights[id] ?? 1;
        if (!Number.isFinite(weight) || weight < 0) {
            throw new Error(`Invalid weight for provider "${id}". Expected a finite non-negative number.`);
        }
        return { id, weight };
    })
        .filter(({ weight }) => weight > 0);
    if (resolved.length === 0) {
        throw new Error('Cannot select from providers with zero total weight');
    }
    const totalWeight = resolved.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    for (const { id, weight } of resolved) {
        random -= weight;
        if (random <= 0) {
            return id;
        }
    }
    // Floating-point edge case — return the last provider.
    return providers[providers.length - 1];
}
//# sourceMappingURL=ProviderPreferences.js.map