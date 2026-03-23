// packages/agentos/src/api/model.ts
import { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager.js';

export interface ParsedModel {
  providerId: string;
  modelId: string;
}

export interface ResolvedProvider {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

const ENV_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const ENV_URL_MAP: Record<string, string> = {
  ollama: 'OLLAMA_BASE_URL',
};

/**
 * Parses 'provider:model' string format.
 * Examples: 'openai:gpt-4o', 'ollama:llama3.2', 'openrouter:anthropic/claude-sonnet-4-5-20250929'
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
 * Resolves provider config from env vars, with optional overrides.
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
 * Creates an AIModelProviderManager from a resolved provider config.
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
