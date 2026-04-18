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
import { type HealthyProvider, type HealthCheckResult, type ProviderCapabilities } from '../HealthyProvider.js';
export interface OpenAIRealtimeTTSConfig {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    /** Chain priority. Lower values are tried first. @default 20 */
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
export declare class OpenAIRealtimeTTS implements IStreamingTTS, HealthyProvider {
    readonly providerId = "openai-realtime";
    readonly priority: number;
    readonly capabilities: ProviderCapabilities;
    private readonly config;
    private readonly keyPool;
    private readonly healthProbe;
    constructor(config: OpenAIRealtimeTTSConfig);
    healthCheck(): Promise<HealthCheckResult>;
    startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession>;
}
//# sourceMappingURL=OpenAIRealtimeTTS.d.ts.map