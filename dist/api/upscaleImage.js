/**
 * @file upscaleImage.ts
 * Provider-agnostic image upscaling (super-resolution) for the AgentOS high-level API.
 *
 * Increases the resolution of an existing image using specialised upscaling
 * models.  Callers can request either a fixed scale factor (2x, 4x) or
 * explicit target dimensions.
 *
 * Provider support:
 * - **Stability AI** — `/v2beta/stable-image/upscale/conservative`
 * - **Stable Diffusion Local (A1111)** — `/sdapi/v1/extra-single-image`
 * - **Replicate** — `nightmareai/real-esrgan` (or caller-specified model)
 * - **OpenAI** — not supported (throws {@link ImageUpscaleNotSupportedError})
 */
import { createImageProvider } from '../media/images/index.js';
import { ImageUpscaleNotSupportedError } from '../media/images/ImageOperationError.js';
import { imageToBuffer } from '../media/images/imageToBuffer.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Upscales an image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `upscaleImage` method.
 *
 * @param opts - Upscale options including the source image and desired scale.
 * @returns A promise resolving to the upscale result with the higher-resolution image.
 *
 * @throws {ImageUpscaleNotSupportedError} When the resolved provider does not
 *   implement image upscaling.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * const result = await upscaleImage({
 *   provider: 'stability',
 *   image: 'https://example.com/lowres.jpg',
 *   scale: 4,
 * });
 * console.log(result.image.dataUrl);
 * ```
 */
export async function upscaleImage(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    let metricUsage;
    let metricProviderId;
    let metricModelId;
    try {
        return await withAgentOSSpan('agentos.api.upscale_image', async (span) => {
            const { providerId, modelId } = resolveModelOption(opts, 'image');
            const resolved = resolveMediaProvider(providerId, modelId, {
                apiKey: opts.apiKey,
                baseUrl: opts.baseUrl,
            });
            metricProviderId = resolved.providerId;
            metricModelId = resolved.modelId;
            span?.setAttribute('llm.provider', resolved.providerId);
            span?.setAttribute('llm.model', resolved.modelId);
            span?.setAttribute('agentos.api.upscale_factor', opts.scale ?? 2);
            const provider = createImageProvider(resolved.providerId);
            await provider.initialize({
                apiKey: resolved.apiKey,
                baseURL: resolved.baseUrl,
                defaultModelId: resolved.modelId,
            });
            // Guard: the provider must implement upscaleImage.
            if (typeof provider.upscaleImage !== 'function') {
                throw new ImageUpscaleNotSupportedError(resolved.providerId);
            }
            const imageBuffer = await imageToBuffer(opts.image);
            const result = await provider.upscaleImage({
                modelId: resolved.modelId,
                image: imageBuffer,
                scale: opts.scale,
                width: opts.width,
                height: opts.height,
                providerOptions: opts.providerOptions,
            });
            metricUsage = result.usage;
            span?.setAttribute('agentos.api.images_count', result.images.length);
            attachUsageAttributes(span, {
                totalCostUSD: result.usage?.totalCostUSD,
            });
            return {
                image: result.images[0],
                provider: result.providerId,
                model: result.modelId,
                usage: { costUSD: result.usage?.totalCostUSD },
            };
        });
    }
    catch (error) {
        metricStatus = 'error';
        throw error;
    }
    finally {
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
                    source: opts.usageLedger?.source ?? 'upscaleImage',
                },
            });
        }
        catch {
            // Best-effort — usage persistence must not break the upscale operation.
        }
        recordAgentOSTurnMetrics({
            durationMs: Date.now() - startedAt,
            status: metricStatus,
            usage: toTurnMetricUsage(metricUsage
                ? {
                    totalCostUSD: metricUsage.totalCostUSD,
                }
                : undefined),
        });
    }
}
//# sourceMappingURL=upscaleImage.js.map