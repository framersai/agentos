/**
 * @module io/segmentation/types
 *
 * Type definitions for provider-agnostic image segmentation.
 *
 * The segmentation surface takes an image plus exactly one prompt (text,
 * points, box, or automatic "segment everything") and returns one
 * {@link SegmentMask} per detected region. Masks are encoded white=object /
 * black=background so they drop straight into the image-editing `mask` input.
 *
 * @see {@link ISegmentationProvider} for the provider contract.
 */

/** Identifier for a segmentation backend. */
export type SegmentationProviderId = 'replicate' | (string & {});

/** Which kind of prompt drives the segmentation. Exactly one per call. */
export type SegmentationMode = 'text' | 'points' | 'box' | 'automatic';

/** A click point for point-prompted segmentation. */
export interface SegmentationPoint {
  x: number;
  y: number;
  /** Defaults to `'foreground'` during normalization. */
  label?: 'foreground' | 'background';
}

/** An axis-aligned box in image pixels (top-left origin). */
export interface SegmentationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-provider passthrough options for the Replicate backend. */
export interface ReplicateSegmentationOptions {
  /** Override the SAM2 model slug used for geometric prompts. */
  samModelId?: string;
  /** Override the GroundedSAM model slug used for text prompts. */
  groundedSamModelId?: string;
  /** Poll interval in milliseconds (default 1000). */
  pollIntervalMs?: number;
  /** Overall timeout in milliseconds (default 120000). */
  timeoutMs?: number;
  /** Extra fields merged verbatim into the Replicate `input`. */
  input?: Record<string, unknown>;
}

/** Namespaced bag of per-provider options. */
export interface SegmentationProviderOptionBag {
  replicate?: ReplicateSegmentationOptions;
  [providerId: string]: unknown;
}

/** Public options accepted by the high-level {@link segment} helper. */
export interface SegmentOptions {
  /** Source image as raw bytes or a file path. */
  image: Buffer | Uint8Array | string;
  /** Provider id. Defaults to `'replicate'`. */
  provider?: SegmentationProviderId;
  /** Model id override. Provider default is used when omitted. */
  model?: string;

  // --- Exactly one prompt mode per call ---
  /** Open-vocabulary text prompt (routes to GroundedSAM). */
  prompt?: string;
  /** Point prompts (foreground/background clicks). */
  points?: SegmentationPoint[];
  /** Bounding-box prompt. */
  box?: SegmentationBox;
  /** "Segment everything" when `true`. */
  automatic?: boolean;

  /** Cap on returned masks (automatic/text can produce many). */
  maxMasks?: number;
  /** Confidence floor; masks scoring below this are dropped. */
  minScore?: number;
  /** Provider-specific passthrough options. */
  providerOptions?: SegmentationProviderOptionBag | Record<string, unknown>;
  /** Caller id for usage tracking. */
  userId?: string;
}

/** A single segmented region. */
export interface SegmentMask {
  /** PNG bytes; white(255)=object, black(0)=background (matches editImage mask). */
  mask: Buffer;
  /** Tight bounding box in source-image pixels, top-left origin. */
  bbox: SegmentationBox;
  /** Model confidence 0–1 (1 when the model reports none). */
  score: number;
  /** Grounding phrase for text prompts; undefined for geometric/automatic. */
  label?: string;
  /** Stable index within the result. */
  index: number;
}

/** Aggregated segmentation result. */
export interface SegmentationResult {
  masks: SegmentMask[];
  /** Source image width in pixels (so bboxes/masks are interpretable). */
  width: number;
  /** Source image height in pixels. */
  height: number;
  providerId: string;
  modelId: string;
  promptMode: SegmentationMode;
  usage?: { totalMasks: number; totalCostUSD?: number };
  durationMs: number;
}

/**
 * Normalized provider-level request produced by the {@link segment} helper
 * from {@link SegmentOptions}. The image is already a `Buffer`, exactly one
 * `mode` is resolved, and point labels are defaulted.
 */
export interface SegmentationRequest {
  modelId: string;
  image: Buffer;
  mode: SegmentationMode;
  prompt?: string;
  points?: Array<{ x: number; y: number; label: 'foreground' | 'background' }>;
  box?: SegmentationBox;
  maxMasks?: number;
  minScore?: number;
  providerOptions?: SegmentationProviderOptionBag | Record<string, unknown>;
}

/** Contract implemented by every segmentation backend. */
export interface ISegmentationProvider {
  readonly providerId: string;
  readonly isInitialized: boolean;
  readonly defaultModelId?: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  segment(request: SegmentationRequest): Promise<SegmentationResult>;
  /** Prompt modes this provider supports, for up-front validation. */
  supportedModes(): ReadonlyArray<SegmentationMode>;
  shutdown?(): Promise<void>;
}
