import {
  type GeneratedImage,
  getImageProviderOptions,
  type IImageProvider,
  normalizeOutputFormat,
  parseDataUrl,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageModelInfo,
  type OpenAIImageProviderOptions,
} from '../IImageProvider.js';

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModelId?: string;
  organizationId?: string;
}

type OpenAIImageResponse = {
  created: number;
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

export class OpenAIImageProvider implements IImageProvider {
  public readonly providerId = 'openai';
  public isInitialized = false;
  public defaultModelId?: string;

  private config!: Required<Pick<OpenAIImageProviderConfig, 'apiKey'>> & OpenAIImageProviderConfig;

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (!apiKey) {
      throw new Error('OpenAI image provider requires apiKey.');
    }

    this.config = {
      apiKey,
      baseURL:
        typeof config.baseURL === 'string' && config.baseURL.trim()
          ? config.baseURL.trim()
          : 'https://api.openai.com/v1',
      defaultModelId:
        typeof config.defaultModelId === 'string' && config.defaultModelId.trim()
          ? config.defaultModelId.trim()
          : undefined,
      organizationId:
        typeof config.organizationId === 'string' && config.organizationId.trim()
          ? config.organizationId.trim()
          : undefined,
    };
    this.defaultModelId = this.config.defaultModelId;
    this.isInitialized = true;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isInitialized) {
      throw new Error('OpenAI image provider is not initialized.');
    }

    const providerOptions = getImageProviderOptions<OpenAIImageProviderOptions>(
      this.providerId,
      request.providerOptions,
    );
    const body: Record<string, unknown> = {
      model: request.modelId || this.defaultModelId || 'gpt-image-1.5',
      prompt: request.prompt,
    };

    if (typeof request.n === 'number') body.n = request.n;
    if (request.size) body.size = request.size;
    if (request.quality) body.quality = request.quality;
    if (request.background) body.background = request.background;
    if (request.outputFormat) body.output_format = normalizeOutputFormat(request.outputFormat);
    if (typeof request.outputCompression === 'number') body.output_compression = request.outputCompression;
    if (request.responseFormat) body.response_format = request.responseFormat;
    if (request.userId) body.user = request.userId;
    if (providerOptions) {
      const { style, moderation, extraBody, ...passthrough } = providerOptions;
      if (style) body.style = style;
      if (moderation) body.moderation = moderation;
      if (Object.keys(passthrough).length > 0) Object.assign(body, passthrough);
      if (extraBody) Object.assign(body, extraBody);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.config.organizationId) headers['OpenAI-Organization'] = this.config.organizationId;

    const response = await fetch(`${this.config.baseURL}/images/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI image generation failed (${response.status}): ${errorText}`);
    }

    const json = (await response.json()) as OpenAIImageResponse;
    const images: GeneratedImage[] = (json.data ?? []).map((item) => {
      if (item.b64_json) {
        const dataUrl = `data:image/${normalizeOutputFormat(request.outputFormat) ?? 'png'};base64,${item.b64_json}`;
        const parsed = parseDataUrl(dataUrl);
        return {
          ...parsed,
          revisedPrompt: item.revised_prompt,
        };
      }
      return {
        url: item.url,
        revisedPrompt: item.revised_prompt,
      };
    });

    return {
      created: json.created ?? Math.floor(Date.now() / 1000),
      modelId: String(body.model),
      providerId: this.providerId,
      images,
      usage: { totalImages: images.length },
    };
  }

  async listAvailableModels(): Promise<ImageModelInfo[]> {
    return [
      { providerId: this.providerId, modelId: 'gpt-image-1.5', displayName: 'GPT Image 1.5' },
      { providerId: this.providerId, modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
      { providerId: this.providerId, modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini' },
      { providerId: this.providerId, modelId: 'dall-e-3', displayName: 'DALL·E 3' },
    ];
  }
}
