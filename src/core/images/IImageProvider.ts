export type ImageProviderId = 'openai' | 'openrouter' | 'stability' | 'replicate' | (string & {});
export type ImageModality = 'image' | 'text';
export type ImageBackground = 'transparent' | 'opaque' | 'auto';
export type ImageOutputFormat = 'png' | 'jpeg' | 'jpg' | 'webp';
export type ImageResponseFormat = 'b64_json' | 'url';

export interface ImageModelInfo {
  modelId: string;
  providerId: string;
  displayName?: string;
  description?: string;
}

export interface ImageProviderUsage {
  totalImages: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  totalCostUSD?: number;
}

export interface GeneratedImage {
  url?: string;
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
  revisedPrompt?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface OpenAIImageProviderOptions {
  style?: 'vivid' | 'natural';
  moderation?: 'low' | 'auto';
  extraBody?: Record<string, unknown>;
}

export interface OpenRouterImageProviderOptions {
  imageConfig?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  transforms?: Array<Record<string, unknown>>;
  extraBody?: Record<string, unknown>;
}

export interface StabilityImageProviderOptions {
  engine?: 'core' | 'ultra' | 'sd3' | string;
  negativePrompt?: string;
  seed?: number;
  stylePreset?: string;
  cfgScale?: number;
  steps?: number;
  samples?: number;
  strength?: number;
  aspectRatio?: string;
  outputFormat?: ImageOutputFormat;
  extraFields?: Record<string, string | number | boolean>;
}

export interface ReplicateImageProviderOptions {
  wait?: number;
  webhook?: string;
  webhookEventsFilter?: string[];
  seed?: number;
  negativePrompt?: string;
  numOutputs?: number;
  aspectRatio?: string;
  outputFormat?: ImageOutputFormat;
  outputQuality?: number;
  disableSafetyChecker?: boolean;
  goFast?: boolean;
  megapixels?: string;
  input?: Record<string, unknown>;
  extraBody?: Record<string, unknown>;
}

export interface ImageProviderOptionBag {
  openai?: OpenAIImageProviderOptions;
  openrouter?: OpenRouterImageProviderOptions;
  stability?: StabilityImageProviderOptions;
  replicate?: ReplicateImageProviderOptions;
  [providerId: string]: unknown;
}

export interface ImageGenerationRequest {
  modelId: string;
  prompt: string;
  modalities?: ImageModality[];
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  background?: ImageBackground;
  outputFormat?: ImageOutputFormat;
  outputCompression?: number;
  responseFormat?: ImageResponseFormat;
  userId?: string;
  seed?: number;
  negativePrompt?: string;
  providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}

export interface ImageGenerationResult {
  created: number;
  modelId: string;
  providerId: string;
  text?: string;
  images: GeneratedImage[];
  usage?: ImageProviderUsage;
}

export interface IImageProvider {
  readonly providerId: string;
  readonly isInitialized: boolean;
  readonly defaultModelId?: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  listAvailableModels?(): Promise<ImageModelInfo[]>;
  shutdown?(): Promise<void>;
}

const BUILT_IN_IMAGE_PROVIDER_IDS = new Set(['openai', 'openrouter', 'stability', 'replicate']);

export function getImageProviderOptions<T extends object>(
  providerId: string,
  providerOptions?: ImageGenerationRequest['providerOptions'],
): T | undefined {
  if (!providerOptions || typeof providerOptions !== 'object' || Array.isArray(providerOptions)) {
    return undefined;
  }

  const bag = providerOptions as ImageProviderOptionBag;
  const directMatch = bag[providerId];
  if (directMatch && typeof directMatch === 'object' && !Array.isArray(directMatch)) {
    return directMatch as T;
  }

  const hasNamespacedProviderKeys = Object.keys(providerOptions).some(
    (key) => BUILT_IN_IMAGE_PROVIDER_IDS.has(key) || key === providerId,
  );
  if (hasNamespacedProviderKeys) {
    return undefined;
  }

  return providerOptions as T;
}

export function parseDataUrl(
  value: string,
): { mimeType?: string; base64?: string; dataUrl?: string } {
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(value.trim());
  if (!match) {
    return { dataUrl: value };
  }
  return {
    mimeType: match[1] || undefined,
    base64: match[2],
    dataUrl: value,
  };
}

export function normalizeOutputFormat(format?: ImageOutputFormat): 'png' | 'jpeg' | 'webp' | undefined {
  if (!format) {
    return undefined;
  }
  return format === 'jpg' ? 'jpeg' : format;
}

export function parseImageSize(size?: string): { width?: number; height?: number } {
  if (!size) {
    return {};
  }
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) {
    return {};
  }
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

export function inferAspectRatioFromSize(size?: string): string | undefined {
  if (!size) {
    return undefined;
  }

  switch (size.trim()) {
    case '1024x1024':
    case '512x512':
    case '256x256':
      return '1:1';
    case '1792x1024':
      return '16:9';
    case '1024x1792':
      return '9:16';
    default:
      break;
  }

  const { width, height } = parseImageSize(size);
  if (!width || !height) {
    return undefined;
  }

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}
