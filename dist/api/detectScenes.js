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
export async function* detectScenes(opts) {
    const config = {};
    if (opts.methods !== undefined)
        config.methods = opts.methods;
    if (opts.hardCutThreshold !== undefined)
        config.hardCutThreshold = opts.hardCutThreshold;
    if (opts.gradualThreshold !== undefined)
        config.gradualThreshold = opts.gradualThreshold;
    if (opts.minSceneDurationSec !== undefined)
        config.minSceneDurationSec = opts.minSceneDurationSec;
    if (opts.clipProvider !== undefined)
        config.clipProvider = opts.clipProvider;
    const detector = new SceneDetector(config);
    yield* detector.detectScenes(opts.frames);
}
//# sourceMappingURL=detectScenes.js.map