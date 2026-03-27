/**
 * @file types.ts
 * Core type definitions for the video generation and analysis subsystem.
 *
 * These types are consumed by {@link IVideoGenerator}, {@link IVideoAnalyzer},
 * and {@link FallbackVideoProxy} to provide a unified video pipeline across
 * multiple provider backends (Runway, Pika, Kling, Luma, etc.).
 */

// ---------------------------------------------------------------------------
// Common enums / branded types
// ---------------------------------------------------------------------------

/** Well-known video provider identifiers. Extensible via `(string & {})`. */
export type VideoProviderId =
  | 'runway'
  | 'pika'
  | 'kling'
  | 'luma'
  | 'stable-video'
  | 'replicate'
  | 'google-veo'
  | (string & {});

/** Output container format for generated videos. */
export type VideoOutputFormat = 'mp4' | 'webm' | 'gif';

/** Aspect ratio presets commonly supported by video generation APIs. */
export type VideoAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '21:9'
  | (string & {});

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

/** Describes a video model exposed by a provider. */
export interface VideoModelInfo {
  /** Unique model identifier (e.g. `'gen-3-alpha'`). */
  modelId: string;
  /** Provider that hosts this model. */
  providerId: string;
  /** Human-readable display name. */
  displayName?: string;
  /** Short description of the model's capabilities. */
  description?: string;
  /** Maximum output duration in seconds. */
  maxDurationSec?: number;
  /** Supported generation capabilities. */
  capabilities?: Array<'text-to-video' | 'image-to-video'>;
}

/** Aggregated usage / billing counters for a video generation session. */
export interface VideoProviderUsage {
  /** Number of videos generated in this session. */
  totalVideos: number;
  /** Total cost in USD, if the provider reports it. */
  totalCostUSD?: number;
  /** Total processing time in milliseconds. */
  processingTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Generation requests
// ---------------------------------------------------------------------------

/**
 * Request payload for text-to-video generation.
 *
 * Passed to {@link IVideoGenerator.generateVideo} by the high-level
 * orchestration layer after normalising user input.
 */
export interface VideoGenerateRequest {
  /** Model identifier to use for generation (e.g. `'gen-3-alpha'`). */
  modelId: string;
  /** Text prompt describing the desired video content. */
  prompt: string;
  /** Negative prompt describing content to avoid. */
  negativePrompt?: string;
  /** Desired output duration in seconds. */
  durationSec?: number;
  /** Desired aspect ratio (e.g. `'16:9'`). */
  aspectRatio?: VideoAspectRatio;
  /** Desired output resolution (e.g. `'1280x720'`). */
  resolution?: string;
  /** Output container format. Defaults to `'mp4'`. */
  outputFormat?: VideoOutputFormat;
  /** Frames per second for the output video. */
  fps?: number;
  /** Seed for reproducible output. */
  seed?: number;
  /** Number of videos to generate. Defaults to `1`. */
  n?: number;
  /** Identifier of the requesting user (for billing / rate limiting). */
  userId?: string;
  /** Arbitrary provider-specific options. */
  providerOptions?: Record<string, unknown>;
}

/**
 * Request payload for image-to-video generation.
 *
 * Passed to {@link IVideoGenerator.imageToVideo} by the high-level
 * orchestration layer. Requires a source image that serves as the first
 * frame (or style reference) for the generated video.
 */
export interface ImageToVideoRequest {
  /** Model identifier to use for generation. */
  modelId: string;
  /** Source image as a raw `Buffer`. */
  image: Buffer;
  /** Text prompt describing the desired motion / narrative. */
  prompt: string;
  /** Negative prompt describing content to avoid. */
  negativePrompt?: string;
  /** Desired output duration in seconds. */
  durationSec?: number;
  /** Desired aspect ratio. */
  aspectRatio?: VideoAspectRatio;
  /** Output container format. Defaults to `'mp4'`. */
  outputFormat?: VideoOutputFormat;
  /** Frames per second for the output video. */
  fps?: number;
  /** Seed for reproducible output. */
  seed?: number;
  /** Identifier of the requesting user. */
  userId?: string;
  /** Arbitrary provider-specific options. */
  providerOptions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Generation results
// ---------------------------------------------------------------------------

/** A single generated video artifact. */
export interface GeneratedVideo {
  /** Public URL where the video can be downloaded. */
  url?: string;
  /** Base64-encoded video data. */
  base64?: string;
  /** MIME type of the video (e.g. `'video/mp4'`). */
  mimeType?: string;
  /** Duration of the generated video in seconds. */
  durationSec?: number;
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
  /** Thumbnail / poster image URL. */
  thumbnailUrl?: string;
  /** Provider-specific metadata (job ID, generation params, etc.). */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Result envelope returned by {@link IVideoGenerator.generateVideo} and
 * {@link IVideoGenerator.imageToVideo}.
 */
export interface VideoResult {
  /** Unix timestamp (ms) when the result was created. */
  created: number;
  /** Model identifier that produced the result. */
  modelId: string;
  /** Provider identifier that produced the result. */
  providerId: string;
  /** The generated video(s). */
  videos: GeneratedVideo[];
  /** Usage / billing information, if available. */
  usage?: VideoProviderUsage;
}

// ---------------------------------------------------------------------------
// Analysis requests & results
// ---------------------------------------------------------------------------

/**
 * Request payload for video analysis / understanding.
 *
 * Passed to {@link IVideoAnalyzer.analyzeVideo}.
 */
export interface VideoAnalyzeRequest {
  /** URL of the video to analyse. Mutually exclusive with `videoBuffer`. */
  videoUrl?: string;
  /** Raw video bytes. Mutually exclusive with `videoUrl`. */
  videoBuffer?: Buffer;
  /** Text prompt / question to guide the analysis. */
  prompt?: string;
  /** Model identifier to use for analysis. */
  modelId?: string;
  /** Maximum number of frames to sample for analysis. */
  maxFrames?: number;
  /** Arbitrary provider-specific options. */
  providerOptions?: Record<string, unknown>;
}

/** Structured result from video analysis. */
export interface VideoAnalysis {
  /** Free-form textual description / answer from the analyser. */
  description: string;
  /** Detected scene segments with timestamps. */
  scenes?: VideoScene[];
  /** Detected objects / entities across the video. */
  objects?: string[];
  /** Detected on-screen or spoken text (OCR / ASR). */
  text?: string[];
  /** Overall duration of the analysed video in seconds. */
  durationSec?: number;
  /** Model that produced the analysis. */
  modelId?: string;
  /** Provider that produced the analysis. */
  providerId?: string;
  /** Provider-specific metadata. */
  providerMetadata?: Record<string, unknown>;
}

/** A single scene / segment detected during video analysis. */
export interface VideoScene {
  /** Start time of the scene in seconds. */
  startSec: number;
  /** End time of the scene in seconds. */
  endSec: number;
  /** Human-readable description of what happens in this scene. */
  description: string;
}
