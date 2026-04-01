/**
 * @file provider-defaults.ts
 * Default model mappings for each supported provider.
 *
 * When a user specifies `provider: 'openai'` without an explicit `model`,
 * the system looks up the default model for the requested task type here.
 */
/**
 * Default model identifiers for a given provider, keyed by task type.
 * Only fields relevant to the provider need to be populated.
 */
export interface ProviderDefaults {
    /** Default model for generateText / streamText */
    text?: string;
    /** Default model for generateImage */
    image?: string;
    /** Default embedding model */
    embedding?: string;
    /** Cheapest model for internal/discovery use */
    cheap?: string;
}
/** Task keys supported by the default-model registry. */
export type ProviderDefaultTask = 'text' | 'image' | 'embedding';
/**
 * Registry of default models per provider, keyed by provider identifier.
 *
 * These defaults are used when a caller specifies `provider: 'openai'` without
 * an explicit `model` field.  The task type (`'text'`, `'image'`, `'embedding'`)
 * selects which sub-key to read.
 */
export declare const PROVIDER_DEFAULTS: Record<string, ProviderDefaults>;
/**
 * Auto-detects the active provider by scanning well-known environment variables
 * and CLI binaries in priority order.
 *
 * Returns the identifier of the first provider whose key/URL env var is non-empty
 * or whose CLI binary is on PATH, or `undefined` when no recognisable runtime is present.
 *
 * Priority: openrouter → openai → anthropic → gemini → claude-code-cli → gemini-cli → ollama → …
 */
export declare function autoDetectProvider(task?: ProviderDefaultTask): string | undefined;
//# sourceMappingURL=provider-defaults.d.ts.map