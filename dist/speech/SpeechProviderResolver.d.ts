import { EventEmitter } from 'events';
import type { SpeechProviderKind, SpeechToTextProvider, TextToSpeechProvider, SpeechVadProvider, WakeWordProvider, SpeechResolverConfig, ProviderRequirements, ProviderRegistration } from './types.js';
/**
 * Central resolver for speech providers (STT, TTS, VAD, wake-word).
 *
 * ## Resolution Algorithm
 *
 * 1. **Registration** — Providers are registered via `register()` with a
 *    unique `id`, a `kind` (stt/tts/vad/wake-word), a numeric `priority`,
 *    and a boolean `isConfigured` flag.
 *
 * 2. **Filtering** — When a consumer calls `resolveSTT()`, `resolveTTS()`,
 *    `resolveVAD()`, or `resolveWakeWord()`, the resolver filters
 *    registrations by `kind` and `isConfigured === true`.
 *
 * 3. **Requirements matching** — Optional {@link ProviderRequirements} further
 *    filter by `streaming`, `local`, and `features` capabilities from the
 *    provider's catalog entry.
 *
 * 4. **Priority ordering** — Remaining candidates are sorted by ascending
 *    `priority` (lower number = tried first). Core providers default to 100,
 *    extensions to 200, and user-preferred providers get boosted to 50+.
 *
 * 5. **Fallback wrapping** — When `config.stt.fallback` or `config.tts.fallback`
 *    is `true` and multiple candidates survive, they are wrapped in a
 *    {@link FallbackSTTProxy} or {@link FallbackTTSProxy} that tries each in
 *    order, emitting `provider_fallback` events on failure.
 *
 * ## Priority Tiers
 *
 * | Tier | Priority Range | Source |
 * |------|---------------|--------|
 * | User-preferred | 50–59 | `config.stt.preferred` / `config.tts.preferred` |
 * | Core | 100 | Built-in provider catalog |
 * | Extension | 200 | Discovered via ExtensionManager |
 *
 * ## Events
 *
 * | Event | Payload | When |
 * |-------|---------|------|
 * | `provider_registered` | `{ id, kind, source }` | A provider is registered via `register()` |
 *
 * @see {@link FallbackSTTProxy} for the STT fallback chain implementation
 * @see {@link FallbackTTSProxy} for the TTS fallback chain implementation
 * @see {@link ProviderRequirements} for available filtering criteria
 *
 * @example
 * ```ts
 * const resolver = new SpeechProviderResolver(
 *   { stt: { preferred: ['deepgram-batch'], fallback: true } },
 *   process.env,
 * );
 * await resolver.refresh();
 * const stt = resolver.resolveSTT({ features: ['diarization'] });
 * ```
 */
export declare class SpeechProviderResolver extends EventEmitter {
    private readonly config?;
    private readonly env;
    /**
     * Internal registry of all providers keyed by their unique string id.
     * Overwrites are allowed — re-registering with the same id replaces the
     * previous entry, which lets hot-reload and extension refresh work seamlessly.
     */
    private registrations;
    /**
     * Creates a new SpeechProviderResolver.
     *
     * @param config - Optional resolver configuration controlling preferred
     *   providers and fallback behaviour for each provider kind.
     * @param env - Environment variable map used to check whether a provider's
     *   required API keys are present. Defaults to `process.env` so unit tests
     *   can inject a controlled map without polluting the real environment.
     *
     * @example
     * ```ts
     * // Production: use real env vars
     * const resolver = new SpeechProviderResolver({ stt: { fallback: true } });
     *
     * // Testing: inject controlled env
     * const resolver = new SpeechProviderResolver(undefined, { OPENAI_API_KEY: 'test' });
     * ```
     */
    constructor(config?: SpeechResolverConfig | undefined, env?: Record<string, string | undefined>);
    /**
     * Register a provider, overwriting any existing registration with the same id.
     *
     * Emits a `provider_registered` event with `{ id, kind, source }` so that
     * listeners (e.g. UI dashboards, logging middleware) can track what's available.
     *
     * @param reg - The full registration object including the provider instance,
     *   catalog entry, priority, and configuration status.
     *
     * @example
     * ```ts
     * resolver.register({
     *   id: 'custom-stt',
     *   kind: 'stt',
     *   provider: myCustomProvider,
     *   catalogEntry: { id: 'custom-stt', kind: 'stt', label: 'Custom', envVars: [], local: false, description: '' },
     *   isConfigured: true,
     *   priority: 150,
     *   source: 'extension',
     * });
     * ```
     */
    register(reg: ProviderRegistration): void;
    /**
     * List all registrations for a given provider kind, sorted ascending by
     * priority (lower number = higher priority = tried first).
     *
     * This returns both configured and unconfigured providers — use
     * `.filter(r => r.isConfigured)` if you only want usable ones.
     *
     * @param kind - The provider kind to filter by.
     * @returns A new array of registrations sorted by ascending priority.
     *
     * @example
     * ```ts
     * const allSTT = resolver.listProviders('stt');
     * const configured = allSTT.filter(r => r.isConfigured);
     * console.log(`${configured.length} of ${allSTT.length} STT providers ready`);
     * ```
     */
    listProviders(kind: SpeechProviderKind): ProviderRegistration[];
    /**
     * Resolve the best STT provider matching optional {@link ProviderRequirements}.
     *
     * When `config.stt.fallback` is `true` and multiple candidates exist, wraps
     * them in a {@link FallbackSTTProxy} that tries providers in priority order.
     * Otherwise returns the single highest-priority match.
     *
     * @param requirements - Optional filtering criteria (streaming, local, features,
     *   preferredIds).
     * @returns The resolved STT provider, possibly wrapped in a FallbackSTTProxy.
     * @throws {Error} When no configured STT provider matches the requirements.
     *
     * @see {@link FallbackSTTProxy} for fallback chain behaviour
     * @see {@link ProviderRequirements} for available filter options
     *
     * @example
     * ```ts
     * // Simple: best available
     * const stt = resolver.resolveSTT();
     *
     * // With requirements
     * const stt = resolver.resolveSTT({ streaming: true, features: ['diarization'] });
     *
     * // With explicit preference ordering
     * const stt = resolver.resolveSTT({ preferredIds: ['deepgram-batch', 'openai-whisper'] });
     * ```
     */
    resolveSTT(requirements?: ProviderRequirements): SpeechToTextProvider;
    /**
     * Resolve the best TTS provider matching optional {@link ProviderRequirements}.
     *
     * When `config.tts.fallback` is `true` and multiple candidates exist, wraps
     * them in a {@link FallbackTTSProxy} that tries providers in priority order.
     * Otherwise returns the single highest-priority match.
     *
     * @param requirements - Optional filtering criteria (streaming, local, features,
     *   preferredIds).
     * @returns The resolved TTS provider, possibly wrapped in a FallbackTTSProxy.
     * @throws {Error} When no configured TTS provider matches the requirements.
     *
     * @see {@link FallbackTTSProxy} for fallback chain behaviour
     * @see {@link ProviderRequirements} for available filter options
     *
     * @example
     * ```ts
     * const tts = resolver.resolveTTS();
     * const result = await tts.synthesize('Hello!');
     * ```
     */
    resolveTTS(requirements?: ProviderRequirements): TextToSpeechProvider;
    /**
     * Resolve the highest-priority configured VAD provider.
     *
     * VAD providers don't support fallback chains because voice activity detection
     * is a real-time frame-by-frame operation where mid-session provider switching
     * would cause state inconsistency.
     *
     * @returns The resolved VAD provider instance.
     * @throws {Error} When no VAD provider is registered and configured.
     *
     * @example
     * ```ts
     * const vad = resolver.resolveVAD();
     * const decision = vad.processFrame(audioFrame);
     * ```
     */
    resolveVAD(): SpeechVadProvider;
    /**
     * Resolve the highest-priority configured wake-word provider, or `null`
     * when none is registered.
     *
     * Returns `null` instead of throwing because wake-word detection is an
     * optional feature — many deployments operate without it.
     *
     * @returns The resolved wake-word provider, or `null` if none is available.
     *
     * @example
     * ```ts
     * const wakeWord = resolver.resolveWakeWord();
     * if (wakeWord) {
     *   const detection = await wakeWord.detect(frame, sampleRate);
     * }
     * ```
     */
    resolveWakeWord(): WakeWordProvider | null;
    /**
     * Populate the resolver by registering core providers from the static catalog,
     * optionally discovering extension providers, and applying user-configured
     * preferred priorities.
     *
     * The three-phase refresh sequence is:
     * 1. `registerCoreProviders()` — register all built-in providers from the
     *    static catalog, marking each as configured/unconfigured based on env vars.
     * 2. `discoverExtensionProviders()` — if an ExtensionManager is provided,
     *    discover and register any additional speech providers from extensions.
     * 3. `applyPreferredPriorities()` — boost priority for providers listed in
     *    the user's `config.stt.preferred` / `config.tts.preferred` arrays.
     *
     * @param extensionManager - Optional object exposing `getDescriptorsByKind(kind)`.
     *   Uses `any` type because the ExtensionManager interface is defined in the
     *   extensions package and importing it here would create a circular dependency.
     *
     * @example
     * ```ts
     * const resolver = new SpeechProviderResolver(config, process.env);
     * await resolver.refresh(extensionManager);
     * // Now all providers are registered and ready to resolve.
     * ```
     */
    refresh(extensionManager?: any): Promise<void>;
    /**
     * Core resolution algorithm shared by `resolveSTT()` and `resolveTTS()`.
     *
     * ## Algorithm
     *
     * **Path A — Preferred IDs provided:**
     * When `requirements.preferredIds` is set, iterate through the IDs in the
     * caller's specified order. For each ID, look up the registration and include
     * it only if it matches the kind, is configured, and satisfies all other
     * requirements. This preserves the caller's explicit ordering preference.
     *
     * **Path B — No preferred IDs:**
     * Return all configured providers of the requested kind that match the
     * requirements, sorted by ascending priority (lower = better). This is the
     * default path for most callers.
     *
     * @param kind - The provider kind to resolve ('stt', 'tts', etc.).
     * @param requirements - Optional filtering criteria.
     * @returns An ordered array of matching registrations (best first).
     *
     * @example
     * ```ts
     * // Internal usage — called by resolveSTT/resolveTTS:
     * const candidates = this.resolveByKind('stt', { streaming: true });
     * ```
     */
    private resolveByKind;
    /**
     * Check whether a registration satisfies the given requirements.
     *
     * Each requirement field is independently checked. A `undefined` requirement
     * field means "no constraint" — only explicitly set fields are enforced.
     * All specified fields must match for the provider to qualify.
     *
     * @param reg - The provider registration to test.
     * @param req - The requirements to match against. If `undefined`, all
     *   providers match.
     * @returns `true` if the registration satisfies all specified requirements.
     *
     * @example
     * ```ts
     * // Matches: streaming=true required, provider has streaming=true
     * this.matchesRequirements(reg, { streaming: true }); // true
     *
     * // Fails: feature 'diarization' required but provider only has ['cloud']
     * this.matchesRequirements(reg, { features: ['diarization'] }); // false
     * ```
     */
    private matchesRequirements;
    /**
     * Register providers from the static core catalog.
     *
     * Each provider is marked `isConfigured` based on whether ALL of its required
     * environment variables are set (non-empty). Providers with `available === false`
     * in the catalog are skipped entirely — they represent planned but not yet
     * implemented backends (e.g. NVIDIA NeMo, Bark).
     *
     * Core providers are registered with `priority: 100` and `source: 'core'`.
     * The `provider` field is set to `null` (lazy instantiation) — actual provider
     * instances are created on first use by the SpeechRuntime.
     *
     * @example
     * ```ts
     * // Called internally by refresh():
     * this.registerCoreProviders();
     * ```
     */
    private registerCoreProviders;
    /**
     * Discover speech providers exposed by an ExtensionManager via
     * `getDescriptorsByKind()`.
     *
     * Extension providers are registered with `priority: 200` (lower than core's
     * 100) so they serve as fallbacks unless the user explicitly boosts them via
     * `config.stt.preferred` / `config.tts.preferred`.
     *
     * The `extensionManager` parameter uses `any` because the ExtensionManager
     * type lives in the extensions package — importing it would create a circular
     * dependency. We only rely on the `getDescriptorsByKind` method signature.
     *
     * @param extensionManager - Object exposing `getDescriptorsByKind(kind)` that
     *   returns an array of `{ id: string; payload: unknown }` descriptors.
     *
     * @example
     * ```ts
     * // Called internally by refresh():
     * this.discoverExtensionProviders(extensionManager);
     * ```
     */
    private discoverExtensionProviders;
    /**
     * Boost priority for providers listed in `config.stt.preferred` /
     * `config.tts.preferred`.
     *
     * Earlier entries in the preferred array get lower priority numbers
     * (= higher priority). The sequence starts at 50, so the first preferred
     * provider gets priority 50, second gets 51, etc. This places them above
     * all core (100) and extension (200) providers but still allows the
     * priority to be numerically distinguished.
     *
     * @example
     * ```ts
     * // config.stt.preferred = ['assemblyai', 'openai-whisper']
     * // Result: assemblyai.priority = 50, openai-whisper.priority = 51
     * this.applyPreferredPriorities();
     * ```
     */
    private applyPreferredPriorities;
}
//# sourceMappingURL=SpeechProviderResolver.d.ts.map