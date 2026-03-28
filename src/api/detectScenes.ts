/**
 * @file detectScenes.ts
 * Provider-agnostic scene detection for the AgentOS high-level API.
 *
 * Creates a {@link SceneDetector} with the supplied configuration and
 * returns an AsyncGenerator that yields {@link SceneBoundary} objects
 * as visual discontinuities are detected in the frame stream.
 *
 * This is the high-level companion to the lower-level
 * {@link SceneDetector.detectScenes} method. It handles construction
 * and configuration so callers only need to supply frames and optional
 * thresholds.
 */
import { SceneDetector } from '../vision/SceneDetector.js';
import type {
  Frame,
  SceneBoundary,
  SceneDetectorConfig,
  SceneDetectionMethod,
} from '../vision/types.js';

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

/**
 * Options for a {@link detectScenes} call.
 *
 * At minimum, a `frames` async iterable must be provided. All other
 * options are optional and map to {@link SceneDetectorConfig} fields.
 */
export interface DetectScenesOptions {
  /**
   * Async iterable of decoded video frames in time order.
   * Each frame must contain a raw RGB pixel buffer, a timestamp,
   * and a sequential index.
   */
  frames: AsyncIterable<Frame>;

  /**
   * Detection methods to use. Multiple methods are combined by
   * taking the maximum diff score across all methods.
   * @default ['histogram', 'ssim']
   */
  methods?: SceneDetectionMethod[];

  /**
   * Diff score threshold above which a frame transition is classified
   * as a hard cut. Applied to histogram chi-squared distance (0-1).
   * @default 0.3
   */
  hardCutThreshold?: number;

  /**
   * Diff score threshold for gradual transitions (dissolves, fades).
   * Transitions with scores between this and `hardCutThreshold`
   * are classified as gradual cuts.
   * @default 0.15
   */
  gradualThreshold?: number;

  /**
   * Minimum scene duration in seconds. Scene boundaries that would
   * create scenes shorter than this are suppressed.
   * @default 1.0
   */
  minSceneDurationSec?: number;

  /**
   * CLIP embedding provider for semantic scene detection.
   * Only used when `methods` includes `'clip'`.
   * @default 'local'
   */
  clipProvider?: 'local' | 'openai';
}

// ---------------------------------------------------------------------------
// Main API function
// ---------------------------------------------------------------------------

/**
 * Detects scene boundaries in a stream of video frames.
 *
 * Creates a {@link SceneDetector} with the supplied configuration and
 * yields {@link SceneBoundary} objects as visual discontinuities are
 * detected. The generator completes when the input frame stream is
 * exhausted.
 *
 * Suitable for both pre-recorded video (extract frames via ffmpeg, then
 * pipe as an async iterable) and live streams (webcam, security camera,
 * screen capture).
 *
 * @param opts - Scene detection options including the frame source.
 * @returns An AsyncGenerator yielding scene boundaries as they are detected.
 *
 * @example
 * ```ts
 * // Pre-recorded video
 * const boundaries: SceneBoundary[] = [];
 * for await (const boundary of detectScenes({ frames: extractFrames('video.mp4') })) {
 *   console.log(`Scene ${boundary.index} at ${boundary.startTimeSec}s (${boundary.cutType})`);
 *   boundaries.push(boundary);
 * }
 *
 * // Live webcam with custom thresholds
 * for await (const boundary of detectScenes({
 *   frames: webcamFrameStream,
 *   hardCutThreshold: 0.4,
 *   minSceneDurationSec: 2.0,
 * })) {
 *   console.log(`Motion detected at ${boundary.startTimeSec}s`);
 * }
 * ```
 */
export async function* detectScenes(
  opts: DetectScenesOptions,
): AsyncGenerator<SceneBoundary> {
  const config: SceneDetectorConfig = {};

  if (opts.methods !== undefined) config.methods = opts.methods;
  if (opts.hardCutThreshold !== undefined) config.hardCutThreshold = opts.hardCutThreshold;
  if (opts.gradualThreshold !== undefined) config.gradualThreshold = opts.gradualThreshold;
  if (opts.minSceneDurationSec !== undefined) config.minSceneDurationSec = opts.minSceneDurationSec;
  if (opts.clipProvider !== undefined) config.clipProvider = opts.clipProvider;

  const detector = new SceneDetector(config);

  yield* detector.detectScenes(opts.frames);
}
