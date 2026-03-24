/**
 * @file generateImage.ts
 * Provider-agnostic image generation for the AgentOS high-level API.
 *
 * Parses a `provider:model` string, resolves media-provider credentials, and
 * dispatches the request to the appropriate image provider implementation
 * (e.g. OpenAI DALL-E, Stability AI, Replicate).
 */
import { parseModelString, resolveMediaProvider } from './model.js';

// Inline type stubs — will be replaced by imports from '../core/images/' once that module is implemented
/** A single generated image with optional URL and base64 data. */
export interface GeneratedImage { url?: string; b64_json?: string; revised_prompt?: string }
/** Result from an image provider. */
interface ImageGenerationResult { modelId: string; providerId: string; created: number; text?: string; images: GeneratedImage[]; usage?: { promptTokens?: number; totalTokens?: number } }
/** Provider-specific option bag. */
type ImageProviderOptionBag = Record<string, unknown>;
/** Response format: URL or base64. */
type ImageResponseFormat = 'url' | 'b64_json';
/** Background style. */
type ImageBackground = 'transparent' | 'opaque' | 'auto';
/** Image modality. */
type ImageModality = 'image' | 'text';
/** Output file format. */
type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/**
 * Options for a {@link generateImage} call.
 */
export interface GenerateImageOptions {
  /**
   * Model in `provider:model` format.
   * @example `"openai:dall-e-3"`, `"stability:stable-diffusion-xl-1024-v1-0"`
   */
  model: string;
  /** Text description of the desired image. */
  prompt: string;
  /** Output modalities requested from the provider (provider-dependent). */
  modalities?: ImageModality[];
  /** Number of images to generate. Defaults to `1` for most providers. */
  n?: number;
  /** Pixel dimensions string, e.g. `"1024x1024"`. Provider-dependent. */
  size?: string;
  /** Aspect ratio string, e.g. `"16:9"`. Used by some providers instead of `size`. */
  aspectRatio?: string;
  /** Quality hint forwarded to the provider (e.g. `"hd"` for DALL-E 3). */
  quality?: string;
  /** Background style for transparent-capable providers. */
  background?: ImageBackground;
  /** Desired output file format (e.g. `"png"`, `"jpeg"`, `"webp"`). */
  outputFormat?: ImageOutputFormat;
  /** Compression level (0–100) for lossy output formats. */
  outputCompression?: number;
  /** Whether the provider should return a URL or base64-encoded data. */
  responseFormat?: ImageResponseFormat;
  /** Override the provider API key instead of reading from environment variables. */
  apiKey?: string;
  /** Override the provider base URL. */
  baseUrl?: string;
  /** Optional user identifier forwarded to the provider for moderation tracking. */
  userId?: string;
  /** Random seed for reproducible generation (provider-dependent support). */
  seed?: number;
  /** Negative prompt describing content to avoid (provider-dependent support). */
  negativePrompt?: string;
  /** Arbitrary provider-specific options not covered by the standard fields. */
  providerOptions?: ImageProviderOptionBag | Record<string, unknown>;
}

/**
 * The result returned by {@link generateImage}.
 */
export interface GenerateImageResult {
  /** Model identifier reported by the provider. */
  model: string;
  /** Provider identifier (e.g. `"openai"`, `"stability"`). */
  provider: string;
  /** Unix timestamp (seconds) when the image was created. */
  created: number;
  /** Optional text response accompanying the images (provider-dependent). */
  text?: string;
  /** Array of generated image objects containing URLs or base64 data. */
  images: GeneratedImage[];
  /** Token / credit usage reported by the provider, when available. */
  usage?: ImageGenerationResult['usage'];
}

/**
 * Generates one or more images using a provider-agnostic `provider:model` string.
 *
 * Resolves credentials via {@link resolveMediaProvider}, initialises the matching
 * image provider, and returns a normalised {@link GenerateImageResult}.
 *
 * @param opts - Image generation options including model, prompt, and optional parameters.
 * @returns A promise resolving to the generation result with image data and metadata.
 *
 * @example
 * ```ts
 * const result = await generateImage({
 *   model: 'openai:dall-e-3',
 *   prompt: 'A photorealistic red panda sitting on a moonlit rooftop.',
 *   size: '1024x1024',
 * });
 * console.log(result.images[0].url);
 * ```
 */
export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const { providerId, modelId } = parseModelString(opts.model);
  const resolved = resolveMediaProvider(providerId, modelId, {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });

  // TODO: Wire to core/images/ module once implemented.
  // For now, throw a descriptive error so callers know the provider layer isn't ready.
  throw new Error(
    `generateImage() is not yet wired to a provider backend. ` +
    `Resolved: ${resolved.providerId}:${resolved.modelId}. ` +
    `The core/images/ module needs to be implemented first.`
  );
}
