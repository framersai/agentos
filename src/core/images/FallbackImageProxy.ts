/**
 * @file FallbackImageProxy.ts
 * Automatic failover proxy for image generation, editing, upscaling,
 * and variation providers.
 *
 * Follows the same pattern established by {@link FallbackSTTProxy} and
 * {@link FallbackTTSProxy} in the speech subsystem: an ordered chain of
 * {@link IImageProvider} instances is tried left-to-right for each
 * operation.  The first provider that succeeds wins; earlier failures
 * are caught, logged via an emitted event, and the next provider is
 * tried.
 *
 * ## Unsupported-operation handling
 *
 * For optional operations (`editImage`, `upscaleImage`, `variateImage`)
 * the proxy skips providers that either:
 * - do not implement the method at all (`typeof method !== 'function'`), or
 * - throw an error whose `name` ends with `NotSupportedError` (the convention
 *   used by {@link ImageEditNotSupportedError},
 *   {@link ImageUpscaleNotSupportedError}, and
 *   {@link ImageVariationNotSupportedError}).
 *
 * Both cases are treated as "this provider cannot help" rather than
 * transient failures, so the proxy advances to the next candidate
 * without counting the skip as a true error.
 *
 * @see {@link FallbackSTTProxy} for the analogous speech-to-text proxy.
 * @see {@link FallbackTTSProxy} for the analogous text-to-speech proxy.
 *
 * @example
 * ```ts
 * import { EventEmitter } from 'events';
 * import { FallbackImageProxy } from './FallbackImageProxy.js';
 *
 * const emitter = new EventEmitter();
 * emitter.on('image:fallback', (evt) => {
 *   console.warn(`Image fallback: ${evt.from} -> ${evt.to} (${evt.reason})`);
 * });
 *
 * const proxy = new FallbackImageProxy(
 *   [openaiProvider, stabilityProvider, replicateProvider],
 *   emitter,
 * );
 *
 * // If OpenAI fails, Stability is tried, then Replicate.
 * const result = await proxy.generateImage(request);
 * ```
 */

import { EventEmitter } from 'events';
import type {
  IImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageEditRequest,
  ImageUpscaleRequest,
  ImageVariateRequest,
  ImageModelInfo,
} from './IImageProvider.js';

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

/**
 * Payload emitted on the `image:fallback` event when a provider in the
 * chain fails and the proxy advances to the next candidate.
 *
 * @example
 * ```ts
 * emitter.on('image:fallback', (evt: ImageFallbackEvent) => {
 *   console.warn(`${evt.from} -> ${evt.to}: ${evt.reason}`);
 * });
 * ```
 */
export interface ImageFallbackEvent {
  /** The event discriminator. Always `'image:fallback'`. */
  type: 'image:fallback';
  /** Identifier of the provider that failed. */
  from: string;
  /** Identifier of the provider that will be tried next. */
  to: string;
  /** Human-readable reason for the fallback (error message or "not supported"). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when an error indicates the provider does not support
 * the requested operation, as opposed to a transient failure.
 *
 * Matches errors whose `name` ends with `NotSupportedError` — the convention
 * used by {@link ImageEditNotSupportedError}, etc.
 */
function isNotSupportedError(err: unknown): boolean {
  if (err instanceof Error && err.name.endsWith('NotSupportedError')) {
    return true;
  }
  return false;
}

/**
 * Extracts a human-readable reason string from an unknown error value.
 */
function errorReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// FallbackImageProxy
// ---------------------------------------------------------------------------

/**
 * An {@link IImageProvider} that wraps an ordered chain of image providers
 * and implements automatic failover for every operation.
 *
 * ## Retry chain logic
 *
 * Providers are tried left-to-right (index 0 first). The first provider
 * that succeeds returns immediately. When a provider throws:
 *
 * - **If it is NOT the last provider:** a `image:fallback` event is
 *   emitted and the next provider is tried.
 * - **If it IS the last provider:** an `AggregateError` containing every
 *   collected error is thrown.
 * - **If the chain is empty:** an `Error('No providers in image fallback chain')`
 *   is thrown immediately.
 *
 * For optional operations (edit/upscale/variate), providers that do not
 * implement the method or throw a `*NotSupportedError` are silently
 * skipped, since they are structurally incapable rather than transiently
 * failing.
 */
export class FallbackImageProxy implements IImageProvider {
  /** Identifier derived from the first provider in the chain. */
  readonly providerId: string;

  /** Always `true` — the proxy is ready as soon as it is constructed. */
  readonly isInitialized: boolean = true;

  /** Default model from the first provider, if set. */
  readonly defaultModelId?: string;

  /**
   * Creates a new FallbackImageProxy wrapping the given provider chain.
   *
   * @param chain - Ordered list of image providers to try. Must contain at
   *   least one entry for operations to succeed (an empty chain always throws).
   * @param emitter - EventEmitter on which `image:fallback` events are
   *   published so callers can observe the failover path.
   *
   * @example
   * ```ts
   * const proxy = new FallbackImageProxy(
   *   [openaiProvider, stabilityProvider],
   *   new EventEmitter(),
   * );
   * ```
   */
  constructor(
    private readonly chain: IImageProvider[],
    private readonly emitter: EventEmitter,
  ) {
    this.providerId = chain[0]?.providerId ?? 'fallback-image';
    this.defaultModelId = chain[0]?.defaultModelId;
  }

  // -----------------------------------------------------------------------
  // IImageProvider — initialize (no-op for the proxy itself)
  // -----------------------------------------------------------------------

  /**
   * No-op initialisation — individual providers in the chain should already
   * be initialised before being passed to the proxy.
   */
  async initialize(_config: Record<string, unknown>): Promise<void> {
    // Each provider in the chain is initialised independently before
    // construction, so the proxy itself has nothing to set up.
  }

  // -----------------------------------------------------------------------
  // IImageProvider — generateImage
  // -----------------------------------------------------------------------

  /**
   * Generate an image, falling back through the provider chain on failure.
   *
   * @param request - The generation request forwarded to each provider.
   * @returns The result from the first provider that succeeds.
   * @throws {AggregateError} When every provider in the chain fails.
   * @throws {Error} When the chain is empty.
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return this.runWithFallback(
      'generateImage',
      (provider) => provider.generateImage(request),
    );
  }

  // -----------------------------------------------------------------------
  // IImageProvider — editImage (optional)
  // -----------------------------------------------------------------------

  /**
   * Edit an image, falling back through providers that support editing.
   *
   * Providers that do not implement `editImage` or that throw a
   * `*NotSupportedError` are silently skipped.
   *
   * @param request - The edit request forwarded to each capable provider.
   * @returns The result from the first provider that succeeds.
   * @throws {AggregateError} When every provider fails or does not support editing.
   */
  async editImage(request: ImageEditRequest): Promise<ImageGenerationResult> {
    return this.runWithFallback(
      'editImage',
      (provider) => {
        if (typeof provider.editImage !== 'function') {
          throw Object.assign(
            new Error(`Provider "${provider.providerId}" does not support editImage.`),
            { name: 'ImageEditNotSupportedError' },
          );
        }
        return provider.editImage(request);
      },
    );
  }

  // -----------------------------------------------------------------------
  // IImageProvider — upscaleImage (optional)
  // -----------------------------------------------------------------------

  /**
   * Upscale an image, falling back through providers that support upscaling.
   *
   * @param request - The upscale request forwarded to each capable provider.
   * @returns The result from the first provider that succeeds.
   * @throws {AggregateError} When every provider fails or does not support upscaling.
   */
  async upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult> {
    return this.runWithFallback(
      'upscaleImage',
      (provider) => {
        if (typeof provider.upscaleImage !== 'function') {
          throw Object.assign(
            new Error(`Provider "${provider.providerId}" does not support upscaleImage.`),
            { name: 'ImageUpscaleNotSupportedError' },
          );
        }
        return provider.upscaleImage(request);
      },
    );
  }

  // -----------------------------------------------------------------------
  // IImageProvider — variateImage (optional)
  // -----------------------------------------------------------------------

  /**
   * Generate variations of an image, falling back through providers that
   * support the operation.
   *
   * @param request - The variation request forwarded to each capable provider.
   * @returns The result from the first provider that succeeds.
   * @throws {AggregateError} When every provider fails or does not support variations.
   */
  async variateImage(request: ImageVariateRequest): Promise<ImageGenerationResult> {
    return this.runWithFallback(
      'variateImage',
      (provider) => {
        if (typeof provider.variateImage !== 'function') {
          throw Object.assign(
            new Error(`Provider "${provider.providerId}" does not support variateImage.`),
            { name: 'ImageVariationNotSupportedError' },
          );
        }
        return provider.variateImage(request);
      },
    );
  }

  // -----------------------------------------------------------------------
  // IImageProvider — listAvailableModels (optional, best-effort)
  // -----------------------------------------------------------------------

  /**
   * Returns the model list from the first provider in the chain that
   * implements `listAvailableModels`. Returns an empty array when none do.
   */
  async listAvailableModels(): Promise<ImageModelInfo[]> {
    for (const provider of this.chain) {
      if (typeof provider.listAvailableModels === 'function') {
        return provider.listAvailableModels();
      }
    }
    return [];
  }

  // -----------------------------------------------------------------------
  // IImageProvider — shutdown (optional)
  // -----------------------------------------------------------------------

  /**
   * Shuts down all providers in the chain. Errors are caught per-provider
   * so a single provider's failure does not prevent the others from
   * cleaning up.
   */
  async shutdown(): Promise<void> {
    for (const provider of this.chain) {
      if (typeof provider.shutdown === 'function') {
        try {
          await provider.shutdown();
        } catch {
          // Swallow individual shutdown errors — best effort.
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Core fallback loop
  // -----------------------------------------------------------------------

  /**
   * Executes an operation against each provider in the chain until one
   * succeeds or all have been exhausted.
   *
   * @param operationName - Human-readable name of the operation (for error messages).
   * @param execute - Async callback that runs the operation on a single provider.
   * @returns The result from the first successful provider.
   * @throws {AggregateError} When every provider fails.
   */
  private async runWithFallback(
    operationName: string,
    execute: (provider: IImageProvider) => Promise<ImageGenerationResult>,
  ): Promise<ImageGenerationResult> {
    if (this.chain.length === 0) {
      throw new Error('No providers in image fallback chain');
    }

    const errors: Error[] = [];

    for (let i = 0; i < this.chain.length; i++) {
      const provider = this.chain[i];
      try {
        return await execute(provider);
      } catch (err: unknown) {
        const reason = isNotSupportedError(err)
          ? `${operationName} not supported`
          : errorReason(err);

        errors.push(
          err instanceof Error ? err : new Error(String(err)),
        );

        // Emit a fallback event when there is a next provider to try.
        if (i < this.chain.length - 1) {
          const event: ImageFallbackEvent = {
            type: 'image:fallback',
            from: provider.providerId,
            to: this.chain[i + 1].providerId,
            reason,
          };
          this.emitter.emit('image:fallback', event);
        }
      }
    }

    // All providers exhausted — throw an aggregate error.
    throw new AggregateError(
      errors,
      `All ${this.chain.length} image providers failed for ${operationName}: ${errors.map((e) => e.message).join('; ')}`,
    );
  }
}
