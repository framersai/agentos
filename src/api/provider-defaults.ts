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

/**
 * Registry of default models per provider, keyed by provider identifier.
 *
 * These defaults are used when a caller specifies `provider: 'openai'` without
 * an explicit `model` field.  The task type (`'text'`, `'image'`, `'embedding'`)
 * selects which sub-key to read.
 */
export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai: {
    text: 'gpt-4o',
    image: 'gpt-image-1',
    embedding: 'text-embedding-3-small',
    cheap: 'gpt-4o-mini',
  },
  anthropic: {
    text: 'claude-sonnet-4-20250514',
    cheap: 'claude-haiku-4-5-20251001',
  },
  ollama: {
    text: 'llama3.2',
    image: 'stable-diffusion',
    embedding: 'nomic-embed-text',
    cheap: 'llama3.2',
  },
  openrouter: {
    text: 'openai/gpt-4o',
    cheap: 'openai/gpt-4o-mini',
  },
  gemini: {
    text: 'gemini-2.5-flash',
    cheap: 'gemini-2.0-flash',
  },
  stability: {
    image: 'stable-diffusion-xl-1024-v1-0',
  },
  replicate: {
    image: 'black-forest-labs/flux-1.1-pro',
  },
  'stable-diffusion-local': {
    image: 'v1-5-pruned-emaonly',
  },
  bfl: {
    image: 'flux-pro-1.1',
  },
  fal: {
    image: 'fal-ai/flux/dev',
  },
  groq: {
    text: 'llama-3.3-70b-versatile',
    cheap: 'gemma2-9b-it',
  },
  together: {
    text: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    cheap: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  },
  mistral: {
    text: 'mistral-large-latest',
    cheap: 'mistral-small-latest',
  },
  xai: {
    text: 'grok-2',
    cheap: 'grok-2-mini',
  },
};

/** Env var keys checked for auto-detection, in priority order */
const AUTO_DETECT_ORDER: Array<{ envKey: string; provider: string }> = [
  { envKey: 'OPENAI_API_KEY', provider: 'openai' },
  { envKey: 'ANTHROPIC_API_KEY', provider: 'anthropic' },
  { envKey: 'OPENROUTER_API_KEY', provider: 'openrouter' },
  { envKey: 'GEMINI_API_KEY', provider: 'gemini' },
  { envKey: 'GROQ_API_KEY', provider: 'groq' },
  { envKey: 'TOGETHER_API_KEY', provider: 'together' },
  { envKey: 'MISTRAL_API_KEY', provider: 'mistral' },
  { envKey: 'XAI_API_KEY', provider: 'xai' },
  { envKey: 'OLLAMA_BASE_URL', provider: 'ollama' },
  { envKey: 'STABILITY_API_KEY', provider: 'stability' },
  { envKey: 'REPLICATE_API_TOKEN', provider: 'replicate' },
  { envKey: 'STABLE_DIFFUSION_LOCAL_BASE_URL', provider: 'stable-diffusion-local' },
  { envKey: 'BFL_API_KEY', provider: 'bfl' },
  { envKey: 'FAL_API_KEY', provider: 'fal' },
];

/**
 * Auto-detects the active provider by scanning well-known environment variables
 * in priority order.
 *
 * Returns the identifier of the first provider whose key/URL env var is non-empty,
 * or `undefined` when no recognisable credentials are present.
 *
 * Priority: openai → anthropic → openrouter → gemini → ollama → stability → replicate
 */
export function autoDetectProvider(): string | undefined {
  for (const { envKey, provider } of AUTO_DETECT_ORDER) {
    if (process.env[envKey]) return provider;
  }
  return undefined;
}
