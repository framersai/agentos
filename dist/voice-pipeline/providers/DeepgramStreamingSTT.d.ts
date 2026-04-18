/**
 * @module voice-pipeline/providers/DeepgramStreamingSTT
 *
 * Streaming speech-to-text adapter that connects to Deepgram's WebSocket API
 * and implements the {@link IStreamingSTT} / {@link StreamingSTTSession} interfaces
 * required by {@link VoicePipelineOrchestrator}.
 *
 * ## Deepgram WebSocket Protocol
 *
 * - **Endpoint:** `wss://api.deepgram.com/v1/listen`
 * - **Authentication:** `token=<apiKey>` query parameter
 * - **Inbound (client → Deepgram):** Binary PCM frames or encoded audio
 * - **Outbound (Deepgram → client):** JSON messages with transcript results
 * - **Close:** Send zero-byte message to signal end-of-stream
 *
 * ## Event Mapping
 *
 * Deepgram's `Results` messages are mapped to the pipeline's event model:
 * - `is_final: true` → emits `'transcript'` with `isFinal: true`
 * - `is_final: false` → emits `'transcript'` with `isFinal: false` (interim)
 * - `speech_final: true` → emits `'speech_end'` VAD event
 * - Utterance start → emits `'speech_start'`
 *
 * @see https://developers.deepgram.com/docs/streaming
 */
import type { IStreamingSTT, StreamingSTTSession, StreamingSTTConfig } from '../types.js';
import { type HealthyProvider, type HealthCheckResult, type ProviderCapabilities } from '../HealthyProvider.js';
/**
 * Shape of the injected health probe used for deterministic tests.
 * Default implementation hits Deepgram's /v1/projects endpoint.
 */
export type VoiceHealthProbe = (apiKey: string) => Promise<{
    ok: boolean;
    status: number;
    latencyMs: number;
}>;
/**
 * Configuration for the {@link DeepgramStreamingSTT} provider.
 */
export interface DeepgramStreamingSTTConfig {
    /** Deepgram API key. Sent as a query parameter on the WebSocket URL. */
    apiKey: string;
    /**
     * Base WebSocket URL for Deepgram's streaming API.
     * @default 'wss://api.deepgram.com/v1/listen'
     */
    baseUrl?: string;
    /**
     * Deepgram model to use.
     * @default 'nova-2'
     */
    model?: string;
    /**
     * Chain priority. Lower values are tried first.
     * @default 10
     */
    priority?: number;
    /** Optional capability overrides. Merged into defaultCapabilities(). */
    capabilities?: Partial<ProviderCapabilities>;
    /** Injectable health probe for tests. Defaults to Deepgram /v1/projects. */
    healthProbe?: VoiceHealthProbe;
}
/**
 * Streaming STT provider that creates Deepgram WebSocket sessions.
 * Implements {@link IStreamingSTT} for use with {@link VoicePipelineOrchestrator}.
 *
 * @example
 * ```typescript
 * const stt = new DeepgramStreamingSTT({
 *   apiKey: process.env.DEEPGRAM_API_KEY!,
 *   model: 'nova-2',
 * });
 * const session = await stt.startSession({ language: 'en-US' });
 * session.on('transcript', (event) => console.log(event.text));
 * ```
 */
export declare class DeepgramStreamingSTT implements IStreamingSTT, HealthyProvider {
    private readonly config;
    readonly providerId = "deepgram-streaming";
    readonly isStreaming = true;
    readonly priority: number;
    readonly capabilities: ProviderCapabilities;
    private readonly keyPool;
    private readonly healthProbe;
    constructor(config: DeepgramStreamingSTTConfig);
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Create a new streaming STT session connected to Deepgram.
     * Each session gets a fresh key from the round-robin pool.
     */
    startSession(config?: StreamingSTTConfig): Promise<StreamingSTTSession>;
}
//# sourceMappingURL=DeepgramStreamingSTT.d.ts.map