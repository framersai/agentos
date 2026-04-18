/**
 * @module voice-pipeline/providers/ElevenLabsBatchTTS
 *
 * Batch text-to-speech via ElevenLabs' REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis with voice settings control.
 */
import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';
import { type HealthyProvider, type HealthCheckResult, type ProviderCapabilities } from '../HealthyProvider.js';
/** Configuration for the ElevenLabs batch TTS provider. */
export interface ElevenLabsBatchTTSConfig {
    /** ElevenLabs API key. */
    apiKey: string;
    /** Default voice ID. Falls back to 'EXAVITQu4vr4xnSDxMaL' (Rachel). */
    voiceId?: string;
    /** Model identifier. Defaults to 'eleven_multilingual_v2'. */
    model?: string;
    /** Base URL for the ElevenLabs API. Defaults to 'https://api.elevenlabs.io/v1'. */
    baseUrl?: string;
    /** Chain priority. Lower values are tried first. @default 80 */
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
 * Batch (one-shot) TTS provider using ElevenLabs' REST text-to-speech endpoint.
 *
 * Accepts complete text and returns finished MP3 audio with voice settings
 * control via `providerOptions` (stability, similarityBoost, style, useSpeakerBoost).
 */
export declare class ElevenLabsBatchTTS implements IBatchTTS, HealthyProvider {
    readonly providerId = "elevenlabs-batch";
    readonly priority: number;
    readonly capabilities: ProviderCapabilities;
    /** API key pool for round-robin rotation and quota failover. */
    private readonly keyPool;
    /** Default voice ID when none is provided in the synthesis config. */
    private readonly defaultVoiceId;
    /** Model identifier sent with each request. */
    private readonly model;
    /** Base URL for all API requests. */
    private readonly baseUrl;
    /** Injectable health probe for tests. */
    private readonly healthProbe;
    constructor(config: ElevenLabsBatchTTSConfig);
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Synthesize complete text into MP3 audio via ElevenLabs REST API.
     *
     * @param text - The text to synthesize.
     * @param config - Optional synthesis configuration (voice, model, providerOptions).
     * @returns Resolved {@link BatchTTSResult} containing the MP3 audio buffer.
     * @throws Error if the API returns a non-OK status.
     */
    synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult>;
}
//# sourceMappingURL=ElevenLabsBatchTTS.d.ts.map