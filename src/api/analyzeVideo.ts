/**
 * @file analyzeVideo.ts
 * Provider-agnostic video analysis for the AgentOS high-level API.
 *
 * Creates a {@link VideoAnalyzer} backed by an auto-detected
 * {@link VisionPipeline} (for frame descriptions) and optional STT
 * provider (for audio transcription), then dispatches the analysis
 * request and returns a structured {@link VideoAnalysis} result.
 *
 * This is the high-level companion to the lower-level
 * {@link IVideoAnalyzer} interface. It handles provider wiring so
 * callers only need to supply a video and optional parameters.
 */
import type {
  DescriptionDetail,
  SceneDescription,
  VideoAnalysisProgressEvent,
} from '../media/video/types.js';
import { VideoAnalyzer } from '../media/video/VideoAnalyzer.js';
import { createVisionPipeline } from '../vision/index.js';
import type { SpeechToTextProvider } from '../speech/types.js';
import { toTurnMetricUsage } from './observability.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';

// ---------------------------------------------------------------------------
// Public options / result types
// ---------------------------------------------------------------------------

/**
 * Options for a {@link analyzeVideo} call.
 *
 * At minimum, a video source (`videoUrl` or `videoBuffer`) is required.
 */
export interface AnalyzeVideoOptions {
  /** URL of the video to analyse. Mutually exclusive with `videoBuffer`. */
  videoUrl?: string;

  /** Raw video bytes. Mutually exclusive with `videoUrl`. */
  videoBuffer?: Buffer;

  /**
   * Text prompt / question to guide the analysis (e.g.
   * "Describe the key actions in this video").
   */
  prompt?: string;

  /** Model identifier to use for the vision LLM analysis step. */
  model?: string;

  /** Maximum number of frames to sample for analysis. */
  maxFrames?: number;

  /**
   * Threshold for scene change detection (0-1).
   * Lower values detect more scene boundaries (more sensitive);
   * higher values only detect dramatic cuts.
   * @default 0.3
   */
  sceneThreshold?: number;

  /**
   * Whether to transcribe the audio track using the configured STT provider.
   * @default true
   */
  transcribeAudio?: boolean;

  /**
   * How detailed scene descriptions should be.
   * @default 'detailed'
   */
  descriptionDetail?: DescriptionDetail;

  /**
   * Maximum number of scenes to detect.
   * Prevents runaway analysis on very long videos.
   * @default 100
   */
  maxScenes?: number;

  /**
   * Whether to index scene descriptions and transcripts into the
   * RAG vector store for later retrieval.
   * @default false
   */
  indexForRAG?: boolean;

  /**
   * Optional callback invoked as analysis progresses through phases.
   */
  onProgress?: (event: VideoAnalysisProgressEvent) => void;

  /** Arbitrary provider-specific options. */
  providerOptions?: Record<string, unknown>;

  /** Optional durable usage ledger configuration for accounting. */
  usageLedger?: AgentOSUsageLedgerOptions;
}

/**
 * The result returned by {@link analyzeVideo}.
 *
 * Extends the core {@link VideoAnalysis} with optional rich scene data
 * when scene detection and description are enabled.
 */
export interface AnalyzeVideoResult {
  /** Free-form textual description / answer from the analyser. */
  description: string;
  /** Detected scene segments with timestamps. */
  scenes?: SceneDescription[];
  /** Detected objects / entities across the video. */
  objects?: string[];
  /** Detected on-screen or spoken text (OCR / ASR). */
  text?: string[];
  /** Overall duration of the analysed video in seconds. */
  durationSec?: number;
  /** Model that produced the analysis. */
  model?: string;
  /** Provider that produced the analysis. */
  provider?: string;
  /** Full transcript when audio transcription was enabled. */
  fullTranscript?: string;
  /** IDs of RAG chunks created, when indexForRAG was enabled. */
  ragChunkIds?: string[];
  /** Provider-specific metadata. */
  providerMetadata?: Record<string, unknown>;
}

async function createAutoSpeechToTextProvider(): Promise<SpeechToTextProvider | undefined> {
  if (process.env.OPENAI_API_KEY) {
    const { OpenAIWhisperSpeechToTextProvider } = await import(
      '../speech/providers/OpenAIWhisperSpeechToTextProvider.js'
    );
    return new OpenAIWhisperSpeechToTextProvider({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  if (process.env.DEEPGRAM_API_KEY) {
    const { DeepgramBatchSTTProvider } = await import(
      '../speech/providers/DeepgramBatchSTTProvider.js'
    );
    return new DeepgramBatchSTTProvider({
      apiKey: process.env.DEEPGRAM_API_KEY,
    });
  }

  if (process.env.ASSEMBLYAI_API_KEY) {
    const { AssemblyAISTTProvider } = await import(
      '../speech/providers/AssemblyAISTTProvider.js'
    );
    return new AssemblyAISTTProvider({
      apiKey: process.env.ASSEMBLYAI_API_KEY,
    });
  }

  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
    const { AzureSpeechSTTProvider } = await import(
      '../speech/providers/AzureSpeechSTTProvider.js'
    );
    return new AzureSpeechSTTProvider({
      key: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION,
    });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main API function
// ---------------------------------------------------------------------------

/**
 * Analyses a video and returns structured understanding results.
 *
 * Creates a {@link VideoAnalyzer} (backed by auto-detected
 * VisionPipeline + STT when available), dispatches the analysis
 * request, and returns a normalised {@link AnalyzeVideoResult}.
 *
 * @param opts - Video analysis options.
 * @returns A promise resolving to the analysis result with description,
 *   scenes, objects, text, and optional RAG indexing metadata.
 *
 * @example
 * ```ts
 * const analysis = await analyzeVideo({
 *   videoUrl: 'https://example.com/demo.mp4',
 *   prompt: 'What products are shown in this video?',
 *   transcribeAudio: true,
 *   descriptionDetail: 'detailed',
 * });
 * console.log(analysis.description);
 * for (const scene of analysis.scenes ?? []) {
 *   console.log(`[${scene.startSec}s] ${scene.description}`);
 * }
 * ```
 */
export async function analyzeVideo(opts: AnalyzeVideoOptions): Promise<AnalyzeVideoResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';

  if (!opts.videoUrl && !opts.videoBuffer) {
    throw new Error('Either videoUrl or videoBuffer is required for video analysis.');
  }

  try {
    return await withAgentOSSpan('agentos.api.analyze_video', async (span) => {
      if (opts.model) span?.setAttribute('llm.model', opts.model);

      const [visionPipeline, sttProvider] = await Promise.all([
        createVisionPipeline(
          opts.model
            ? { cloudModel: opts.model }
            : undefined,
        ),
        opts.transcribeAudio === false
          ? Promise.resolve(undefined)
          : createAutoSpeechToTextProvider(),
      ]);

      if (sttProvider) {
        span?.setAttribute('agentos.api.stt_provider', sttProvider.id);
      }

      const analyzer = new VideoAnalyzer({
        visionPipeline,
        ...(sttProvider ? { sttProvider } : {}),
      });

      const result = await analyzer.analyze({
        video: opts.videoBuffer ?? opts.videoUrl!,
        prompt: opts.prompt,
        sceneThreshold: opts.sceneThreshold,
        transcribeAudio: opts.transcribeAudio,
        descriptionDetail: opts.descriptionDetail,
        maxFrames: opts.maxFrames,
        maxScenes: opts.maxScenes,
        indexForRAG: opts.indexForRAG,
        onProgress: opts.onProgress,
      });

      span?.setAttribute('agentos.api.scene_count', result.scenes.length);

      return {
        description: result.summary,
        scenes: result.scenes,
        durationSec: result.durationSec,
        model: opts.model,
        provider: 'agentos-video-analyzer',
        text: result.fullTranscript ? [result.fullTranscript] : undefined,
        fullTranscript: result.fullTranscript,
        ragChunkIds: result.ragChunkIds,
        providerMetadata: {
          ...result.metadata,
          sttProviderId: sttProvider?.id,
        },
      };
    });
  } catch (error) {
    metricStatus = 'error';
    throw error;
  } finally {
    try {
      await recordAgentOSUsage({
        options: {
          ...opts.usageLedger,
          source: opts.usageLedger?.source ?? 'analyzeVideo',
        },
      });
    } catch {
      // Usage persistence is best-effort.
    }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
    });
  }
}
