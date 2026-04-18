/**
 * @module voice-pipeline/providers/ElevenLabsBatchTTS
 *
 * Batch text-to-speech via ElevenLabs' REST API. Implements {@link IBatchTTS}
 * for one-shot narration synthesis with voice settings control.
 */
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
import { isQuotaError } from '../../core/providers/quotaErrors.js';
import { defaultCapabilities, } from '../HealthyProvider.js';
import { VoicePipelineError } from '../VoicePipelineError.js';
async function defaultElevenLabsBatchProbe(apiKey) {
    const start = Date.now();
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(1000),
    });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
}
/** Approximate bytes per second for 128kbps MP3 audio. */
const BYTES_PER_SEC_MP3 = 16000;
/**
 * Batch (one-shot) TTS provider using ElevenLabs' REST text-to-speech endpoint.
 *
 * Accepts complete text and returns finished MP3 audio with voice settings
 * control via `providerOptions` (stability, similarityBoost, style, useSpeakerBoost).
 */
export class ElevenLabsBatchTTS {
    constructor(config) {
        this.providerId = 'elevenlabs-batch';
        this.keyPool = new ApiKeyPool(config.apiKey);
        this.defaultVoiceId = config.voiceId ?? 'EXAVITQu4vr4xnSDxMaL';
        this.model = config.model ?? 'eleven_multilingual_v2';
        this.baseUrl = config.baseUrl ?? 'https://api.elevenlabs.io/v1';
        this.priority = config.priority ?? 80;
        this.capabilities = defaultCapabilities({
            languages: ['*'],
            streaming: false,
            costTier: 'standard',
            latencyClass: 'batch',
            ...(config.capabilities ?? {}),
        });
        this.healthProbe = config.healthProbe ?? defaultElevenLabsBatchProbe;
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
    /**
     * Synthesize complete text into MP3 audio via ElevenLabs REST API.
     *
     * @param text - The text to synthesize.
     * @param config - Optional synthesis configuration (voice, model, providerOptions).
     * @returns Resolved {@link BatchTTSResult} containing the MP3 audio buffer.
     * @throws Error if the API returns a non-OK status.
     */
    async synthesize(text, config) {
        const voiceId = config?.voice ?? this.defaultVoiceId;
        const opts = config?.providerOptions ?? {};
        const doFetch = (key) => fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': key,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg',
            },
            body: JSON.stringify({
                text,
                model_id: config?.model ?? this.model,
                voice_settings: {
                    stability: opts.stability ?? 0.5,
                    similarity_boost: opts.similarityBoost ?? 0.75,
                    style: opts.style ?? 0.0,
                    use_speaker_boost: opts.useSpeakerBoost ?? true,
                },
            }),
        });
        const key = this.keyPool.next();
        let res = await doFetch(key);
        if (!res.ok && this.keyPool.size > 1) {
            const body = await res.text().catch(() => '');
            if (isQuotaError(res.status, body)) {
                this.keyPool.markExhausted(key);
                res = await doFetch(this.keyPool.next());
            }
            else {
                throw new Error(`ElevenLabs TTS failed: ${res.status} ${body.slice(0, 200)}`);
            }
        }
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`ElevenLabs TTS failed: ${res.status} ${detail.slice(0, 200)}`);
        }
        const audio = Buffer.from(await res.arrayBuffer());
        const durationMs = Math.round((audio.byteLength / BYTES_PER_SEC_MP3) * 1000);
        return { audio, format: 'mp3', durationMs, provider: this.providerId };
    }
}
//# sourceMappingURL=ElevenLabsBatchTTS.js.map