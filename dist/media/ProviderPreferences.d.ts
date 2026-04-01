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
/**
 * Per-modality provider preference configuration.
 *
 * - `preferred` — Ordered list of provider IDs to try first. Providers not in
 *   this list are excluded. When omitted the full available list is used.
 * - `weights` — Optional weight map for weighted random selection. Providers
 *   not listed default to weight `1`.
 * - `blocked` — Provider IDs to unconditionally exclude. Applied after the
 *   preferred filter so a provider can be both preferred *and* blocked (the
 *   block wins).
 */
export interface MediaProviderPreference {
    /** Ordered list of preferred provider IDs. */
    preferred?: string[];
    /** Weight map for weighted random selection (default weight is `1`). */
    weights?: Record<string, number>;
    /** Provider IDs to unconditionally exclude. */
    blocked?: string[];
}
/**
 * Top-level provider preferences grouped by media modality.
 *
 * Each modality can have its own independent preference configuration.
 * Audio is further split into `music` and `sfx` sub-modalities since
 * music generation and sound-effect generation often use different
 * provider backends.
 */
export interface ProviderPreferences {
    /** Image generation provider preferences. */
    image?: MediaProviderPreference;
    /** Video generation provider preferences. */
    video?: MediaProviderPreference;
    /** Audio generation provider preferences, split by sub-modality. */
    audio?: {
        /** Music generation provider preferences. */
        music?: MediaProviderPreference;
        /** Sound-effect generation provider preferences. */
        sfx?: MediaProviderPreference;
    };
}
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
export declare function resolveProviderOrder(available: string[], preferences?: MediaProviderPreference): string[];
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
export declare function resolveProviderChain(available: string[], preferences?: MediaProviderPreference): string[];
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
export declare function selectWeightedProvider(providers: string[], weights?: Record<string, number>): string;
//# sourceMappingURL=ProviderPreferences.d.ts.map