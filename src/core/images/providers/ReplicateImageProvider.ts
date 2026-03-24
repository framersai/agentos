import {
  type GeneratedImage,
  getImageProviderOptions,
  inferAspectRatioFromSize,
  parseDataUrl,
  type IImageProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageModelInfo,
  normalizeOutputFormat,
  type ReplicateImageProviderOptions,
} from '../IImageProvider.js';

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

    const body: Record<string, unknown> = {
      version: request.modelId || this.defaultModelId || 'black-forest-labs/flux-schnell',
      input,
    };
    if (providerOptions?.webhook) body.webhook = providerOptions.webhook;
    if (providerOptions?.webhookEventsFilter) body.webhook_events_filter = providerOptions.webhookEventsFilter;
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

  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-schnell', displayName: 'Flux Schnell' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-dev', displayName: 'Flux Dev' },
      { providerId: this.providerId, modelId: 'black-forest-labs/flux-pro', displayName: 'Flux Pro' },
    ];
  }

  private async createPrediction(body: Record<string, unknown>, waitSeconds: number): Promise<ReplicatePrediction> {
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

    return (await response.json()) as ReplicatePrediction;
  }

  private async pollPrediction(url: string, timeoutMs: number, pollIntervalMs: number): Promise<ReplicatePrediction> {
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

      const prediction = (await response.json()) as ReplicatePrediction;
      if (!prediction.status || ['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
        return prediction;
      }

      await sleep(pollIntervalMs);
    }

    throw new Error('Replicate image generation timed out while waiting for prediction output.');
  }
}
