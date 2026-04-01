import { getImageProviderOptions, inferAspectRatioFromSize, parseDataUrl, normalizeOutputFormat, } from '../IImageProvider.js';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeReplicateOutput(output) {
    const items = Array.isArray(output) ? output : [output];
    const images = [];
    for (const item of items) {
        if (typeof item === 'string') {
            const parsed = parseDataUrl(item);
            images.push({
                ...parsed,
                url: parsed.dataUrl?.startsWith('data:') ? undefined : parsed.dataUrl,
            });
            continue;
        }
        if (item && typeof item === 'object') {
            const candidate = item;
            const value = (typeof candidate.url === 'string' && candidate.url)
                || (typeof candidate.uri === 'string' && candidate.uri)
                || (typeof candidate.output === 'string' && candidate.output);
            if (!value) {
                continue;
            }
            const parsed = parseDataUrl(value);
            images.push({
                ...parsed,
                url: parsed.dataUrl?.startsWith('data:') ? undefined : parsed.dataUrl,
                providerMetadata: candidate,
            });
        }
    }
    return images;
}
export class ReplicateImageProvider {
    constructor() {
        this.providerId = 'replicate';
        this.isInitialized = false;
    }
    async initialize(config) {
        const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
        if (!apiKey) {
            throw new Error('Replicate image provider requires apiKey.');
        }
        this.config = {
            apiKey,
            baseURL: typeof config.baseURL === 'string' && config.baseURL.trim()
                ? config.baseURL.trim()
                : 'https://api.replicate.com/v1',
            defaultModelId: typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
                ? config.defaultModelId.trim()
                : 'black-forest-labs/flux-schnell',
        };
        this.defaultModelId = this.config.defaultModelId;
        this.isInitialized = true;
    }
    async generateImage(request) {
        if (!this.isInitialized) {
            throw new Error('Replicate image provider is not initialized.');
        }
        const providerOptions = getImageProviderOptions(this.providerId, request.providerOptions);
        const input = {
            prompt: request.prompt,
            ...(providerOptions?.input ?? {}),
        };
        const aspectRatio = providerOptions?.aspectRatio ?? request.aspectRatio ?? inferAspectRatioFromSize(request.size);
        if (aspectRatio && input.aspect_ratio === undefined)
            input.aspect_ratio = aspectRatio;
        if (request.n && input.num_outputs === undefined)
            input.num_outputs = request.n;
        if (providerOptions?.numOutputs !== undefined)
            input.num_outputs = providerOptions.numOutputs;
        if (request.seed !== undefined && input.seed === undefined)
            input.seed = request.seed;
        if (providerOptions?.seed !== undefined)
            input.seed = providerOptions.seed;
        if (request.negativePrompt && input.negative_prompt === undefined)
            input.negative_prompt = request.negativePrompt;
        if (providerOptions?.negativePrompt !== undefined)
            input.negative_prompt = providerOptions.negativePrompt;
        if (request.outputFormat && input.output_format === undefined) {
            input.output_format = normalizeOutputFormat(providerOptions?.outputFormat ?? request.outputFormat);
        }
        if (providerOptions?.outputFormat !== undefined) {
            input.output_format = normalizeOutputFormat(providerOptions.outputFormat);
        }
        if (providerOptions?.outputQuality !== undefined)
            input.output_quality = providerOptions.outputQuality;
        if (providerOptions?.disableSafetyChecker !== undefined) {
            input.disable_safety_checker = providerOptions.disableSafetyChecker;
        }
        if (providerOptions?.goFast !== undefined)
            input.go_fast = providerOptions.goFast;
        if (providerOptions?.megapixels !== undefined)
            input.megapixels = providerOptions.megapixels;
        const body = {
            version: request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell',
            input,
        };
        if (providerOptions?.webhook)
            body.webhook = providerOptions.webhook;
        if (providerOptions?.webhookEventsFilter)
            body.webhook_events_filter = providerOptions.webhookEventsFilter;
        if (providerOptions?.extraBody)
            Object.assign(body, providerOptions.extraBody);
        const waitSeconds = providerOptions?.wait ?? 60;
        let prediction = await this.createPrediction(body, waitSeconds);
        if (prediction.status
            && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
            && prediction.urls?.get) {
            prediction = await this.pollPrediction(prediction.urls.get, 60000, 1000);
        }
        if (prediction.status === 'failed') {
            throw new Error(`Replicate image generation failed: ${prediction.error ?? 'unknown error'}`);
        }
        if (prediction.status === 'canceled') {
            throw new Error('Replicate image generation was canceled.');
        }
        const images = normalizeReplicateOutput(prediction.output);
        if (images.length === 0) {
            throw new Error('Replicate returned no image output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: String(body.version),
            providerId: this.providerId,
            images,
            usage: {
                totalImages: images.length,
            },
        };
    }
    /**
     * Edits an image using a Replicate model that supports image-to-image input.
     *
     * Uses `black-forest-labs/flux-fill` for inpainting (when a mask is provided)
     * or falls back to `stability-ai/sdxl` for generic img2img transforms.
     * The source image is passed as a base64 data URL in the model input.
     *
     * @param request - Edit request with source image, prompt, and optional mask.
     * @returns Generation result with the edited image(s).
     *
     * @throws {Error} When the provider is not initialised or the API fails.
     */
    async editImage(request) {
        if (!this.isInitialized) {
            throw new Error('Replicate image provider is not initialized.');
        }
        const providerOptions = getImageProviderOptions(this.providerId, request.providerOptions);
        // Convert image buffer to a base64 data URL that Replicate models accept.
        const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
        const input = {
            prompt: request.prompt,
            image: imageDataUrl,
            ...(providerOptions?.input ?? {}),
        };
        // Choose the model based on whether inpainting is requested.
        const hasInpaintingMask = !!request.mask;
        const defaultModel = hasInpaintingMask
            ? 'black-forest-labs/flux-fill' // Flux Fill is purpose-built for inpainting.
            : 'stability-ai/sdxl'; // SDXL supports generic img2img via image input.
        if (hasInpaintingMask) {
            input.mask = `data:image/png;base64,${request.mask.toString('base64')}`;
        }
        if (request.strength !== undefined)
            input.strength = request.strength;
        if (request.negativePrompt)
            input.negative_prompt = request.negativePrompt;
        if (request.seed !== undefined)
            input.seed = request.seed;
        if (request.n)
            input.num_outputs = request.n;
        const model = request.modelId || defaultModel;
        const body = {
            version: model,
            input,
        };
        if (providerOptions?.extraBody)
            Object.assign(body, providerOptions.extraBody);
        const waitSeconds = providerOptions?.wait ?? 60;
        let prediction = await this.createPrediction(body, waitSeconds);
        if (prediction.status
            && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
            && prediction.urls?.get) {
            prediction = await this.pollPrediction(prediction.urls.get, 60000, 1000);
        }
        if (prediction.status === 'failed') {
            throw new Error(`Replicate image edit failed: ${prediction.error ?? 'unknown error'}`);
        }
        const images = normalizeReplicateOutput(prediction.output);
        if (images.length === 0) {
            throw new Error('Replicate edit returned no image output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            images,
            usage: { totalImages: images.length },
        };
    }
    /**
     * Upscales an image using a Replicate upscaling model.
     *
     * Defaults to `nightmareai/real-esrgan` which supports 2x and 4x upscaling
     * via the `scale` input parameter.
     *
     * @param request - Upscale request with source image and desired scale factor.
     * @returns Generation result with the upscaled image.
     *
     * @throws {Error} When the provider is not initialised or the API fails.
     */
    async upscaleImage(request) {
        if (!this.isInitialized) {
            throw new Error('Replicate image provider is not initialized.');
        }
        const providerOptions = getImageProviderOptions(this.providerId, request.providerOptions);
        const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
        const input = {
            image: imageDataUrl,
            scale: request.scale ?? 2,
            ...(providerOptions?.input ?? {}),
        };
        const model = request.modelId || 'nightmareai/real-esrgan';
        const body = {
            version: model,
            input,
        };
        const waitSeconds = providerOptions?.wait ?? 60;
        let prediction = await this.createPrediction(body, waitSeconds);
        if (prediction.status
            && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
            && prediction.urls?.get) {
            prediction = await this.pollPrediction(prediction.urls.get, 60000, 1000);
        }
        if (prediction.status === 'failed') {
            throw new Error(`Replicate image upscale failed: ${prediction.error ?? 'unknown error'}`);
        }
        const images = normalizeReplicateOutput(prediction.output);
        if (images.length === 0) {
            throw new Error('Replicate upscale returned no image output.');
        }
        return {
            created: Math.floor(Date.now() / 1000),
            modelId: model,
            providerId: this.providerId,
            images,
            usage: { totalImages: images.length },
        };
    }
    async listAvailableModels() {
        return [
            { providerId: this.providerId, modelId: 'black-forest-labs/flux-schnell', displayName: 'Flux Schnell' },
            { providerId: this.providerId, modelId: 'black-forest-labs/flux-dev', displayName: 'Flux Dev' },
            { providerId: this.providerId, modelId: 'black-forest-labs/flux-pro', displayName: 'Flux Pro' },
        ];
    }
    async createPrediction(body, waitSeconds) {
        const response = await fetch(`${this.config.baseURL}/predictions`, {
            method: 'POST',
            headers: {
                Authorization: `Token ${this.config.apiKey}`,
                'Content-Type': 'application/json',
                Prefer: `wait=${waitSeconds}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Replicate image generation failed (${response.status}): ${errorText}`);
        }
        return (await response.json());
    }
    async pollPrediction(url, timeoutMs, pollIntervalMs) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Token ${this.config.apiKey}`,
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Replicate prediction polling failed (${response.status}): ${errorText}`);
            }
            const prediction = (await response.json());
            if (!prediction.status || ['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
                return prediction;
            }
            await sleep(pollIntervalMs);
        }
        throw new Error('Replicate image generation timed out while waiting for prediction output.');
    }
}
//# sourceMappingURL=ReplicateImageProvider.js.map