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
 * Produced by {@link resolveProvider} and {@link resolveMediaProvider}.
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

const ENV_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  stability: 'STABILITY_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
};

const ENV_URL_MAP: Record<string, string> = {
  openai: 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
  stability: 'STABILITY_BASE_URL',
  replicate: 'REPLICATE_BASE_URL',
  ollama: 'OLLAMA_BASE_URL',
};

/**
 * Splits a `provider:model` string into its constituent parts.
 *
 * The format is strict: the provider portion must be non-empty, separated from
 * the model portion by exactly one colon, and the model portion must also be
 * non-empty.
 *
 * @param model - A `provider:model` string such as `"openai:gpt-4o"`,
 *   `"ollama:llama3.2"`, or `"openrouter:anthropic/claude-sonnet-4-5-20250929"`.
 * @returns A {@link ParsedModel} with `providerId` and `modelId` fields.
 * @throws {Error} When the string is missing, not a string, or does not match
 *   the expected `provider:model` format.
 */
export function parseModelString(model: string): ParsedModel {
  if (!model || typeof model !== 'string') {
    throw new Error('Invalid model string. Expected "provider:model" (e.g. "openai:gpt-4o").');
  }
  const colonIdx = model.indexOf(':');
  if (colonIdx <= 0 || colonIdx === model.length - 1) {
    throw new Error(`Invalid model "${model}". Expected "provider:model" (e.g. "openai:gpt-4o").`);
  }
  return {
    providerId: model.slice(0, colonIdx),
    modelId: model.slice(colonIdx + 1),
  };
}

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
 * @returns A {@link ResolvedProvider} ready for {@link createProviderManager}.
 * @throws {Error} When no credentials can be resolved for the given provider.
 */
export function resolveProvider(
  providerId: string,
  modelId: string,
  overrides?: { apiKey?: string; baseUrl?: string },
): ResolvedProvider {
  const apiKey = overrides?.apiKey
    ?? (ENV_KEY_MAP[providerId] ? process.env[ENV_KEY_MAP[providerId]] : undefined);
  const baseUrl = overrides?.baseUrl
    ?? (ENV_URL_MAP[providerId] ? process.env[ENV_URL_MAP[providerId]] : undefined);

  if (providerId === 'ollama') {
    if (!baseUrl) {
      throw new Error(`No base URL for ollama. Set OLLAMA_BASE_URL or pass baseUrl.`);
    }
    return { providerId, modelId, baseUrl };
  }

  // Anthropic goes through OpenRouter by default in AgentOS
  if (providerId === 'anthropic' && !apiKey) {
    const orKey = process.env['OPENROUTER_API_KEY'];
    if (orKey) {
      return { providerId: 'openrouter', modelId: `anthropic/${modelId}`, apiKey: orKey };
    }
    throw new Error(`No API key for anthropic. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.`);
  }

  if (!apiKey) {
    const envVar = ENV_KEY_MAP[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
    throw new Error(`No API key for ${providerId}. Set ${envVar} or pass apiKey.`);
  }

  return { providerId, modelId, apiKey, baseUrl };
}

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
 * @returns A {@link ResolvedProvider} ready for use with an image provider factory.
 * @throws {Error} When a known provider is missing its required API key or base URL.
 */
export function resolveMediaProvider(
  providerId: string,
  modelId: string,
  overrides?: { apiKey?: string; baseUrl?: string },
): ResolvedProvider {
  const apiKey = overrides?.apiKey
    ?? (ENV_KEY_MAP[providerId] ? process.env[ENV_KEY_MAP[providerId]] : undefined);
  const baseUrl = overrides?.baseUrl
    ?? (ENV_URL_MAP[providerId] ? process.env[ENV_URL_MAP[providerId]] : undefined);

  if (providerId === 'ollama') {
    if (!baseUrl) {
      throw new Error(`No base URL for ollama. Set OLLAMA_BASE_URL or pass baseUrl.`);
    }
    return { providerId, modelId, baseUrl };
  }

  const envVar = ENV_KEY_MAP[providerId];
  if (envVar && !apiKey) {
    throw new Error(`No API key for ${providerId}. Set ${envVar} or pass apiKey.`);
  }

  return { providerId, modelId, apiKey, baseUrl };
}

/**
 * Instantiates and initialises an {@link AIModelProviderManager} for a single provider.
 *
 * Constructs the provider config object from the `resolved` credentials and calls
 * `manager.initialize()` before returning.  The returned manager is ready for
 * immediate use via `manager.getProvider(providerId)`.
 *
 * @param resolved - A {@link ResolvedProvider} produced by {@link resolveProvider}
 *   or {@link resolveMediaProvider}.
 * @returns A fully initialised {@link AIModelProviderManager} instance.
 */
export async function createProviderManager(
  resolved: ResolvedProvider,
): Promise<AIModelProviderManager> {
  const manager = new AIModelProviderManager();

  const providerConfig: Record<string, unknown> = {};
  if (resolved.apiKey) providerConfig.apiKey = resolved.apiKey;
  if (resolved.baseUrl) {
    providerConfig.baseURL = resolved.baseUrl;
    providerConfig.baseUrl = resolved.baseUrl;
  }

  await manager.initialize({
    providers: [{
      providerId: resolved.providerId,
      enabled: true,
      isDefault: true,
      config: providerConfig,
    }],
  });

  return manager;
}
