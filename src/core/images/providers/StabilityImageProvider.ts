import {
  type GeneratedImage,
  getImageProviderOptions,
  inferAspectRatioFromSize,
  normalizeOutputFormat,
  parseDataUrl,
  type IImageProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageModelInfo,
  type StabilityImageProviderOptions,
} from '../IImageProvider.js';

export interface StabilityImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModelId?: string;
}

type StabilityJsonResponse = {
  image?: string;
  seed?: number;
  finish_reason?: string;
  warnings?: unknown[];
  artifacts?: Array<{
    base64?: string;
    finishReason?: string;
    seed?: number;
  }>;
};

type StabilityRoute = {
  path: string;
  responseModelId: string;
  requestModel?: string;
};

const STABILITY_ROUTE_ALIASES: Record<string, StabilityRoute> = {
  core: {
    path: '/v2beta/stable-image/generate/core',
    responseModelId: 'stable-image-core',
  },
  'stable-image-core': {
    path: '/v2beta/stable-image/generate/core',
    responseModelId: 'stable-image-core',
  },
  ultra: {
    path: '/v2beta/stable-image/generate/ultra',
    responseModelId: 'stable-image-ultra',
  },
  'stable-image-ultra': {
    path: '/v2beta/stable-image/generate/ultra',
    responseModelId: 'stable-image-ultra',
  },
  sd3: {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3-medium',
    requestModel: 'sd3-medium',
  },
  'sd3-medium': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3-medium',
    requestModel: 'sd3-medium',
  },
  'sd3-large': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3-large',
    requestModel: 'sd3-large',
  },
  'sd3-large-turbo': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3-large-turbo',
    requestModel: 'sd3-large-turbo',
  },
  'sd3.5-medium': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3.5-medium',
    requestModel: 'sd3.5-medium',
  },
  'sd3.5-large': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3.5-large',
    requestModel: 'sd3.5-large',
  },
  'sd3.5-large-turbo': {
    path: '/v2beta/stable-image/generate/sd3',
    responseModelId: 'sd3.5-large-turbo',
    requestModel: 'sd3.5-large-turbo',
  },
};

function resolveStabilityRoute(
  modelId: string,
  providerOptions?: StabilityImageProviderOptions,
): StabilityRoute {
  const normalizedModelId = providerOptions?.engine?.trim() || modelId.trim();
  return STABILITY_ROUTE_ALIASES[normalizedModelId] ?? {
    path: '/v2beta/stable-image/generate/core',
    responseModelId: normalizedModelId,
  };
}

function appendIfDefined(formData: FormData, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) {
    return;
  }
  formData.append(key, String(value));
}

export class StabilityImageProvider implements IImageProvider {
  public readonly providerId = 'stability';
  public isInitialized = false;
  public defaultModelId?: string;

  private config!: Required<Pick<StabilityImageProviderConfig, 'apiKey'>> & StabilityImageProviderConfig;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw new Error('Stability image provider requires apiKey.');
    }

    this.config = {
      apiKey,
      baseURL:
        typeof config.baseURL === 'string' && config.baseURL.trim()
          ? config.baseURL.trim()
          : 'https://api.stability.ai',
      defaultModelId:
        typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
          ? config.defaultModelId.trim()
          : 'stable-image-core',
    };
    this.defaultModelId = this.config.defaultModelId;
    this.isInitialized = true;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('Stability image provider is not initialized.');
    }

    const providerOptions = getImageProviderOptions<StabilityImageProviderOptions>(
      this.providerId,
      request.providerOptions,
    );
    const route = resolveStabilityRoute(request.modelId || this.defaultModelId || 'stable-image-core', providerOptions);

    const formData = new FormData();
    formData.append('prompt', request.prompt);
    appendIfDefined(formData, 'negative_prompt', providerOptions?.negativePrompt ?? request.negativePrompt);
    appendIfDefined(
      formData,
      'aspect_ratio',
      providerOptions?.aspectRatio ?? request.aspectRatio ?? inferAspectRatioFromSize(request.size),
    );
    appendIfDefined(formData, 'seed', providerOptions?.seed ?? request.seed);
    appendIfDefined(
      formData,
      'output_format',
      normalizeOutputFormat(providerOptions?.outputFormat ?? request.outputFormat),
    );
    appendIfDefined(formData, 'style_preset', providerOptions?.stylePreset);
    appendIfDefined(formData, 'cfg_scale', providerOptions?.cfgScale);
    appendIfDefined(formData, 'steps', providerOptions?.steps);
    appendIfDefined(formData, 'strength', providerOptions?.strength);
    if (!route.path.endsWith('/ultra')) {
      appendIfDefined(formData, 'samples', providerOptions?.samples ?? request.n);
    }
    if (route.requestModel) {
      appendIfDefined(formData, 'model', route.requestModel);
    }
    if (providerOptions?.extraFields) {
      for (const [key, value] of Object.entries(providerOptions.extraFields)) {
        appendIfDefined(formData, key, value);
      }
    }

    const response = await fetch(`${this.config.baseURL}${route.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: 'application/json',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stability image generation failed (${response.status}): ${errorText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const images: GeneratedImage[] = [];
    let usageImages = 0;

    if (contentType.includes('application/json')) {
      const json = (await response.json()) as StabilityJsonResponse;
      if (json.image) {
        const mimeType = `image/${normalizeOutputFormat(providerOptions?.outputFormat ?? request.outputFormat) ?? 'png'}`;
        images.push({
          mimeType,
          base64: json.image,
          dataUrl: `data:${mimeType};base64,${json.image}`,
          providerMetadata: {
            seed: json.seed,
            finishReason: json.finish_reason,
            warnings: json.warnings,
          },
        });
      }

      for (const artifact of json.artifacts ?? []) {
        if (!artifact.base64) {
          continue;
        }
        const mimeType = `image/${normalizeOutputFormat(providerOptions?.outputFormat ?? request.outputFormat) ?? 'png'}`;
        images.push({
          mimeType,
          base64: artifact.base64,
          dataUrl: `data:${mimeType};base64,${artifact.base64}`,
          providerMetadata: {
            seed: artifact.seed,
            finishReason: artifact.finishReason,
          },
        });
      }
      usageImages = images.length;
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      const mimeType = contentType || 'image/png';
      const base64 = buffer.toString('base64');
      const parsed = parseDataUrl(`data:${mimeType};base64,${base64}`);
      images.push(parsed);
      usageImages = 1;
    }

    if (images.length === 0) {
      throw new Error('Stability returned no image data.');
    }

    return {
      created: Math.floor(Date.now() / 1000),
      modelId: route.responseModelId,
      providerId: this.providerId,
      images,
      usage: {
        totalImages: usageImages,
      },
    };
  }

  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      { providerId: this.providerId, modelId: 'stable-image-core', displayName: 'Stable Image Core' },
      { providerId: this.providerId, modelId: 'stable-image-ultra', displayName: 'Stable Image Ultra' },
      { providerId: this.providerId, modelId: 'sd3-medium', displayName: 'Stable Diffusion 3 Medium' },
      { providerId: this.providerId, modelId: 'sd3-large', displayName: 'Stable Diffusion 3 Large' },
      { providerId: this.providerId, modelId: 'sd3-large-turbo', displayName: 'Stable Diffusion 3 Large Turbo' },
    ];
  }
}
