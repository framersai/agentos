/**
 * @file transferStyle.ts
 * Provider-agnostic style transfer for the AgentOS high-level API.
 *
 * Applies the visual aesthetic of a reference image to a source image,
 * guided by a text prompt. Internally routes to the best available
 * provider for style transfer:
 *
 * - **Replicate** (preferred): Flux Redux — purpose-built for image-guided generation
 * - **Fal**: Flux Dev img2img with style reference in prompt
 * - **Stability**: img2img with strength control
 * - **OpenAI**: editImage with descriptive prompt
 *
 * @module agentos/api/transferStyle
 *
 * @example
 * ```typescript
 * import { transferStyle } from '../api/transferStyle.js';
 *
 * const result = await transferStyle({
 *   image: './photo.jpg',
 *   styleReference: './monet-painting.jpg',
 *   prompt: 'Impressionist oil painting with warm golden light',
 *   strength: 0.7,
 * });
 * console.log(result.images[0].url);
 * ```
 */
import { createImageProvider, hasImageProviderFactory } from '../media/images/index.js';
import { imageToBuffer } from '../media/images/imageToBuffer.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { recordAgentOSUsage } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
// ---------------------------------------------------------------------------
// Provider detection — ordered by style transfer capability
// ---------------------------------------------------------------------------
const STYLE_TRANSFER_PROVIDER_PRIORITY = [
    { envKey: 'REPLICATE_API_TOKEN', providerId: 'replicate', modelId: 'black-forest-labs/flux-redux-dev' },
    { envKey: 'FAL_API_KEY', providerId: 'fal', modelId: 'fal-ai/flux/dev' },
    { envKey: 'STABILITY_API_KEY', providerId: 'stability', modelId: 'stable-image-core' },
    { envKey: 'OPENAI_API_KEY', providerId: 'openai', modelId: 'gpt-image-1' },
];
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Transfers the visual aesthetic of a reference image onto a source image.
 *
 * Routes to the best available provider:
 * - **Replicate** (Flux Redux): purpose-built for image-guided style transfer
 * - **Fal** (Flux Dev): img2img with style guidance
 * - **Stability** (img2img): strength-controlled transformation
 * - **OpenAI** (edit): prompt-guided editing
 *
 * @param opts - Style transfer options.
 * @returns Promise resolving to the transfer result with styled image(s).
 *
 * @throws {Error} When no style transfer provider is available.
 *
 * @example
 * ```typescript
 * // Photo to oil painting
 * const result = await transferStyle({
 *   image: photoBuffer,
 *   styleReference: './monet.jpg',
 *   prompt: 'Impressionist oil painting, warm golden light, visible brushstrokes',
 *   strength: 0.7,
 * });
 * ```
 */
export async function transferStyle(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    let metricUsage;
    try {
        return await withAgentOSSpan('agentos.api.transfer_style', async (span) => {
            // Resolve provider
            let providerId;
            let modelId;
            if (opts.provider) {
                ({ providerId, modelId } = resolveModelOption(opts, 'image'));
            }
            else {
                // Auto-detect best available style transfer provider
                const match = STYLE_TRANSFER_PROVIDER_PRIORITY.find((p) => process.env[p.envKey] && hasImageProviderFactory(p.providerId));
                if (!match) {
                    throw new Error('No style transfer provider configured. Set REPLICATE_API_TOKEN, FAL_API_KEY, STABILITY_API_KEY, or OPENAI_API_KEY.');
                }
                providerId = match.providerId;
                modelId = opts.model ?? match.modelId;
            }
            const resolved = resolveMediaProvider(providerId, modelId);
            span?.setAttribute('llm.provider', resolved.providerId);
            span?.setAttribute('llm.model', resolved.modelId);
            const provider = createImageProvider(resolved.providerId);
            await provider.initialize({
                apiKey: resolved.apiKey,
                baseURL: resolved.baseUrl,
                defaultModelId: resolved.modelId,
            });
            // Convert style reference to data URL for Flux Redux
            const styleBuffer = await imageToBuffer(opts.styleReference);
            const styleDataUrl = `data:image/png;base64,${styleBuffer.toString('base64')}`;
            let result;
            if (resolved.providerId === 'replicate' && resolved.modelId.includes('flux-redux')) {
                // Flux Redux: style reference is the primary image input
                result = await provider.generateImage({
                    modelId: resolved.modelId,
                    prompt: opts.prompt,
                    size: opts.size,
                    seed: opts.seed,
                    negativePrompt: opts.negativePrompt,
                    referenceImageUrl: styleDataUrl,
                    providerOptions: opts.providerOptions,
                });
            }
            else if (typeof provider.editImage === 'function') {
                // Providers with editImage: use img2img
                const imageBuffer = await imageToBuffer(opts.image);
                result = await provider.editImage({
                    modelId: resolved.modelId,
                    image: imageBuffer,
                    prompt: opts.prompt,
                    strength: opts.strength ?? 0.7,
                    size: opts.size,
                    seed: opts.seed,
                    negativePrompt: opts.negativePrompt,
                    providerOptions: opts.providerOptions,
                });
            }
            else {
                // Fallback: generate with style description in prompt
                result = await provider.generateImage({
                    modelId: resolved.modelId,
                    prompt: `${opts.prompt}. Apply the visual style and aesthetic of the reference.`,
                    size: opts.size,
                    seed: opts.seed,
                    negativePrompt: opts.negativePrompt,
                    providerOptions: opts.providerOptions,
                });
            }
            metricUsage = result.usage;
            return {
                images: result.images,
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
                usage: metricUsage ? { costUSD: metricUsage.totalCostUSD } : undefined,
                options: { ...opts.usageLedger, source: opts.usageLedger?.source ?? 'transferStyle' },
            });
        }
        catch { /* best-effort */ }
        recordAgentOSTurnMetrics({
            durationMs: Date.now() - startedAt,
            status: metricStatus,
        });
    }
}
//# sourceMappingURL=transferStyle.js.map