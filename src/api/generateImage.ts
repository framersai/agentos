/**
 * @file generateImage.ts
 * Provider-agnostic image generation for the AgentOS high-level API.
 *
 * Parses a `provider:model` string, resolves media-provider credentials, and
 * dispatches the request to the appropriate image provider implementation
 * (e.g. OpenAI DALL-E, Stability AI, Replicate).
 */
import { createImageProvider } from '../core/images/index.js';
import type {
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

      const provider = createImageProvider(resolved.providerId);
      await provider.initialize({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
        defaultModelId: resolved.modelId,
      });

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
