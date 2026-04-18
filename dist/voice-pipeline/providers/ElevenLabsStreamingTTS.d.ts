/**
 * @module voice-pipeline/providers/ElevenLabsStreamingTTS
 *
 * Streaming text-to-speech adapter that connects to ElevenLabs' WebSocket API
 * and implements the {@link IStreamingTTS} / {@link StreamingTTSSession} interfaces
 * required by {@link VoicePipelineOrchestrator}.
 *
 * ## ElevenLabs WebSocket Protocol
 *
 * - **Endpoint:** `wss://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream-input`
 * - **Authentication:** `xi-api-key` query parameter
 * - **Inbound (client → ElevenLabs):** JSON text chunks `{ text: "...", ... }`
 * - **Outbound (ElevenLabs → client):** JSON with base64-encoded audio `{ audio: "...", ... }`
 * - **Flush:** Send `{ text: "" }` to signal end-of-input and flush remaining audio
 *
 * ## Audio Output
 *
 * ElevenLabs returns audio as base64-encoded MP3 chunks. Each chunk is decoded
 * and wrapped in an {@link EncodedAudioChunk} with format `'mp3'` before being
 * emitted as an `'audio'` event.
 *
 * @see https://elevenlabs.io/docs/api-reference/websockets
 */
import type { IStreamingTTS, StreamingTTSSession, StreamingTTSConfig } from '../types.js';
import { type HealthyProvider, type HealthCheckResult, type ProviderCapabilities } from '../HealthyProvider.js';
/**
 * Configuration for the {@link ElevenLabsStreamingTTS} provider.
 */
export interface ElevenLabsStreamingTTSConfig {
    /** ElevenLabs API key. */
    apiKey: string;
    /**
     * Base URL for the ElevenLabs API (HTTP, not WS — the WS URL is derived).
     * @default 'https://api.elevenlabs.io/v1'
     */
    baseUrl?: string;
    /**
     * Default voice ID for synthesis.
     * @default 'EXAVITQu4vr4xnSDxMaL' (Sarah)
     */
    voiceId?: string;
    /**
     * ElevenLabs model ID.
     * @default 'eleven_multilingual_v2'
     */
    model?: string;
    /** Chain priority. Lower values are tried first. @default 10 */
    priority?: number;
    /** Optional capability overrides. */
    capabilities?: Partial<ProviderCapabilities>;
    /** Injectable health probe for tests. */
    healthProbe?: (apiKey: string) => Promise<{
        ok: boolean;
        status: number;
        latencyMs: number;
    }>;
}
/**
 * Streaming TTS provider that creates ElevenLabs WebSocket sessions.
 * Implements {@link IStreamingTTS} for use with {@link VoicePipelineOrchestrator}.
 *
 * @example
 * ```typescript
 * const tts = new ElevenLabsStreamingTTS({
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 *   voiceId: 'EXAVITQu4vr4xnSDxMaL',
 * });
 * const session = await tts.startSession({ voice: 'pNInz6obpgDQGcFmaJgB' });
 * session.on('audio', (chunk) => transport.sendAudio(chunk));
 * session.pushTokens('Hello there!');
 * await session.flush();
 * ```
 */
export declare class ElevenLabsStreamingTTS implements IStreamingTTS, HealthyProvider {
    private readonly config;
    readonly providerId = "elevenlabs-streaming";
    readonly priority: number;
    readonly capabilities: ProviderCapabilities;
    private readonly keyPool;
    private readonly healthProbe;
    constructor(config: ElevenLabsStreamingTTSConfig);
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Create a new streaming TTS session connected to ElevenLabs.
     * The session opens a WebSocket and is ready to receive text tokens.
     * Each session gets a fresh key from the round-robin pool.
     */
    startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession>;
}
//# sourceMappingURL=ElevenLabsStreamingTTS.d.ts.map