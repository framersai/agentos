/**
 * @file variateImage.ts
 * Provider-agnostic image variation generation for the AgentOS high-level API.
 *
 * Creates visual variations of a source image — each variation maintains the
 * general composition and subject matter but differs in details, style, or
 * perspective.
 *
 * Provider support:
 * - **OpenAI** — `POST /v1/images/variations` (dedicated endpoint).
 * - **Stability AI** — Implemented via img2img with low strength (high similarity).
 * - **Stable Diffusion Local** — Implemented via img2img with low `denoising_strength`.
 * - **Replicate** — Model-specific (img2img with low strength).
 */
import { createImageProvider } from '../media/images/index.js';
import { ImageVariationNotSupportedError } from '../media/images/ImageOperationError.js';
import { imageToBuffer } from '../media/images/imageToBuffer.js';
import type {
  GeneratedImage,
  ImageGenerationResult,
  ImageProviderOptionBag,
} from '../media/images/IImageProvider.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../core/observability/otel.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for a {@link variateImage} call.
 *
 * @example
 * ```ts
 * const result = await variateImage({
 *   provider: 'openai',
 *   image: fs.readFileSync('hero.png'),
 *   n: 3,
 *   variance: 0.4,
 * });
 * ```
 */
export interface VariateImageOptions {
  /**
   * Provider name (e.g. `"openai"`, `"stability"`, `"stable-diffusion-local"`).
   * When omitted, auto-detection via env vars is attempted.
   */
  provider?: string;
  /**
   * Model identifier.  When omitted, the provider's default variation model
   * is used (e.g. `dall-e-2` for OpenAI).
   */
  model?: string;
  /**
   * Source image as a base64 data URL, raw base64 string, `Buffer`,
   * local file path, or HTTP/HTTPS URL.
   */
  image: string | Buffer;
  /**
   * Number of variations to generate.
   * @default 1
   */
  n?: number;
  /**
   * How different from the original each variation should be.
   * `0` = nearly identical, `1` = very different.
   *
   * For providers that support strength/denoising (Stability, A1111), this is
   * mapped to that parameter.  OpenAI's variations API does not expose a
   * strength control so this value is advisory only.
   *
   * @default 0.5
   */
  variance?: number;
  /** Desired output size (e.g. `"1024x1024"`). */
  size?: string;
  /** Override the provider API key. */
  apiKey?: string;
  /** Override the provider base URL. */
  baseUrl?: string;
  /** Arbitrary provider-specific options. */
  providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
  /** Optional usage ledger configuration. */
  usageLedger?: AgentOSUsageLedgerOptions;
}

/**
 * Result returned by {@link variateImage}.
 */
export interface VariateImageResult {
  /** Array of variation images. */
  images: GeneratedImage[];
  /** Provider identifier. */
  provider: string;
  /** Model identifier. */
  model: string;
  /** Token/credit usage reported by the provider. */
  usage: { costUSD?: number };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates visual variations of a source image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `variateImage` method.
 *
 * For providers without a native variation endpoint, the high-level API falls
 * back to an img2img call with `strength = variance` to produce similar output.
 *
 * @param opts - Variation options including the source image and desired count.
 * @returns A promise resolving to the variation result with image data.
 *
 * @throws {ImageVariationNotSupportedError} When the resolved provider does not
 *   implement image variations and has no img2img fallback.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * const result = await variateImage({
 *   provider: 'openai',
 *   image: 'https://example.com/hero.png',
 *   n: 4,
 * });
 * result.images.forEach((img, i) => console.log(`Variation ${i}:`, img.url));
 * ```
 */
export async function variateImage(opts: VariateImageOptions): Promise<VariateImageResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';
  let metricUsage: ImageGenerationResult['usage'];
  let metricProviderId: string | undefined;
  let metricModelId: string | undefined;

  try {
    return await withAgentOSSpan('agentos.api.variate_image', async (span) => {
      const { providerId, modelId } = resolveModelOption(opts, 'image');
      const resolved = resolveMediaProvider(providerId, modelId, {
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
      });
      metricProviderId = resolved.providerId;
      metricModelId = resolved.modelId;

      span?.setAttribute('llm.provider', resolved.providerId);
      span?.setAttribute('llm.model', resolved.modelId);
      span?.setAttribute('agentos.api.variance', opts.variance ?? 0.5);

      const provider = createImageProvider(resolved.providerId);
      await provider.initialize({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseUrl,
        defaultModelId: resolved.modelId,
      });

      const imageBuffer = await imageToBuffer(opts.image);

      let result: ImageGenerationResult;

      if (typeof provider.variateImage === 'function') {
        // Native variation support (e.g. OpenAI /v1/images/variations).
        result = await provider.variateImage({
          modelId: resolved.modelId,
          image: imageBuffer,
          n: opts.n,
          variance: opts.variance,
          size: opts.size,
          providerOptions: opts.providerOptions,
        });
      } else if (typeof provider.editImage === 'function') {
        // Fallback: use img2img with low strength to produce "variations".
        // The variance parameter maps to edit strength — lower variance means
        // the output stays closer to the original.
        result = await provider.editImage({
          modelId: resolved.modelId,
          image: imageBuffer,
          prompt: 'Create a variation of this image.',
          mode: 'img2img',
          strength: opts.variance ?? 0.5,
          n: opts.n,
          size: opts.size,
          providerOptions: opts.providerOptions,
        });
      } else {
        throw new ImageVariationNotSupportedError(resolved.providerId);
      }

      metricUsage = result.usage;
      span?.setAttribute('agentos.api.images_count', result.images.length);
      attachUsageAttributes(span, {
        totalCostUSD: result.usage?.totalCostUSD,
      });

      return {
        images: result.images,
        provider: result.providerId,
        model: result.modelId,
        usage: { costUSD: result.usage?.totalCostUSD },
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
              costUSD: metricUsage.totalCostUSD,
            }
          : undefined,
        options: {
          ...opts.usageLedger,
          source: opts.usageLedger?.source ?? 'variateImage',
        },
      });
    } catch {
      // Best-effort — usage persistence must not break the variation operation.
    }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
      usage: toTurnMetricUsage(
        metricUsage
          ? {
              totalCostUSD: metricUsage.totalCostUSD,
            }
          : undefined
      ),
    });
  }
}
