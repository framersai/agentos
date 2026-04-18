/**
 * @module voice-pipeline/providers/OpenAIBatchTTS
 *
 * Batch text-to-speech via OpenAI's REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis. Supports tts-1 (cheap) and tts-1-hd (quality).
 */
import type { IBatchTTS, BatchTTSConfig, BatchTTSResult } from '../types.js';
/** Configuration for the OpenAI batch TTS provider. */
export interface OpenAIBatchTTSConfig {
    /** OpenAI API key. */
    apiKey: string;
    /** Model to use. Defaults to 'tts-1'. */
    model?: 'tts-1' | 'tts-1-hd';
    /** Base URL for the OpenAI API. Defaults to 'https://api.openai.com/v1'. */
    baseUrl?: string;
}
/**
 * One-shot TTS provider backed by the OpenAI `/audio/speech` endpoint.
 * Accepts complete text and returns a finished audio buffer.
 */
export declare class OpenAIBatchTTS implements IBatchTTS {
    readonly providerId: string;
    private readonly keyPool;
    private readonly model;
    private readonly baseUrl;
    constructor(config: OpenAIBatchTTSConfig);
    /**
     * Synthesize complete text into audio via the OpenAI speech API.
     *
     * @param text - The text to synthesize.
     * @param config - Optional voice, format, and speed overrides.
     * @returns The synthesized audio buffer with metadata.
     */
    /** Valid OpenAI TTS voice names. */
    private static readonly VALID_VOICES;
    synthesize(text: string, config?: BatchTTSConfig): Promise<BatchTTSResult>;
}
//# sourceMappingURL=OpenAIBatchTTS.d.ts.map