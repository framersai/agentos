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
import { EventEmitter } from 'node:events';
import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
// ---------------------------------------------------------------------------
// Session Implementation — Chunked REST fallback
// ---------------------------------------------------------------------------
/**
 * ElevenLabs streaming STT session using chunked REST calls.
 *
 * Accumulates PCM audio into ~2-second chunks and sends each to the
 * ElevenLabs batch STT endpoint. Provides near-realtime transcription
 * with the same API key used for TTS.
 */
class ElevenLabsChunkedSTTSession extends EventEmitter {
    constructor(config, sessionConfig) {
        super();
        this.config = config;
        this.sessionConfig = sessionConfig;
        this.closed = false;
        this.speechActive = false;
        this.audioBuffer = [];
        this.bufferSamples = 0;
        this.flushTimer = null;
        // Flush accumulated audio every 2 seconds
        this.flushTimer = setInterval(() => {
            if (this.bufferSamples > 0) {
                this._transcribeBuffer();
            }
        }, 2000);
    }
    /**
     * Push a PCM audio frame. Converts Float32 to Int16 and accumulates.
     */
    pushAudio(frame) {
        if (this.closed)
            return;
        // Convert Float32 [-1, 1] to Int16 PCM
        const pcm = new Int16Array(frame.samples.length);
        for (let i = 0; i < frame.samples.length; i++) {
            const s = Math.max(-1, Math.min(1, frame.samples[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.audioBuffer.push(pcm);
        this.bufferSamples += pcm.length;
        // Detect speech activity from energy
        let energy = 0;
        for (let i = 0; i < pcm.length; i++) {
            energy += Math.abs(pcm[i]);
        }
        energy /= pcm.length;
        if (energy > 500 && !this.speechActive) {
            this.speechActive = true;
            this.emit('speech_start');
        }
    }
    /**
     * Flush any remaining audio and transcribe.
     */
    async flush() {
        if (this.bufferSamples > 0) {
            await this._transcribeBuffer();
        }
    }
    /**
     * Close the session and stop the flush timer.
     */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.emit('close');
    }
    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------
    /**
     * Concatenate accumulated PCM chunks into a WAV buffer and POST to
     * ElevenLabs batch STT endpoint.
     */
    async _transcribeBuffer() {
        // Concatenate all accumulated Int16 chunks
        const totalSamples = this.bufferSamples;
        const combined = new Int16Array(totalSamples);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        // Clear the buffer
        this.audioBuffer = [];
        this.bufferSamples = 0;
        // Build a minimal WAV file
        const wavBuffer = this._buildWav(combined, 16000);
        try {
            const baseUrl = this.config.baseUrl ?? 'https://api.elevenlabs.io/v1';
            // Create form data with the WAV audio
            const boundary = '----ElevenLabsSTTBoundary' + Date.now();
            const languageCode = this.sessionConfig.language ?? 'en';
            // Build multipart body manually (Node.js Buffer-based)
            const parts = [];
            parts.push(Buffer.from(`--${boundary}\r\n`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
            parts.push(Buffer.from(wavBuffer));
            parts.push(Buffer.from(`\r\n--${boundary}\r\n`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="language_code"\r\n\r\n${languageCode}\r\n`));
            if (this.config.model) {
                parts.push(Buffer.from(`--${boundary}\r\n`));
                parts.push(Buffer.from(`Content-Disposition: form-data; name="model_id"\r\n\r\n${this.config.model}\r\n`));
            }
            parts.push(Buffer.from(`--${boundary}--\r\n`));
            const body = Buffer.concat(parts);
            const response = await fetch(`${baseUrl}/speech-to-text`, {
                method: 'POST',
                headers: {
                    'xi-api-key': this.config.apiKey,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                },
                body,
            });
            if (!response.ok) {
                const errText = await response.text();
                this.emit('error', new Error(`ElevenLabs STT failed (${response.status}): ${errText}`));
                return;
            }
            const data = (await response.json());
            if (data.text) {
                const words = (data.words ?? []).map((w) => ({
                    word: w.text,
                    start: Math.round(w.start * 1000),
                    end: Math.round(w.end * 1000),
                    confidence: w.confidence ?? 0.9,
                }));
                const event = {
                    text: data.text,
                    confidence: words.length > 0 ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0.9,
                    words,
                    isFinal: true,
                    durationMs: Math.round((totalSamples / 16000) * 1000),
                };
                this.emit('transcript', event);
                // Emit speech_end after a final transcript
                if (this.speechActive) {
                    this.speechActive = false;
                    this.emit('speech_end');
                }
            }
        }
        catch (err) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
    }
    /**
     * Build a minimal WAV file header + PCM data.
     */
    _buildWav(pcm, sampleRate) {
        const dataSize = pcm.length * 2; // 16-bit = 2 bytes per sample
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);
        // RIFF header
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this._writeString(view, 8, 'WAVE');
        // fmt chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); // byte rate
        view.setUint16(32, 2, true); // block align
        view.setUint16(34, 16, true); // bits per sample
        // data chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);
        // PCM data
        const output = new Int16Array(buffer, 44);
        output.set(pcm);
        return buffer;
    }
    /** Write an ASCII string into a DataView at the given offset. */
    _writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }
}
/** Samples per chunk: 2 seconds at 16kHz = 32,000 samples. */
ElevenLabsChunkedSTTSession.CHUNK_SAMPLES = 32000;
// ---------------------------------------------------------------------------
// Provider (Factory)
// ---------------------------------------------------------------------------
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
export class ElevenLabsStreamingSTT {
    constructor(config) {
        this.config = config;
        this.providerId = 'elevenlabs-streaming-stt';
        this.isStreaming = true;
        this.keyPool = new ApiKeyPool(config.apiKey);
    }
    /**
     * Create a new STT session. Uses chunked REST calls to ElevenLabs'
     * batch STT endpoint for near-realtime transcription.
     * Each session gets a fresh key from the round-robin pool.
     */
    async startSession(config) {
        const resolvedConfig = { ...this.config, apiKey: this.keyPool.next() };
        return new ElevenLabsChunkedSTTSession(resolvedConfig, config ?? {});
    }
}
//# sourceMappingURL=ElevenLabsStreamingSTT.js.map