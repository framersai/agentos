/**
 * @file generateVideo.ts
 * Provider-agnostic video generation for the AgentOS high-level API.
 *
 * Resolves a video generation provider from explicit `opts.provider`, or by
 * probing environment variables in priority order:
 * `RUNWAY_API_KEY` -> `REPLICATE_API_TOKEN` -> `FAL_API_KEY`.
 *
 * When multiple video-capable providers are configured (via env vars), the
 * primary provider is wrapped in a {@link FallbackVideoProxy} so that a
 * transient failure automatically retries on the next available provider.
 *
 * Supports both text-to-video and image-to-video: when `opts.image` is
 * provided, the request is dispatched to {@link IVideoGenerator.imageToVideo};
 * otherwise {@link IVideoGenerator.generateVideo} is used.
 */
import { EventEmitter } from 'events';
import { createVideoProvider, hasVideoProviderFactory } from '../core/video/index.js';
import { FallbackVideoProxy } from '../core/video/FallbackVideoProxy.js';
import type {
  IVideoGenerator,
  VideoResult,
  VideoProgressEvent,
  VideoAspectRatio,
} from '../core/video/index.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../core/observability/otel.js';

// ---------------------------------------------------------------------------
// Video provider fallback chain builder
// ---------------------------------------------------------------------------

/**
 * Env-var to provider-id mapping used to detect which video providers have
 * credentials configured in the current environment. Order determines
 * fallback priority (first = highest priority).
 */
const VIDEO_PROVIDER_ENV_MAP: Array<{ envKey: string; providerId: string }> = [
  { envKey: 'RUNWAY_API_KEY', providerId: 'runway' },
  { envKey: 'REPLICATE_API_TOKEN', providerId: 'replicate' },
  { envKey: 'FAL_API_KEY', providerId: 'fal' },
];

/** Shared emitter for video fallback events (singleton per process). */
const videoFallbackEmitter = new EventEmitter();

/**
 * Detects the first available video provider from environment variables.
 *
 * Scans the {@link VIDEO_PROVIDER_ENV_MAP} in priority order and returns
 * the first provider whose API key env var is set and whose factory is
 * registered.
 *
 * @returns The provider ID and API key, or `undefined` when no video
 *   provider credentials are found.
 */
function autoDetectVideoProvider(): { providerId: string; apiKey: string } | undefined {
  for (const { envKey, providerId } of VIDEO_PROVIDER_ENV_MAP) {
    const key = process.env[envKey];
    if (key && hasVideoProviderFactory(providerId)) {
      return { providerId, apiKey: key };
    }
  }
  return undefined;
}

/**
 * Detects all video providers with valid credentials in the environment
 * and returns their provider IDs in priority order, excluding the primary.
 *
 * @param primaryProviderId - The provider that was explicitly selected; it
 *   is excluded from the fallback list since it is already first in line.
 * @returns An array of provider IDs suitable for fallback, in priority order.
 */
function detectFallbackVideoProviders(primaryProviderId: string): string[] {
  const fallbacks: string[] = [];
  for (const { envKey, providerId } of VIDEO_PROVIDER_ENV_MAP) {
    if (providerId === primaryProviderId) continue;
    if (!process.env[envKey]) continue;
    if (!hasVideoProviderFactory(providerId)) continue;
    fallbacks.push(providerId);
  }
  return fallbacks;
}

/**
 * Resolves the API key environment variable name for a known video provider.
 *
 * @param providerId - The provider identifier.
 * @returns The environment variable name, or a generic fallback.
 */
function envKeyForProvider(providerId: string): string {
  const entry = VIDEO_PROVIDER_ENV_MAP.find((e) => e.providerId === providerId);
  return entry?.envKey ?? `${providerId.toUpperCase()}_API_KEY`;
}

/**
 * Creates an {@link IVideoGenerator} for the resolved primary provider,
 * optionally wrapped in a {@link FallbackVideoProxy} when additional
 * video-capable providers are detected in the environment.
 *
 * @param providerId - Primary provider identifier.
 * @param apiKey - API key for the primary provider.
 * @param modelId - Optional model identifier override.
 * @param baseUrl - Optional base URL override.
 * @returns An initialised video provider (possibly a fallback proxy).
 */
async function createVideoProviderWithFallback(
  providerId: string,
  apiKey: string,
  modelId?: string,
  baseUrl?: string,
): Promise<IVideoGenerator> {
  const primary = createVideoProvider(providerId);
  await primary.initialize({
    apiKey,
    ...(modelId ? { defaultModelId: modelId } : {}),
    ...(baseUrl ? { baseURL: baseUrl, baseUrl } : {}),
  });

  const fallbackIds = detectFallbackVideoProviders(providerId);
  if (fallbackIds.length === 0) {
    return primary;
  }

  // Build and initialise fallback providers. Failures during init are
  // silently skipped — the provider simply won't be part of the chain.
  const chain: IVideoGenerator[] = [primary];
  for (const fbId of fallbackIds) {
    try {
      const fbKey = process.env[envKeyForProvider(fbId)];
      if (!fbKey) continue;
      const fb = createVideoProvider(fbId);
      await fb.initialize({ apiKey: fbKey });
      chain.push(fb);
    } catch {
      // Skip providers that fail to initialise (missing creds, etc.).
    }
  }

  if (chain.length <= 1) {
    return primary;
  }

  return new FallbackVideoProxy(chain, videoFallbackEmitter);
}

// ---------------------------------------------------------------------------
// Public options / result types
// ---------------------------------------------------------------------------

/**
 * Options for a {@link generateVideo} call.
 *
 * At minimum, a `prompt` is required. The provider is resolved from
 * `opts.provider`, `opts.apiKey`, or the first video-capable env var
 * found (`RUNWAY_API_KEY` -> `REPLICATE_API_TOKEN` -> `FAL_API_KEY`).
 */
export interface GenerateVideoOptions {
  /** Text prompt describing the desired video content. */
  prompt: string;

  /**
   * Source image for image-to-video generation. When provided, the
   * request is dispatched to `imageToVideo()` instead of `generateVideo()`.
   * Accepts a raw `Buffer`.
   */
  image?: Buffer;

  /**
   * Explicit provider identifier (e.g. `"runway"`, `"replicate"`, `"fal"`).
   * When omitted, auto-detection from environment variables is used.
   */
  provider?: string;

  /**
   * Model identifier within the provider (e.g. `"gen3a_turbo"`,
   * `"klingai/kling-v1"`). When omitted, the provider's default model
   * is used.
   */
  model?: string;

  /** Desired output duration in seconds. */
  durationSec?: number;

  /** Desired aspect ratio (e.g. `"16:9"`, `"9:16"`). */
  aspectRatio?: VideoAspectRatio;

  /** Desired output resolution (e.g. `"1280x720"`, `"720p"`). */
  resolution?: string;

  /** Negative prompt describing content to avoid. */
  negativePrompt?: string;

  /** Random seed for reproducible generation (provider-dependent). */
  seed?: number;

  /**
   * Maximum time in milliseconds to wait for generation to complete.
   * Provider-dependent — not all providers honour client-side timeouts.
   */
  timeoutMs?: number;

  /**
   * Optional progress callback invoked during long-running generation.
   * Called with a {@link VideoProgressEvent} at each status transition.
   */
  onProgress?: (event: VideoProgressEvent) => void;

  /** Override the provider API key instead of reading from env vars. */
  apiKey?: string;

  /** Override the provider base URL. */
  baseUrl?: string;

  /** Optional durable usage ledger configuration for accounting. */
  usageLedger?: AgentOSUsageLedgerOptions;
}

/**
 * The result returned by {@link generateVideo}.
 *
 * Wraps the core {@link VideoResult} with a simpler, AI-SDK-style shape.
 */
export interface GenerateVideoResult {
  /** Model identifier reported by the provider. */
  model: string;
  /** Provider identifier (e.g. `"runway"`, `"replicate"`, `"fal"`). */
  provider: string;
  /** Unix timestamp (ms) when the video was created. */
  created: number;
  /** Array of generated video objects containing URLs or base64 data. */
  videos: VideoResult['videos'];
  /** Usage / billing information, if available. */
  usage?: VideoResult['usage'];
}

// ---------------------------------------------------------------------------
// Main API function
// ---------------------------------------------------------------------------

/**
 * Generates a video using a provider-agnostic interface.
 *
 * Resolves provider credentials via explicit options or environment variable
 * auto-detection, initialises the matching video provider (optionally wrapped
 * in a fallback chain), and returns a normalised {@link GenerateVideoResult}.
 *
 * When `opts.image` is provided, the request is routed to
 * {@link IVideoGenerator.imageToVideo} for image-to-video generation.
 * Otherwise, {@link IVideoGenerator.generateVideo} is used for text-to-video.
 *
 * @param opts - Video generation options.
 * @returns A promise resolving to the generation result with video data and metadata.
 *
 * @example
 * ```ts
 * // Text-to-video
 * const result = await generateVideo({
 *   prompt: 'A drone flying over a misty forest at sunrise',
 *   provider: 'runway',
 *   durationSec: 5,
 * });
 * console.log(result.videos[0].url);
 *
 * // Image-to-video
 * const i2v = await generateVideo({
 *   prompt: 'Camera slowly zooms out',
 *   image: fs.readFileSync('input.png'),
 * });
 * ```
 */
export async function generateVideo(opts: GenerateVideoOptions): Promise<GenerateVideoResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';
  let metricUsage: VideoResult['usage'];
  let metricProviderId: string | undefined;
  let metricModelId: string | undefined;

  try {
    return await withAgentOSSpan('agentos.api.generate_video', async (span) => {
      // --- Resolve provider ---
      let providerId: string;
      let apiKey: string;

      if (opts.provider) {
        providerId = opts.provider;
        apiKey =
          opts.apiKey ??
          process.env[envKeyForProvider(providerId)] ??
          '';
        if (!apiKey) {
          throw new Error(
            `No API key for video provider "${providerId}". Set ${envKeyForProvider(providerId)} or pass apiKey.`,
          );
        }
      } else if (opts.apiKey) {
        // Caller supplied a key but no provider — try auto-detect anyway
        const detected = autoDetectVideoProvider();
        providerId = detected?.providerId ?? 'runway';
        apiKey = opts.apiKey;
      } else {
        const detected = autoDetectVideoProvider();
        if (!detected) {
          throw new Error(
            'No video provider configured. Set RUNWAY_API_KEY, REPLICATE_API_TOKEN, or FAL_API_KEY.',
          );
        }
        providerId = detected.providerId;
        apiKey = detected.apiKey;
      }

      metricProviderId = providerId;
      metricModelId = opts.model;

      span?.setAttribute('llm.provider', providerId);
      if (opts.model) span?.setAttribute('llm.model', opts.model);

      // --- Create provider (with fallback chain) ---
      const provider = await createVideoProviderWithFallback(
        providerId,
        apiKey,
        opts.model,
        opts.baseUrl,
      );

      // --- Dispatch to text-to-video or image-to-video ---
      let result: VideoResult;

      if (opts.image) {
        // Image-to-video
        result = await provider.imageToVideo!({
          modelId: opts.model ?? provider.defaultModelId ?? '',
          image: opts.image,
          prompt: opts.prompt,
          negativePrompt: opts.negativePrompt,
          durationSec: opts.durationSec,
          aspectRatio: opts.aspectRatio,
          seed: opts.seed,
          providerOptions: opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined,
        });
      } else {
        // Text-to-video
        result = await provider.generateVideo({
          modelId: opts.model ?? provider.defaultModelId ?? '',
          prompt: opts.prompt,
          negativePrompt: opts.negativePrompt,
          durationSec: opts.durationSec,
          aspectRatio: opts.aspectRatio,
          resolution: opts.resolution,
          seed: opts.seed,
          providerOptions: opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined,
        });
      }

      metricUsage = result.usage;
      metricModelId = result.modelId;
      span?.setAttribute('agentos.api.videos_count', result.videos.length);

      if (result.usage?.totalCostUSD !== undefined) {
        attachUsageAttributes(span, { totalCostUSD: result.usage.totalCostUSD });
      }

      return {
        model: result.modelId,
        provider: result.providerId,
        created: result.created,
        videos: result.videos,
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
              totalTokens: metricUsage.totalVideos,
              costUSD: metricUsage.totalCostUSD,
            }
          : undefined,
        options: {
          ...opts.usageLedger,
          source: opts.usageLedger?.source ?? 'generateVideo',
        },
      });
    } catch {
      // Usage persistence is best-effort and should not break generation.
    }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
      usage: toTurnMetricUsage(
        metricUsage
          ? { totalCostUSD: metricUsage.totalCostUSD }
          : undefined,
      ),
    });
  }
}
