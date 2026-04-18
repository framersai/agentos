/**
 * @module voice-pipeline/providers/OpenAIBatchTTS
 *
 * Batch text-to-speech via OpenAI's REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis. Supports tts-1 (cheap) and tts-1-hd (quality).
 */
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../core/providers/quotaErrors.js';
import { defaultCapabilities, } from '../HealthyProvider.js';
import { VoicePipelineError } from '../VoicePipelineError.js';
async function defaultOpenAIProbe(apiKey) {
    const start = Date.now();
    const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(1000),
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
}
/** Approximate bytes per second for MP3 at default OpenAI TTS bitrate. */
const BYTES_PER_SEC_MP3 = 16000;
/**
 * One-shot TTS provider backed by the OpenAI `/audio/speech` endpoint.
 * Accepts complete text and returns a finished audio buffer.
 */
export class OpenAIBatchTTS {
    constructor(config) {
        this.keyPool = new ApiKeyPool(config.apiKey);
        this.model = config.model ?? 'tts-1';
        this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
        this.providerId = `openai-${this.model}`;
        this.priority = config.priority ?? 90;
        this.capabilities = defaultCapabilities({
            languages: ['*'],
            streaming: false,
            costTier: 'cheap',
            latencyClass: 'batch',
            ...(config.capabilities ?? {}),
        });
        this.healthProbe = config.healthProbe ?? defaultOpenAIProbe;
    }
    async healthCheck() {
        if (!this.keyPool.hasKeys) {
            return { ok: false, error: { class: 'auth', message: 'no api key available' } };
        }
        const key = this.keyPool.next();
        try {
            const res = await this.healthProbe(key);
            if (res.ok)
                return { ok: true, latencyMs: res.latencyMs };
            const classified = VoicePipelineError.classifyError(new Error(`HTTP ${res.status}`), { kind: 'tts', provider: this.providerId });
            return {
                ok: false,
                latencyMs: res.latencyMs,
                error: { class: classified.errorClass, message: `HTTP ${res.status}` },
            };
        }
        catch (err) {
            const classified = VoicePipelineError.classifyError(err, {
                kind: 'tts',
                provider: this.providerId,
            });
            return {
                ok: false,
                error: { class: classified.errorClass, message: classified.message },
            };
        }
    }
    async synthesize(text, config) {
        // Validate voice name — if an external voice ID (e.g. ElevenLabs) is passed
        // via the fallback chain, fall back to 'nova' instead of sending it to OpenAI.
        const rawVoice = config?.voice ?? 'nova';
        const voice = OpenAIBatchTTS.VALID_VOICES.has(rawVoice) ? rawVoice : 'nova';
        const format = config?.format ?? 'mp3';
        const body = {
            model: this.model,
            input: text,
            voice,
            response_format: format,
        };
        if (config?.speed != null)
            body.speed = config.speed;
        const doFetch = (key) => fetch(`${this.baseUrl}/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const key = this.keyPool.next();
        let res = await doFetch(key);
        if (!res.ok && this.keyPool.size > 1) {
            const errBody = await res.text().catch(() => '');
            if (isQuotaError(res.status, errBody)) {
                this.keyPool.markExhausted(key);
                res = await doFetch(this.keyPool.next());
            }
            else {
                throw new Error(`OpenAI TTS failed: ${res.status} ${errBody.slice(0, 200)}`);
            }
        }
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`OpenAI TTS failed: ${res.status} ${detail.slice(0, 200)}`);
        }
        const audio = Buffer.from(await res.arrayBuffer());
        const durationMs = Math.round((audio.byteLength / BYTES_PER_SEC_MP3) * 1000);
        return { audio, format, durationMs, provider: this.providerId };
    }
}
/**
 * Synthesize complete text into audio via the OpenAI speech API.
 *
 * @param text - The text to synthesize.
 * @param config - Optional voice, format, and speed overrides.
 * @returns The synthesized audio buffer with metadata.
 */
/** Valid OpenAI TTS voice names. */
OpenAIBatchTTS.VALID_VOICES = new Set([
    'nova', 'shimmer', 'echo', 'onyx', 'fable', 'alloy', 'ash', 'sage', 'coral',
]);
//# sourceMappingURL=OpenAIBatchTTS.js.map