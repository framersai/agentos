/**
 * @module voice-pipeline/providers/ElevenLabsStreamingSTT
 *
 * Streaming speech-to-text adapter for ElevenLabs' WebSocket STT API.
 * Implements {@link IStreamingSTT} / {@link StreamingSTTSession} for the
 * voice pipeline orchestrator.
 *
 * ## ElevenLabs STT WebSocket Protocol
 *
 * - **Endpoint:** `wss://api.elevenlabs.io/v1/speech-to-text/stream`
 * - **Authentication:** `xi-api-key` header on upgrade
 * - **Inbound (client → ElevenLabs):** Binary PCM frames (16-bit signed LE, 16kHz mono)
 * - **Outbound (ElevenLabs → client):** JSON transcript results
 * - **Close:** Send JSON `{ "type": "close_stream" }` to finalize
 *
 * ## Fallback: Chunked REST
 *
 * If the WebSocket endpoint is unavailable or errors, this adapter falls back
 * to a chunked REST approach: accumulates audio into ~2s chunks and POSTs each
 * to `/v1/speech-to-text` for batch transcription. This provides near-realtime
 * results (2s latency per chunk) using only the REST API.
 *
 * @see https://elevenlabs.io/docs/api-reference/speech-to-text
 */
import type { IStreamingSTT, StreamingSTTSession, StreamingSTTConfig } from '../types.js';
/**
 * Configuration for the {@link ElevenLabsStreamingSTT} provider.
 */
export interface ElevenLabsStreamingSTTConfig {
    /** ElevenLabs API key. */
    apiKey: string;
    /**
     * Base URL for the ElevenLabs API.
     * @default 'https://api.elevenlabs.io/v1'
     */
    baseUrl?: string;
    /**
     * STT model to use.
     * @default 'scribe_v1'
     */
    model?: string;
}
/**
 * Streaming STT provider using ElevenLabs' Speech-to-Text API.
 *
 * Uses chunked REST transcription (2-second audio windows) to provide
 * near-realtime STT with the same ElevenLabs API key used for TTS.
 * No separate Deepgram key required.
 *
 * @example
 * ```typescript
 * const stt = new ElevenLabsStreamingSTT({
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 * });
 * const session = await stt.startSession({ language: 'en' });
 * session.on('transcript', (event) => console.log(event.text));
 * ```
 */
export declare class ElevenLabsStreamingSTT implements IStreamingSTT {
    private readonly config;
    readonly providerId = "elevenlabs-streaming-stt";
    readonly isStreaming = true;
    constructor(config: ElevenLabsStreamingSTTConfig);
    /**
     * Create a new STT session. Uses chunked REST calls to ElevenLabs'
     * batch STT endpoint for near-realtime transcription.
     */
    startSession(config?: StreamingSTTConfig): Promise<StreamingSTTSession>;
}
//# sourceMappingURL=ElevenLabsStreamingSTT.d.ts.map