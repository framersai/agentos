/**
 * @module voice-pipeline/providers/OpenAIRealtimeTTS
 *
 * Streaming TTS via OpenAI's Realtime API (gpt-4o-mini-tts).
 * Implements {@link IStreamingTTS} with the same interface as ElevenLabsStreamingTTS.
 *
 * Protocol: WebSocket to wss://api.openai.com/v1/realtime with session-based events.
 * Text is sent via conversation.item.create + response.create events.
 * Audio arrives as response.audio.delta base64-encoded chunks.
 */
import type { IStreamingTTS, StreamingTTSSession, StreamingTTSConfig } from '../types.js';
export interface OpenAIRealtimeTTSConfig {
    apiKey: string;
    model?: string;
    baseUrl?: string;
}
export declare class OpenAIRealtimeTTS implements IStreamingTTS {
    readonly providerId = "openai-realtime";
    private readonly config;
    private readonly keyPool;
    constructor(config: OpenAIRealtimeTTSConfig);
    startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession>;
}
//# sourceMappingURL=OpenAIRealtimeTTS.d.ts.map