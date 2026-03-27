/**
 * @file generateImage.ts
 * Provider-agnostic image generation for the AgentOS high-level API.
 *
 * Parses a `provider:model` string, resolves media-provider credentials, and
 * dispatches the request to the appropriate image provider implementation
 * (e.g. OpenAI DALL-E, Stability AI, Replicate).
 *
 * When multiple image-capable providers are configured (via env vars), the
 * primary provider is wrapped in a {@link FallbackImageProxy} so that a
 * transient failure automatically retries on the next available provider.
 */
import { EventEmitter } from 'events';
import { createImageProvider, hasImageProviderFactory } from '../core/images/index.js';
import { FallbackImageProxy } from '../core/images/FallbackImageProxy.js';
import type {
  IImageProvider,
  GeneratedImage,
  ImageGenerationResult,
  ImageProviderOptionBag,
  ImageResponseFormat,
  ImageBackground,
  ImageModality,
  ImageOutputFormat,
} from '../core/images/IImageProvider.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../core/observability/otel.js';

// ---------------------------------------------------------------------------
// Image provider fallback chain builder
// ---------------------------------------------------------------------------

/**
 * Env-var to provider-id mapping used to detect which image providers have
 * credentials configured in the current environment.  Order determines
 * fallback priority (first = highest priority).
 */
const IMAGE_PROVIDER_ENV_MAP: Array<{ envKey: string; providerId: string }> = [
  { envKey: 'OPENAI_API_KEY', providerId: 'openai' },
  { envKey: 'STABILITY_API_KEY', providerId: 'stability' },
  { envKey: 'REPLICATE_API_TOKEN', providerId: 'replicate' },
  { envKey: 'BFL_API_KEY', providerId: 'bfl' },
  { envKey: 'FAL_API_KEY', providerId: 'fal' },
  { envKey: 'OPENROUTER_API_KEY', providerId: 'openrouter' },
  { envKey: 'STABLE_DIFFUSION_LOCAL_BASE_URL', providerId: 'stable-diffusion-local' },
];

/** Shared emitter for image fallback events (singleton per process). */
const imageFallbackEmitter = new EventEmitter();

/**
 * Detects all image providers with valid credentials in the environment
 * and returns their provider IDs in priority order, excluding the primary.
 *
 * @param primaryProviderId - The provider that was explicitly selected; it
 *   is excluded from the fallback list since it is already the first in line.
 * @returns An array of provider IDs suitable for fallback, in priority order.
 */
function detectFallbackImageProviders(primaryProviderId: string): string[] {
  const fallbacks: string[] = [];
  for (const { envKey, providerId } of IMAGE_PROVIDER_ENV_MAP) {
    if (providerId === primaryProviderId) continue;
    if (!process.env[envKey]) continue;
    if (!hasImageProviderFactory(providerId)) continue;
    fallbacks.push(providerId);
  }
  return fallbacks;
}

/**
 * Creates an {@link IImageProvider} for the resolved primary provider,
 * optionally wrapped in a {@link FallbackImageProxy} when additional
 * image-capable providers are detected in the environment.
 *
 * @param resolved - The primary resolved provider credentials.
 * @returns An initialised image provider (possibly a fallback proxy).
 */
async function createImageProviderWithFallback(
  resolved: { providerId: string; modelId: string; apiKey?: string; baseUrl?: string },
): Promise<IImageProvider> {
  const primary = createImageProvider(resolved.providerId);
  await primary.initialize({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl,
    defaultModelId: resolved.modelId,
  });

  const fallbackIds = detectFallbackImageProviders(resolved.providerId);
  if (fallbackIds.length === 0) {
    return primary;
  }

  // Build and initialise fallback providers. Failures during init are
  // silently skipped — the provider simply won't be part of the chain.
  const chain: IImageProvider[] = [primary];
  for (const fbId of fallbackIds) {
    try {
      const fbResolved = resolveMediaProvider(fbId, resolved.modelId);
      const fb = createImageProvider(fbId);
      await fb.initialize({
        apiKey: fbResolved.apiKey,
        baseURL: fbResolved.baseUrl,
        defaultModelId: fbResolved.modelId,
      });
      chain.push(fb);
    } catch {
      // Skip providers that fail to initialise (missing creds, etc.).
    }
  }

  if (chain.length <= 1) {
    return primary;
  }

  return new FallbackImageProxy(chain, imageFallbackEmitter);
}

/**
 * Options for a {@link generateImage} call.
 */
export interface GenerateImageOptions {
  /**
   * Provider name.  When supplied without `model`, the default image model for
   * the provider is resolved automatically from the built-in defaults registry.
   *
   * @example `"openai"`, `"stability"`, `"replicate"`
   */
  provider?: string;
  /**
   * Model in `provider:model` format (legacy) or plain model name when `provider` is set.
   * @example `"openai:dall-e-3"`, `"stability:stable-diffusion-xl-1024-v1-0"`
   *
   * Either `provider` or `model` (or an API key env var for auto-detection) is required.
   */
  model?: string;
  /** Text description of the desired image. */
  prompt: string;
  /** Output modalities requested from the provider (provider-dependent). */
  modalities?: ImageModality[];
  /** Number of images to generate. Defaults to `1` for most providers. */
  n?: number;
  /** Pixel dimensions string, e.g. `"1024x1024"`. Provider-dependent. */
  size?: string;
  /** Aspect ratio string, e.g. `"16:9"`. Used by some providers instead of `size`. */
  aspectRatio?: string;
  /** Quality hint forwarded to the provider (e.g. `"hd"` for DALL-E 3). */
  quality?: string;
  /** Background style for transparent-capable providers. */
  background?: ImageBackground;
  /** Desired output file format (e.g. `"png"`, `"jpeg"`, `"webp"`). */
  outputFormat?: ImageOutputFormat;
  /** Compression level (0–100) for lossy output formats. */
  outputCompression?: number;
  /** Whether the provider should return a URL or base64-encoded data. */
  responseFormat?: ImageResponseFormat;
  /** Override the provider API key instead of reading from environment variables. */
  apiKey?: string;
  /** Override the provider base URL. */
  baseUrl?: string;
  /** Optional user identifier forwarded to the provider for moderation tracking. */
  userId?: string;
  /** Random seed for reproducible generation (provider-dependent support). */
  seed?: number;
  /** Negative prompt describing content to avoid (provider-dependent support). */
  negativePrompt?: string;
  /** Arbitrary provider-specific options not covered by the standard fields. */
  providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
  /** Optional durable usage ledger configuration for helper-level accounting. */
  usageLedger?: AgentOSUsageLedgerOptions;
}

/**
 * The result returned by {@link generateImage}.
 */
export interface GenerateImageResult {
  /** Model identifier reported by the provider. */
  model: string;
  /** Provider identifier (e.g. `"openai"`, `"stability"`). */
  provider: string;
  /** Unix timestamp (seconds) when the image was created. */
  created: number;
  /** Optional text response accompanying the images (provider-dependent). */
  text?: string;
  /** Array of generated image objects containing URLs or base64 data. */
  images: GeneratedImage[];
  /** Token / credit usage reported by the provider, when available. */
  usage?: ImageGenerationResult['usage'];
}

/**
 * Generates one or more images using a provider-agnostic `provider:model` string.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the matching
 * image provider, and returns a normalised {@link GenerateImageResult}.
 *
 * @param opts - Image generation options including model, prompt, and optional parameters.
 * @returns A promise resolving to the generation result with image data and metadata.
 *
 * @example
 * ```ts
 * const result = await generateImage({
 *   model: 'openai:dall-e-3',
 *   prompt: 'A photorealistic red panda sitting on a moonlit rooftop.',
 *   size: '1024x1024',
 * });
 * console.log(result.images[0].url);
 * ```
 */
export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';
  let metricUsage: ImageGenerationResult['usage'];
  let metricProviderId: string | undefined;
  let metricModelId: string | undefined;

  try {
    return await withAgentOSSpan('agentos.api.generate_image', async (span) => {
      const { providerId, modelId } = resolveModelOption(opts, 'image');
      const resolved = resolveMediaProvider(providerId, modelId, {
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
      });
      metricProviderId = resolved.providerId;
      metricModelId = resolved.modelId;

      span?.setAttribute('llm.provider', resolved.providerId);
      span?.setAttribute('llm.model', resolved.modelId);

      const provider = await createImageProviderWithFallback(resolved);

      const result = await provider.generateImage({
        modelId: resolved.modelId,
        prompt: opts.prompt,
        modalities: opts.modalities,
        n: opts.n,
        size: opts.size,
        aspectRatio: opts.aspectRatio,
        quality: opts.quality,
        background: opts.background,
        outputFormat: opts.outputFormat,
        outputCompression: opts.outputCompression,
        responseFormat: opts.responseFormat,
        userId: opts.userId,
        seed: opts.seed,
        negativePrompt: opts.negativePrompt,
        providerOptions: opts.providerOptions,
      });

      metricUsage = result.usage;
      span?.setAttribute('agentos.api.images_count', result.images.length);
      attachUsageAttributes(span, {
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
        totalTokens: result.usage?.totalTokens,
        totalCostUSD: result.usage?.totalCostUSD,
      });

      return {
        model: result.modelId,
        provider: result.providerId,
        created: result.created,
        text: result.text,
        images: result.images,
        usage: result.usage,
      };
    });
  } catch (error) {
    metricStatus = 'error';
    throw error;
  } finally {
    try {
      await recordAgentOSUsage({
        providerId: metricProviderId,
        modelId: metricModelId,
        usage: metricUsage
          ? {
              promptTokens: metricUsage.promptTokens,
              completionTokens: metricUsage.completionTokens,
              totalTokens: metricUsage.totalTokens,
              costUSD: metricUsage.totalCostUSD,
            }
          : undefined,
        options: {
          ...opts.usageLedger,
          source: opts.usageLedger?.source ?? 'generateImage',
        },
      });
    } catch {
      // Helper-level usage persistence is best-effort and should not break generation.
    }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
      usage: toTurnMetricUsage(
        metricUsage
          ? {
              promptTokens: metricUsage.promptTokens,
              completionTokens: metricUsage.completionTokens,
              totalTokens: metricUsage.totalTokens,
              totalCostUSD: metricUsage.totalCostUSD,
            }
          : undefined
      ),
    });
  }
}
