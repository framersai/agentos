/**
 * @module media/video/VideoAnalyzer
 *
 * Wires {@link SceneDetector}, {@link VisionPipeline}, and an optional
 * {@link SpeechToTextProvider} into a structured video analysis pipeline.
 *
 * The analyzer replaces the monolithic `ingestVideo()` approach in
 * {@link MultimodalMemoryBridge} with a composable, progress-reporting
 * pipeline that produces rich scene descriptions, summaries, and optional
 * RAG-indexed chunks.
 *
 * ## Pipeline stages
 *
 * ```
 *   Video Buffer
 *     ↓
 *   1. Write to temp file
 *   2. ffprobe → duration
 *   3. ffmpeg  → 1fps PNG frames
 *   4. SceneDetector.detectScenes(frames)
 *   5. Per-scene: VisionPipeline.process(keyFrame)
 *   6. (optional) ffmpeg → WAV audio → STT → transcript segments
 *   7. generateText() LLM → overall summary
 *   8. (optional) RAG chunk indexing
 *   9. Clean up temp files
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { VideoAnalyzer } from '../../media/video';
 *
 * const analyzer = new VideoAnalyzer();
 * const result = await analyzer.analyzeVideo({
 *   video: videoBuffer,
 *   transcribeAudio: true,
 *   onProgress: (evt) => console.log(`${evt.phase}: ${evt.progress}%`),
 * });
 *
 * for (const scene of result.scenes) {
 *   console.log(`[${scene.startSec}-${scene.endSec}s] ${scene.description}`);
 * }
 * ```
 *
 * @see {@link IVideoAnalyzer} for the base interface.
 * @see {@link SceneDetector} for scene boundary detection.
 * @see {@link VisionPipeline} for frame description.
 * @see {@link SpeechToTextProvider} for audio transcription.
 */
import type { IVideoAnalyzer } from './IVideoAnalyzer.js';
import type { VideoAnalyzeRequest, VideoAnalysis, VideoAnalyzeRequestRich, VideoAnalysisRich } from './types.js';
import { SceneDetector } from '../../vision/SceneDetector.js';
import type { VisionPipeline } from '../../vision/VisionPipeline.js';
import type { SpeechToTextProvider } from '../../speech/types.js';
/**
 * Dependencies injected into the {@link VideoAnalyzer} constructor.
 *
 * All fields are optional — the analyzer will auto-create default
 * instances for {@link VisionPipeline} and {@link SceneDetector} when
 * they are not provided.
 */
export interface VideoAnalyzerDeps {
    /**
     * Vision pipeline for describing key frames.
     * When omitted, a default pipeline is auto-created via
     * {@link createVisionPipeline} on first use.
     */
    visionPipeline?: VisionPipeline;
    /**
     * Speech-to-text provider for audio transcription.
     * When omitted, the `transcribeAudio` option in analysis requests
     * is silently skipped (scenes will not have transcripts).
     */
    sttProvider?: SpeechToTextProvider;
    /**
     * Scene boundary detector for segmenting the video.
     * When omitted, a default {@link SceneDetector} with standard
     * thresholds is auto-created.
     */
    sceneDetector?: SceneDetector;
}
/**
 * Structured video analysis pipeline that wires together scene detection,
 * vision description, audio transcription, and LLM summarization.
 *
 * Implements the base {@link IVideoAnalyzer} interface for simple analysis
 * requests, and exposes an `analyze()` method for rich analysis with
 * progress reporting, configurable detail levels, and optional RAG indexing.
 *
 * All ffmpeg/ffprobe invocations use `execFile` (not `exec`) for safety —
 * arguments are passed as arrays, preventing shell injection.
 */
export declare class VideoAnalyzer implements IVideoAnalyzer {
    /** Injected or auto-created vision pipeline. */
    private _visionPipeline?;
    /** Injected STT provider (may be undefined). */
    private readonly _sttProvider?;
    /** Injected or auto-created scene detector. */
    private readonly _sceneDetector;
    /** Whether the vision pipeline was user-supplied (vs auto-created). */
    private readonly _userSuppliedVision;
    /**
     * Create a new VideoAnalyzer with optional injected dependencies.
     *
     * Missing dependencies are auto-created with sensible defaults:
     * - **VisionPipeline**: created lazily via `createVisionPipeline()` on first use
     * - **SceneDetector**: created immediately with default thresholds
     * - **SpeechToTextProvider**: left undefined — transcription skipped when missing
     *
     * @param deps - Optional dependency overrides.
     */
    constructor(deps?: VideoAnalyzerDeps);
    /**
     * Analyse a video and return structured understanding results.
     *
     * This is the simple {@link IVideoAnalyzer} interface method. For richer
     * analysis with progress reporting and scene descriptions, use
     * {@link analyze} instead.
     *
     * @param request - The analysis parameters (video source + optional prompt).
     * @returns Structured analysis including description, scenes, and duration.
     */
    analyzeVideo(request: VideoAnalyzeRequest): Promise<VideoAnalysis>;
    /**
     * Run the full video analysis pipeline with scene detection, vision
     * descriptions, optional audio transcription, and LLM summarization.
     *
     * The pipeline executes these stages sequentially:
     *
     * 1. **Extract frames** — decode video at 1fps via ffmpeg
     * 2. **Detect scenes** — run SceneDetector over extracted frames
     * 3. **Describe scenes** — send key frames to VisionPipeline
     * 4. **Transcribe audio** — (optional) extract audio and run STT
     * 5. **Summarize** — generate overall summary via LLM
     *
     * Progress events are emitted at each phase transition when
     * `onProgress` is provided.
     *
     * @param request - Rich analysis parameters.
     * @returns Rich analysis result with scenes, summary, and optional RAG chunks.
     *
     * @throws {Error} If ffprobe/ffmpeg are not installed on the system.
     * @throws {Error} If the video buffer is empty or invalid.
     */
    analyze(request: VideoAnalyzeRequestRich): Promise<VideoAnalysisRich>;
    /**
     * Assert that ffprobe is available on the system PATH.
     *
     * Attempts to run `ffprobe -version` and throws a descriptive error
     * if the command fails or is not found.
     *
     * @throws {Error} With installation instructions when ffprobe is missing.
     */
    private _assertFfprobeAvailable;
    /**
     * Probe the duration of a video file using ffprobe.
     *
     * Runs `ffprobe -v error -show_entries format=duration -of csv=p=0`
     * and parses the output as a floating-point number of seconds.
     *
     * @param videoPath - Absolute path to the video file.
     * @returns Duration in seconds.
     * @throws {Error} If ffprobe cannot determine the duration.
     */
    private _probeDuration;
    /**
     * Extract frames from a video at 1fps using ffmpeg.
     *
     * Writes PNG frames to the given output directory as `frame_0001.png`,
     * `frame_0002.png`, etc. Then reads them back into {@link Frame} objects
     * with timestamps derived from the frame index (1fps → index = seconds).
     *
     * @param videoPath - Absolute path to the input video.
     * @param framesDir - Directory to write extracted frames into.
     * @returns Array of Frame objects sorted by timestamp.
     */
    private _extractFrames;
    /**
     * Run the SceneDetector over a sequence of frames and collect
     * all scene boundaries.
     *
     * Converts the Frame array into an async iterable for the detector's
     * streaming API, then collects all yielded boundaries.
     *
     * @param frames - Extracted video frames in time order.
     * @param threshold - Optional scene change threshold override.
     * @param maxScenes - Maximum number of scenes to detect.
     * @returns Array of SceneBoundary objects.
     */
    private _detectScenes;
    /**
     * Select the frame closest to a given timestamp from the frame array.
     *
     * Uses a simple linear search — frame counts are typically low
     * (one per second of video) so this is efficient enough.
     *
     * @param frames - Array of extracted frames.
     * @param targetSec - Target timestamp in seconds.
     * @returns The frame closest to the target timestamp, or undefined if empty.
     */
    private _selectKeyFrame;
    /**
     * Extract the audio track from a video file as 16-bit PCM WAV.
     *
     * Uses ffmpeg with:
     * - `-vn`: skip video stream
     * - `-acodec pcm_s16le`: 16-bit PCM output
     * - `-ar 16000`: 16kHz sample rate (standard for STT)
     * - `-ac 1`: mono channel
     *
     * @param videoPath - Absolute path to the input video.
     * @param audioPath - Absolute path for the output WAV file.
     * @returns Audio buffer, or undefined if extraction fails.
     */
    private _extractAudio;
    /**
     * Generate an overall video summary from scene descriptions and optional
     * transcript using an LLM via generateText().
     *
     * The summary captures the narrative arc, key visual elements, and any
     * spoken content across all scenes.
     *
     * @param scenes - Array of rich scene descriptions.
     * @param transcript - Optional full transcript of the video.
     * @returns Generated summary text.
     */
    private _generateSummary;
    /**
     * Build placeholder RAG chunk IDs for each scene plus the summary.
     *
     * In a full implementation these IDs would correspond to actual vector
     * store documents. For now, they serve as stable identifiers that a
     * downstream RAG indexer can use to create or reference chunks.
     *
     * @param scenes - Scene descriptions to create chunk IDs for.
     * @param summary - Overall summary to create a chunk ID for.
     * @returns Array of generated chunk ID strings.
     */
    private _buildRagChunkIds;
    /**
     * Download a video from a URL into a Buffer.
     *
     * @param url - Video URL to download.
     * @returns Video content as a Buffer.
     */
    private _downloadVideo;
    /**
     * Ensure the vision pipeline is available, creating one lazily if needed.
     *
     * When no vision pipeline was injected via the constructor, this method
     * dynamically imports the factory and creates a default pipeline.
     *
     * @returns The resolved VisionPipeline instance.
     */
    private _ensureVisionPipeline;
    /**
     * Decode an extracted frame image into a raw RGB buffer for scene detection.
     *
     * When decoding is unavailable, the original encoded bytes are returned so
     * callers still get a best-effort diff signal instead of a hard failure.
     */
    private _decodeFrameToRgb;
    /**
     * Evenly downsample a frame list while preserving order and both endpoints.
     */
    private _downsampleFrames;
    /**
     * Emit a progress event to the caller's callback, if provided.
     *
     * @param callback - Optional progress callback from the request.
     * @param phase - Current pipeline phase.
     * @param progress - Progress percentage (0-100) within the phase.
     * @param message - Human-readable status message.
     * @param currentScene - 0-based scene index (for describing/transcribing phases).
     */
    private _emitProgress;
}
//# sourceMappingURL=VideoAnalyzer.d.ts.map