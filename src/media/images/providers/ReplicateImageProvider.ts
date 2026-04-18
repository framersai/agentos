import {
  type GeneratedImage,
  getImageProviderOptions,
  inferAspectRatioFromSize,
  parseDataUrl,
  type IImageProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageEditRequest,
  type ImageUpscaleRequest,
  type ImageModelInfo,
  normalizeOutputFormat,
  type ReplicateImageProviderOptions,
} from '../IImageProvider.js';
import { ApiKeyPool } from '../../../core/providers/ApiKeyPool.js';

export interface ReplicateImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModelId?: string;
}

type ReplicatePrediction = {
  id?: string;
  status?: string;
  version?: string;
  output?: unknown;
  error?: string;
  metrics?: Record<string, unknown>;
  urls?: {
    get?: string;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeReplicateOutput(output: unknown): GeneratedImage[] {
  const items = Array.isArray(output) ? output : [output];
  const images: GeneratedImage[] = [];

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
      const candidate = item as Record<string, unknown>;
      const value =
        (typeof candidate.url === 'string' && candidate.url)
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

export class ReplicateImageProvider implements IImageProvider {
  public readonly providerId = 'replicate';
  public isInitialized = false;
  public defaultModelId?: string;

  private config!: Required<Pick<ReplicateImageProviderConfig, 'apiKey'>> & ReplicateImageProviderConfig;
  private keyPool!: ApiKeyPool;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw new Error('Replicate image provider requires apiKey.');
    }

    this.config = {
      apiKey,
      baseURL:
        typeof config.baseURL === 'string' && config.baseURL.trim()
          ? config.baseURL.trim()
          : 'https://api.replicate.com/v1',
      defaultModelId:
        typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
          ? config.defaultModelId.trim()
          : 'black-forest-labs/flux-schnell',
    };
    this.defaultModelId = this.config.defaultModelId;
    this.keyPool = new ApiKeyPool(apiKey);
    this.isInitialized = true;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('Replicate image provider is not initialized.');
    }

    const providerOptions = getImageProviderOptions<ReplicateImageProviderOptions>(
      this.providerId,
      request.providerOptions,
    );
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      ...(providerOptions?.input ?? {}),
    };

    const aspectRatio = providerOptions?.aspectRatio ?? request.aspectRatio ?? inferAspectRatioFromSize(request.size);
    if (aspectRatio && input.aspect_ratio === undefined) input.aspect_ratio = aspectRatio;
    if (request.n && input.num_outputs === undefined) input.num_outputs = request.n;
    if (providerOptions?.numOutputs !== undefined) input.num_outputs = providerOptions.numOutputs;
    if (request.seed !== undefined && input.seed === undefined) input.seed = request.seed;
    if (providerOptions?.seed !== undefined) input.seed = providerOptions.seed;
    if (request.negativePrompt && input.negative_prompt === undefined) input.negative_prompt = request.negativePrompt;
    if (providerOptions?.negativePrompt !== undefined) input.negative_prompt = providerOptions.negativePrompt;
    if (request.outputFormat && input.output_format === undefined) {
      input.output_format = normalizeOutputFormat(providerOptions?.outputFormat ?? request.outputFormat);
    }
    if (providerOptions?.outputFormat !== undefined) {
      input.output_format = normalizeOutputFormat(providerOptions.outputFormat);
    }
    if (providerOptions?.outputQuality !== undefined) input.output_quality = providerOptions.outputQuality;
    if (providerOptions?.disableSafetyChecker !== undefined) {
      input.disable_safety_checker = providerOptions.disableSafetyChecker;
    }
    if (providerOptions?.goFast !== undefined) input.go_fast = providerOptions.goFast;
    if (providerOptions?.megapixels !== undefined) input.megapixels = providerOptions.megapixels;

    // --- Character consistency + ControlNet mapping ---
    const CONSISTENCY_STRENGTHS: Record<string, number> = {
      strict: 0.85,
      balanced: 0.6,
      loose: 0.3,
    };

    const refUrl = request.referenceImageUrl ?? providerOptions?.referenceImageUrl;
    const consistencyMode = request.consistencyMode ?? 'balanced';

    // Resolve model ID with auto-routing for consistency and ControlNet
    let modelId = request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell';

    // Auto-select Pulid for strict consistency when no model explicitly set
    if (refUrl && consistencyMode === 'strict' && !request.modelId) {
      modelId = 'zsxkib/pulid';
    }

    // Auto-route by controlType when controlImage is set and no model specified
    if (providerOptions?.controlImage && providerOptions.controlType && !request.modelId) {
      const controlRoutes: Record<string, string> = {
        canny: 'black-forest-labs/flux-canny-dev',
        depth: 'black-forest-labs/flux-depth-dev',
      };
      const routed = controlRoutes[providerOptions.controlType];
      if (routed) modelId = routed;
    }

    // Map reference image to model-specific input field
    if (refUrl) {
      if (modelId.includes('pulid')) {
        input.main_face_image = refUrl;
      } else if (modelId.includes('flux-redux')) {
        input.image = refUrl;
      } else {
        input.image = refUrl;
        input.image_strength = CONSISTENCY_STRENGTHS[consistencyMode];
      }
    }

    // Map control image for ControlNet models
    if (providerOptions?.controlImage) {
      input.control_image = providerOptions.controlImage;
    }

    // Dual-endpoint routing: version-hash models use legacy /predictions,
    // plain owner/name models use modern /models/.../predictions
    const hasVersionHash = modelId.includes(':');
    const waitSeconds = providerOptions?.wait ?? 60;
    let prediction: ReplicatePrediction;

    if (hasVersionHash) {
      // Legacy endpoint: POST /predictions with { version, input }
      const body: Record<string, unknown> = { version: modelId, input };
      if (providerOptions?.webhook) body.webhook = providerOptions.webhook;
      if (providerOptions?.webhookEventsFilter) body.webhook_events_filter = providerOptions.webhookEventsFilter;
      if (providerOptions?.extraBody) Object.assign(body, providerOptions.extraBody);
      prediction = await this.createPrediction(body, waitSeconds);
    } else {
      // Modern endpoint: POST /models/{owner}/{name}/predictions with { input }
      const slashIndex = modelId.indexOf('/');
      const owner = modelId.substring(0, slashIndex);
      const name = modelId.substring(slashIndex + 1);
      prediction = await this.createModelPrediction(owner, name, input, waitSeconds);
    }

    if (
      prediction.status
      && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
      && prediction.urls?.get
    ) {
      prediction = await this.pollPrediction(prediction.urls.get, 60_000, 1_000);
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
      modelId: modelId,
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
  async editImage(request: ImageEditRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('Replicate image provider is not initialized.');
    }

    const providerOptions = getImageProviderOptions<ReplicateImageProviderOptions>(
      this.providerId,
      request.providerOptions,
    );

    // Convert image buffer to a base64 data URL that Replicate models accept.
    const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      image: imageDataUrl,
      ...(providerOptions?.input ?? {}),
    };

    // Choose the model based on whether inpainting is requested.
    const hasInpaintingMask = !!request.mask;
    const defaultModel = hasInpaintingMask
      ? 'black-forest-labs/flux-fill-pro'  // Flux Fill Pro for production inpainting.
      : 'stability-ai/sdxl';              // SDXL supports generic img2img via image input.

    if (hasInpaintingMask) {
      input.mask = `data:image/png;base64,${request.mask!.toString('base64')}`;
    }

    if (request.strength !== undefined) input.strength = request.strength;
    if (request.negativePrompt) input.negative_prompt = request.negativePrompt;
    if (request.seed !== undefined) input.seed = request.seed;
    if (request.n) input.num_outputs = request.n;
    // Mirror the generateImage handling so mature/private-adult edits can
    // bypass the community-model NSFW filter. Without this, policy-aware
    // routing picks an uncensored model but the model's own safety flag
    // still rejects the prompt, returning a placeholder gradient.
    if (providerOptions?.disableSafetyChecker !== undefined) {
      input.disable_safety_checker = providerOptions.disableSafetyChecker;
    }

    const model = request.modelId || defaultModel;
    const body: Record<string, unknown> = {
      version: model,
      input,
    };
    if (providerOptions?.extraBody) Object.assign(body, providerOptions.extraBody);

    const waitSeconds = providerOptions?.wait ?? 60;
    let prediction = await this.createPrediction(body, waitSeconds);

    if (
      prediction.status
      && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
      && prediction.urls?.get
    ) {
      prediction = await this.pollPrediction(prediction.urls.get, 60_000, 1_000);
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
  async upscaleImage(request: ImageUpscaleRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('Replicate image provider is not initialized.');
    }

    const providerOptions = getImageProviderOptions<ReplicateImageProviderOptions>(
      this.providerId,
      request.providerOptions,
    );

    const imageDataUrl = `data:image/png;base64,${request.image.toString('base64')}`;
    const input: Record<string, unknown> = {
      image: imageDataUrl,
      scale: request.scale ?? 2,
      ...(providerOptions?.input ?? {}),
    };

    const model = request.modelId || 'nightmareai/real-esrgan';
    const body: Record<string, unknown> = {
      version: model,
      input,
    };

    const waitSeconds = providerOptions?.wait ?? 60;
    let prediction = await this.createPrediction(body, waitSeconds);

    if (
      prediction.status
      && !['succeeded', 'failed', 'canceled'].includes(prediction.status)
      && prediction.urls?.get
    ) {
      prediction = await this.pollPrediction(prediction.urls.get, 60_000, 1_000);
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

  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      // Generation
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-schnell', displayName: 'Flux Schnell', description: 'Fast generation, 4 steps' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-dev', displayName: 'Flux Dev', description: 'Open-weight development model' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-pro', displayName: 'Flux Pro', description: 'Highest quality commercial' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-1.1-pro', displayName: 'Flux 1.1 Pro', description: 'Latest pro generation' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-1.1-pro-ultra', displayName: 'Flux 1.1 Pro Ultra', description: 'Ultra-high resolution' },
      { providerId: this.providerId, modelId: 'bytedance/sdxl-lightning-4step', displayName: 'SDXL Lightning', description: '4-step fast SDXL' },
      { providerId: this.providerId, modelId: 'stability-ai/sdxl', displayName: 'SDXL', description: 'Classic Stable Diffusion XL' },
      // Style transfer
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-redux-dev', displayName: 'Flux Redux Dev', description: 'Image-guided style transfer' },
      // ControlNet
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-canny-dev', displayName: 'Flux Canny', description: 'Edge-guided generation' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-depth-dev', displayName: 'Flux Depth', description: 'Depth-guided generation' },
      // Character consistency
      { providerId: this.providerId, modelId: 'zsxkib/pulid', displayName: 'Pulid', description: 'Face-consistent generation from reference' },
      // Inpainting
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-fill-pro', displayName: 'Flux Fill Pro', description: 'Production inpainting' },
      // Upscaling
      { providerId: this.providerId, modelId: 'nightmareai/real-esrgan', displayName: 'Real-ESRGAN', description: '2x/4x image upscaling' },
    ];
  }

  /**
   * Creates a prediction using the modern model-based endpoint.
   *
   * Official models on Replicate (e.g. `black-forest-labs/flux-1.1-pro`)
   * use `/models/{owner}/{name}/predictions` which accepts `{ input }`
   * directly without a `version` field.
   *
   * @param owner - Model owner (e.g. `'black-forest-labs'`).
   * @param name - Model name (e.g. `'flux-1.1-pro'`).
   * @param input - Model input parameters.
   * @param waitSeconds - Maximum seconds to wait for synchronous completion.
   * @returns The prediction response, possibly still in progress.
   */
  private async createModelPrediction(
    owner: string,
    name: string,
    input: Record<string, unknown>,
    waitSeconds: number,
  ): Promise<ReplicatePrediction> {
    const response = await fetch(
      `${this.config.baseURL}/models/${owner}/${name}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.keyPool.next()}`,
          'Content-Type': 'application/json',
          Prefer: `wait=${waitSeconds}`,
        },
        body: JSON.stringify({ input }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Replicate model prediction failed (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as ReplicatePrediction;
  }

  private async createPrediction(body: Record<string, unknown>, waitSeconds: number): Promise<ReplicatePrediction> {
    const response = await fetch(`${this.config.baseURL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.keyPool.next()}`,
        'Content-Type': 'application/json',
        Prefer: `wait=${waitSeconds}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate image generation failed (${response.status}): ${errorText}`);
    }

    return (await response.json()) as ReplicatePrediction;
  }

  private async pollPrediction(url: string, timeoutMs: number, pollIntervalMs: number): Promise<ReplicatePrediction> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Token ${this.keyPool.next()}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Replicate prediction polling failed (${response.status}): ${errorText}`);
      }

      const prediction = (await response.json()) as ReplicatePrediction;
      if (!prediction.status || ['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        return prediction;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error('Replicate image generation timed out while waiting for prediction output.');
  }
}
