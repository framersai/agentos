/**
 * @file model.ts
 * Provider resolution utilities for the AgentOS high-level API.
 *
 * This module is responsible for parsing `provider:model` strings, resolving
 * credentials from environment variables or caller overrides, and constructing
 * an {@link AIModelProviderManager} ready for use by {@link generateText} and
 * {@link streamText}.
 */
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager.js';
/**
 * The result of splitting a `provider:model` string at the first colon.
 * Produced by {@link parseModelString}.
 */
export interface ParsedModel {
    /** The provider identifier (e.g. `"openai"`, `"anthropic"`, `"ollama"`). */
    providerId: string;
    /** The model identifier within the provider (e.g. `"gpt-4o"`, `"llama3.2"`). */
    modelId: string;
}
/**
 * A fully resolved provider configuration including optional credentials.
 * Produced by `resolveProvider()` and `resolveMediaProvider()`.
 */
export interface ResolvedProvider {
    /** Canonical provider identifier after any fallback remapping (e.g. anthropic → openrouter). */
    providerId: string;
    /** Model identifier, potentially rewritten for the remapped provider. */
    modelId: string;
    /** API key to use. Absent for providers that rely solely on a base URL (e.g. Ollama). */
    apiKey?: string;
    /** Base URL override forwarded to the provider SDK. */
    baseUrl?: string;
}
/**
 * Splits a `provider:model` string into its constituent parts.
 *
 * The format is strict: the provider portion must be non-empty, separated from
 * the model portion by exactly one colon, and the model portion must also be
 * non-empty.
 *
 * @param model - A `provider:model` string such as `"openai:gpt-4o"`,
 *   `"ollama:llama3.2"`, or `"openrouter:anthropic/claude-sonnet-4-5-20250929"`.
 * @returns A `ParsedModel` with `providerId` and `modelId` fields.
 * @throws {Error} When the string is missing, not a string, or does not match
 *   the expected `provider:model` format.
 */
export declare function parseModelString(model: string): ParsedModel;
/**
 * Resolves a complete provider configuration for LLM text providers.
 *
 * Reads API keys and base URLs from well-known environment variables
 * (e.g. `OPENAI_API_KEY`, `OLLAMA_BASE_URL`) and merges caller-supplied
 * `overrides`.  Applies the Anthropic → OpenRouter fallback when
 * `ANTHROPIC_API_KEY` is absent but `OPENROUTER_API_KEY` is set.
 *
 * @param providerId - Provider identifier (e.g. `"openai"`, `"anthropic"`, `"ollama"`).
 * @param modelId - Model identifier within the provider.
 * @param overrides - Optional explicit API key and/or base URL that take precedence
 *   over environment variable lookups.
 * @returns A `ResolvedProvider` ready for `createProviderManager()`.
 * @throws {Error} When no credentials can be resolved for the given provider.
 */
export declare function resolveProvider(providerId: string, modelId: string, overrides?: {
    apiKey?: string;
    baseUrl?: string;
}): ResolvedProvider;
/**
 * Resolves a provider configuration for image and other media providers.
 *
 * Behaves like {@link resolveProvider} but relaxes the API-key requirement:
 * when the provider is not listed in the known key map, the call succeeds
 * without a key (allowing custom or keyless providers).  Ollama still
 * requires a `baseUrl`.
 *
 * @param providerId - Provider identifier (e.g. `"stability"`, `"replicate"`, `"ollama"`).
 * @param modelId - Model identifier within the provider.
 * @param overrides - Optional explicit API key and/or base URL overrides.
 * @returns A `ResolvedProvider` ready for use with an image provider factory.
 * @throws {Error} When a known provider is missing its required API key or base URL.
 */
export declare function resolveMediaProvider(providerId: string, modelId: string, overrides?: {
    apiKey?: string;
    baseUrl?: string;
}): ResolvedProvider;
/**
 * Supported task types used when looking up a provider's default model.
 *
 * - `"text"` — text completion / chat (generateText, streamText, agent)
 * - `"image"` — image generation (generateImage)
 * - `"embedding"` — embedding generation
 */
export type TaskType = 'text' | 'image' | 'embedding';
/**
 * Flexible model option accepted by the high-level API functions.
 *
 * At least one of `provider` or `model` must be supplied, or an appropriate
 * API key environment variable must be set for auto-detection.
 */
export interface ModelOption {
    /**
     * Provider name.  When set without `model`, the default model for the
     * requested task is looked up in {@link PROVIDER_DEFAULTS}.
     *
     * @example `"openai"`, `"anthropic"`, `"ollama"`
     */
    provider?: string;
    /**
     * Explicit model identifier.  Accepted in two formats:
     * - `"provider:model"` — legacy format (e.g. `"openai:gpt-4o"`).  `provider` is ignored.
     * - `"model"` — plain name (e.g. `"gpt-4o-mini"`).  Requires `provider` or env-var auto-detect.
     */
    model?: string;
    /** API key override (takes precedence over environment variables). */
    apiKey?: string;
    /** Base URL override (useful for local proxies or Ollama). */
    baseUrl?: string;
}
/**
 * Resolves a `{ providerId, modelId }` pair from flexible caller-supplied options.
 *
 * Resolution priority:
 * 1. **Explicit `model` string** — if it contains `":"` it is split directly
 *    (backwards-compatible `provider:model` format).  If it is a plain name and
 *    `provider` is set, the pair is used as-is.  If neither, auto-detection
 *    from env vars is attempted.
 * 2. **`provider` only** — default model for the requested `task` is looked up
 *    in {@link PROVIDER_DEFAULTS}.
 * 3. **Neither** — auto-detect the first provider with a set API key/URL env
 *    var and use its default model for the requested `task`.
 *
 * @param opts - Caller options containing optional `provider` and/or `model`.
 * @param task - Task type used to select the correct default model. Defaults to `"text"`.
 * @returns A `ParsedModel` with `providerId` and `modelId`.
 * @throws {Error} When no provider can be determined, the provider is unknown,
 *   or the provider has no default model for the requested task.
 */
export declare function resolveModelOption(opts: ModelOption, task?: TaskType): ParsedModel;
/**
 * Instantiates and initialises an {@link AIModelProviderManager} for a single provider.
 *
 * Constructs the provider config object from the `resolved` credentials and calls
 * `manager.initialize()` before returning.  The returned manager is ready for
 * immediate use via `manager.getProvider(providerId)`.
 *
 * @param resolved - A `ResolvedProvider` produced by {@link resolveProvider}
 *   or `resolveMediaProvider()`.
 * @returns A fully initialised {@link AIModelProviderManager} instance.
 */
export declare function createProviderManager(resolved: ResolvedProvider): Promise<AIModelProviderManager>;
//# sourceMappingURL=model.d.ts.map