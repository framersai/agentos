/**
 * @module vision/SceneDetector
 *
 * General-purpose visual change detection for video frame sequences.
 *
 * The SceneDetector analyses consecutive frames using configurable methods
 * (histogram chi-squared distance, SSIM, or CLIP embeddings) to identify
 * scene boundaries — the points where the visual content changes
 * significantly enough to indicate a new scene.
 *
 * ## Detection methods
 *
 * | Method | Speed | Quality | Dependencies |
 * |--------|-------|---------|-------------|
 * | `histogram` | Fast | Good for hard cuts | None |
 * | `ssim` | Medium | Better for gradual transitions | `sharp` (optional) |
 * | `clip` | Slow | Best for semantic changes | CLIP provider |
 *
 * ## Usage
 *
 * ```typescript
 * import { SceneDetector } from '@framers/agentos/vision';
 * import type { Frame, SceneBoundary } from '@framers/agentos/vision';
 *
 * const detector = new SceneDetector({ hardCutThreshold: 0.3 });
 *
 * // Single-shot comparison
 * const { changed, score } = detector.hasSceneChanged(frameA, frameB);
 *
 * // Streaming detection over an async frame sequence
 * for await (const boundary of detector.detectScenes(frameStream)) {
 *   console.log(`Scene ${boundary.index} at ${boundary.startTimeSec}s`);
 * }
 * ```
 *
 * @see {@link Frame} for the frame data structure.
 * @see {@link SceneBoundary} for the boundary output type.
 * @see {@link SceneDetectorConfig} for configuration options.
 */
import type { Frame, SceneBoundary, SceneDetectorConfig } from './types.js';
/**
 * Detects scene boundaries in video frame sequences using configurable
 * visual change detection methods.
 *
 * The detector supports three detection methods that can be combined:
 * - **histogram** — 768-bin RGB histogram chi-squared distance (fast, no deps)
 * - **ssim** — Structural Similarity Index via `sharp` (falls back to histogram)
 * - **clip** — CLIP embedding cosine distance (requires CLIP provider)
 *
 * Scene boundaries are classified by cut type (hard-cut, dissolve, fade,
 * gradual) based on the magnitude of the visual change.
 */
export declare class SceneDetector {
    /** Resolved configuration with defaults applied. */
    private readonly config;
    /**
     * Create a new SceneDetector with the given configuration.
     *
     * Missing configuration values are filled with sensible defaults:
     * - `methods`: `['histogram', 'ssim']`
     * - `hardCutThreshold`: `0.3`
     * - `gradualThreshold`: `0.15`
     * - `minSceneDurationSec`: `1.0`
     * - `clipProvider`: `'local'`
     *
     * @param config - Optional partial configuration to override defaults.
     */
    constructor(config?: SceneDetectorConfig);
    /**
     * Detect scene boundaries by streaming through an async iterable of frames.
     *
     * Yields a {@link SceneBoundary} each time the visual difference between
     * consecutive frames exceeds the configured threshold. The first scene
     * boundary is never yielded for the very first frame — it is tracked
     * internally as the start of scene 0.
     *
     * Respects {@link SceneDetectorConfig.minSceneDurationSec}: if a scene
     * change is detected too soon after the previous boundary, it is
     * suppressed (the current scene is extended instead).
     *
     * At the end of the stream, the final scene boundary is yielded to close
     * out the last scene.
     *
     * @param frames - Async iterable of decoded video frames in time order.
     * @yields SceneBoundary for each detected scene transition.
     *
     * @example
     * ```typescript
     * const boundaries: SceneBoundary[] = [];
     * for await (const b of detector.detectScenes(frameStream)) {
     *   boundaries.push(b);
     * }
     * ```
     */
    detectScenes(frames: AsyncIterable<Frame>): AsyncGenerator<SceneBoundary>;
    /**
     * Compare two frames and determine if a scene change occurred.
     *
     * Returns whether the frames differ enough to constitute a scene change,
     * the raw difference score, and optionally the cut type.
     *
     * @param frameA - Raw pixel buffer of the first frame (RGB, 3 bytes/pixel).
     * @param frameB - Raw pixel buffer of the second frame (RGB, 3 bytes/pixel).
     * @returns Object with `changed` boolean, `score` (0-1), and optional `type`.
     *
     * @example
     * ```typescript
     * const result = detector.hasSceneChanged(bufferA, bufferB);
     * if (result.changed) {
     *   console.log(`Scene change detected: ${result.type} (score: ${result.score})`);
     * }
     * ```
     */
    hasSceneChanged(frameA: Buffer, frameB: Buffer): {
        changed: boolean;
        score: number;
        type?: string;
    };
    /**
     * Compute a frame-difference score using the configured detection methods.
     *
     * When multiple methods are configured, the maximum score is used so that
     * any strong signal can trigger a scene boundary.
     */
    private computeDiff;
    /**
     * Compute the histogram difference between two raw RGB buffers.
     *
     * Builds a 768-bin histogram (256 bins per R/G/B channel) for each
     * buffer, then computes the chi-squared distance between the two
     * histograms, normalized to the range [0, 1].
     *
     * A score of 0 means the histograms are identical (same color
     * distribution). A score approaching 1 means they are maximally
     * different.
     *
     * @param a - First frame's raw RGB pixel buffer.
     * @param b - Second frame's raw RGB pixel buffer.
     * @returns Normalized chi-squared distance in [0, 1].
     */
    histogramDiff(a: Buffer, b: Buffer): number;
    /**
     * Compute the Structural Similarity Index (SSIM) difference between
     * two frames.
     *
     * Attempts to use `sharp` for proper SSIM computation. If `sharp` is
     * not available, falls back to {@link histogramDiff}.
     *
     * @param a - First frame's raw RGB pixel buffer.
     * @param b - Second frame's raw RGB pixel buffer.
     * @returns Difference score in [0, 1] where 0 = identical, 1 = maximally different.
     */
    ssimDiff(a: Buffer, b: Buffer): Promise<number>;
    /**
     * Compute a 768-bin RGB histogram from a raw pixel buffer.
     *
     * The buffer is expected to contain RGB pixels (3 bytes per pixel,
     * row-major order). The histogram has 256 bins for each of the three
     * channels (R: bins 0-255, G: bins 256-511, B: bins 512-767).
     *
     * Values are normalized to sum to 1.0 across all bins.
     *
     * @param buf - Raw RGB pixel data.
     * @returns Float32Array of 768 normalized histogram bins.
     */
    private computeHistogram;
    /**
     * Classify a gradual cut based on the difference score.
     *
     * This is a simplified heuristic classification:
     * - Score > 0.25 — `'dissolve'` (cross-dissolve / superimposition)
     * - Score > 0.20 — `'fade'` (fade from/to black or white)
     * - Otherwise     — `'gradual'` (generic gradual transition)
     *
     * @param diff - The difference score from histogram or SSIM comparison.
     * @returns The classified cut type string.
     */
    private classifyGradualCut;
}
//# sourceMappingURL=SceneDetector.d.ts.map