import { VideoAnalyzer } from '../media/video/VideoAnalyzer.js';
import { createVisionPipeline } from '../vision/index.js';
import { recordAgentOSUsage } from './runtime/usageLedger.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
async function createAutoSpeechToTextProvider() {
    if (process.env.OPENAI_API_KEY) {
        const { OpenAIWhisperSpeechToTextProvider } = await import('../hearing/providers/OpenAIWhisperSpeechToTextProvider.js');
        return new OpenAIWhisperSpeechToTextProvider({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    if (process.env.DEEPGRAM_API_KEY) {
        const { DeepgramBatchSTTProvider } = await import('../hearing/providers/DeepgramBatchSTTProvider.js');
        return new DeepgramBatchSTTProvider({
            apiKey: process.env.DEEPGRAM_API_KEY,
        });
    }
    if (process.env.ASSEMBLYAI_API_KEY) {
        const { AssemblyAISTTProvider } = await import('../hearing/providers/AssemblyAISTTProvider.js');
        return new AssemblyAISTTProvider({
            apiKey: process.env.ASSEMBLYAI_API_KEY,
        });
    }
    if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
        const { AzureSpeechSTTProvider } = await import('../hearing/providers/AzureSpeechSTTProvider.js');
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
export async function analyzeVideo(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    if (!opts.videoUrl && !opts.videoBuffer) {
        throw new Error('Either videoUrl or videoBuffer is required for video analysis.');
    }
    try {
        return await withAgentOSSpan('agentos.api.analyze_video', async (span) => {
            if (opts.model)
                span?.setAttribute('llm.model', opts.model);
            const [visionPipeline, sttProvider] = await Promise.all([
                createVisionPipeline(opts.model
                    ? { cloudModel: opts.model }
                    : undefined),
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
                video: opts.videoBuffer ?? opts.videoUrl,
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
    }
    catch (error) {
        metricStatus = 'error';
        throw error;
    }
    finally {
        try {
            await recordAgentOSUsage({
                options: {
                    ...opts.usageLedger,
                    source: opts.usageLedger?.source ?? 'analyzeVideo',
                },
            });
        }
        catch {
            // Usage persistence is best-effort.
        }
        recordAgentOSTurnMetrics({
            durationMs: Date.now() - startedAt,
            status: metricStatus,
        });
    }
}
//# sourceMappingURL=analyzeVideo.js.map