/**
 * @file editImage.ts
 * Provider-agnostic image editing for the AgentOS high-level API.
 *
 * Supports three editing modes:
 * - **img2img** — Prompt-guided transformation of a source image, controlled by a
 *   `strength` parameter (0 = keep original, 1 = completely redrawn).
 * - **inpaint** — Mask-guided regional editing where white mask regions are
 *   repainted according to the prompt while black regions are preserved.
 * - **outpaint** — Extends an image beyond its original borders (provider support varies).
 *
 * Routing and credential resolution follow the same `provider:model` pattern
 * established by {@link generateImage}.
 */
import { createImageProvider } from '../media/images/index.js';
import { ImageEditNotSupportedError } from '../media/images/ImageOperationError.js';
import { imageToBuffer } from '../media/images/imageToBuffer.js';
import { resolveModelOption, resolveMediaProvider } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Edits an image using a provider-agnostic interface.
 *
 * Resolves credentials via `resolveMediaProvider()`, initialises the
 * matching image provider, converts the input image to a `Buffer`, and
 * dispatches to the provider's `editImage` method.
 *
 * @param opts - Image editing options.
 * @returns A promise resolving to the edit result with image data and metadata.
 *
 * @throws {ImageEditNotSupportedError} When the resolved provider does not
 *   implement image editing.
 * @throws {Error} When no provider can be determined or credentials are missing.
 *
 * @example
 * ```ts
 * // Img2img transformation
 * const result = await editImage({
 *   provider: 'stability',
 *   image: fs.readFileSync('landscape.png'),
 *   prompt: 'Convert the daytime scene to a starry night.',
 *   strength: 0.7,
 * });
 *
 * // Inpainting with mask
 * const inpainted = await editImage({
 *   provider: 'openai',
 *   image: 'data:image/png;base64,...',
 *   mask: 'data:image/png;base64,...',
 *   prompt: 'Replace the sky with aurora borealis.',
 *   mode: 'inpaint',
 * });
 * ```
 */
export async function editImage(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    let metricUsage;
    let metricProviderId;
    let metricModelId;
    try {
        return await withAgentOSSpan('agentos.api.edit_image', async (span) => {
            let { providerId, modelId } = resolveModelOption(opts, 'image');
            let effectiveProviderOptions = opts.providerOptions;
            // Policy-tier-aware routing. Mirrors the generateImage flow so
            // both generate and edit surfaces of the API respect the same
            // uncensored catalog and safety-checker bypass. The router only
            // kicks in for mature/private-adult — safe/standard edits keep
            // whatever model the caller resolved above.
            if (opts.policyTier
                && (opts.policyTier === 'mature' || opts.policyTier === 'private-adult')) {
                const { PolicyAwareImageRouter } = await import('../media/images/PolicyAwareImageRouter.js');
                const { createUncensoredModelCatalog } = await import('../core/llm/routing/UncensoredModelCatalog.js');
                const imageRouter = new PolicyAwareImageRouter(createUncensoredModelCatalog());
                // When the caller didn't pin a capability, default to img2img so
                // the catalog never picks a txt2img-only model for an edit call.
                const capabilities = opts.capabilities ?? ['img2img'];
                const pref = imageRouter.getPreferredProvider(opts.policyTier, capabilities);
                if (pref) {
                    providerId = pref.providerId;
                    modelId = pref.modelId;
                    const existingReplicate = effectiveProviderOptions?.replicate;
                    effectiveProviderOptions = {
                        ...(effectiveProviderOptions ?? {}),
                        replicate: {
                            ...(existingReplicate ?? {}),
                            disableSafetyChecker: true,
                        },
                    };
                }
            }
            const resolved = resolveMediaProvider(providerId, modelId, {
                apiKey: opts.apiKey,
                baseUrl: opts.baseUrl,
            });
            metricProviderId = resolved.providerId;
            metricModelId = resolved.modelId;
            span?.setAttribute('llm.provider', resolved.providerId);
            span?.setAttribute('llm.model', resolved.modelId);
            span?.setAttribute('agentos.api.edit_mode', opts.mode ?? 'img2img');
            const provider = createImageProvider(resolved.providerId);
            await provider.initialize({
                apiKey: resolved.apiKey,
                baseURL: resolved.baseUrl,
                defaultModelId: resolved.modelId,
            });
            // Guard: the provider must implement editImage.
            if (typeof provider.editImage !== 'function') {
                throw new ImageEditNotSupportedError(resolved.providerId);
            }
            // Normalise heterogeneous image input into Buffers.
            const imageBuffer = await imageToBuffer(opts.image);
            const maskBuffer = opts.mask ? await imageToBuffer(opts.mask) : undefined;
            const result = await provider.editImage({
                modelId: resolved.modelId,
                image: imageBuffer,
                prompt: opts.prompt,
                mask: maskBuffer,
                mode: opts.mode,
                strength: opts.strength,
                negativePrompt: opts.negativePrompt,
                size: opts.size,
                seed: opts.seed,
                n: opts.n,
                providerOptions: effectiveProviderOptions,
            });
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
                    source: opts.usageLedger?.source ?? 'editImage',
                },
            });
        }
        catch {
            // Best-effort — usage persistence must not break the edit operation.
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
//# sourceMappingURL=editImage.js.map