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
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
// ---------------------------------------------------------------------------
// Session Implementation
// ---------------------------------------------------------------------------
/**
 * A live streaming STT session connected to Deepgram via WebSocket.
 * Emits `transcript`, `speech_start`, `speech_end`, `error`, and `close` events
 * as required by the voice pipeline orchestrator.
 */
class DeepgramStreamingSTTSession extends EventEmitter {
    constructor(config, sessionConfig) {
        super();
        this.config = config;
        this.sessionConfig = sessionConfig;
        this.ws = null;
        this.speechActive = false;
        this.closed = false;
    }
    /**
     * Open the WebSocket connection to Deepgram.
     * Resolves once the connection is established and ready to receive audio.
     */
    async connect() {
        const baseUrl = this.config.baseUrl ?? 'wss://api.deepgram.com/v1/listen';
        const model = this.config.model ?? 'nova-2';
        const language = this.sessionConfig.language ?? 'en-US';
        const interim = this.sessionConfig.interimResults !== false;
        const punctuate = this.sessionConfig.punctuate !== false;
        // Provider options from pipeline config (sentiment, keywords, smart_format, etc.)
        const opts = this.sessionConfig.providerOptions ?? {};
        const params = new URLSearchParams({
            model,
            language,
            punctuate: String(punctuate),
            interim_results: String(interim),
            endpointing: 'true',
            vad_events: 'true',
            encoding: 'linear16',
            sample_rate: '16000',
            channels: '1',
        });
        // Deepgram feature flags from providerOptions
        if (opts.sentiment)
            params.set('sentiment', 'true');
        if (opts.smart_format)
            params.set('smart_format', 'true');
        if (opts.diarize)
            params.set('diarize', 'true');
        if (opts.utterance_end_ms)
            params.set('utterance_end_ms', String(opts.utterance_end_ms));
        if (Array.isArray(opts.keywords)) {
            for (const kw of opts.keywords) {
                params.append('keywords', String(kw));
            }
        }
        const url = `${baseUrl}?${params.toString()}`;
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url, {
                headers: {
                    Authorization: `Token ${this.config.apiKey}`,
                },
            });
            this.ws.on('open', () => resolve());
            this.ws.on('error', (err) => {
                this.emit('error', err);
                reject(err);
            });
            this.ws.on('message', (data) => {
                this._handleMessage(typeof data === 'string' ? data : data.toString('utf-8'));
            });
            this.ws.on('close', () => {
                this.closed = true;
                this.emit('close');
            });
        });
    }
    /**
     * Push a PCM audio frame to Deepgram for transcription.
     * Converts Float32Array samples to 16-bit linear PCM (what Deepgram expects).
     */
    pushAudio(frame) {
        if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        // Convert Float32Array [-1.0, 1.0] to Int16 PCM
        const pcm = new Int16Array(frame.samples.length);
        for (let i = 0; i < frame.samples.length; i++) {
            const s = Math.max(-1, Math.min(1, frame.samples[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    }
    /**
     * Signal end-of-audio to Deepgram by sending a zero-byte message.
     * Waits for any final results before resolving.
     */
    async flush() {
        if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN)
            return;
        // Deepgram uses a close_stream message to finalize
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        // Give Deepgram a moment to send final results
        return new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
    }
    /**
     * Close the WebSocket connection and clean up.
     */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close(1000, 'session closed');
            }
            this.ws = null;
        }
        this.emit('close');
    }
    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------
    /**
     * Parse and dispatch a Deepgram WebSocket message.
     * Maps Deepgram's result format to the pipeline's TranscriptEvent model.
     */
    _handleMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
            return; // Malformed JSON — skip
        }
        const type = msg.type;
        // Handle speech started event (Deepgram VAD)
        if (type === 'SpeechStarted') {
            if (!this.speechActive) {
                this.speechActive = true;
                this.emit('speech_start');
            }
            return;
        }
        // Handle results
        if (type === 'Results') {
            const result = msg;
            const alt = result.channel?.alternatives?.[0];
            if (!alt || !alt.transcript)
                return;
            // Map Deepgram words to pipeline TranscriptWord format
            const words = (alt.words ?? []).map((w) => ({
                word: w.word,
                start: Math.round(w.start * 1000), // seconds → ms
                end: Math.round(w.end * 1000),
                confidence: w.confidence,
                speaker: w.speaker !== undefined ? String(w.speaker) : undefined,
            }));
            const event = {
                text: alt.transcript,
                confidence: alt.confidence,
                words,
                isFinal: result.is_final,
                durationMs: Math.round(result.duration * 1000),
            };
            // Attach sentiment when Deepgram returns it
            if (result.sentiments?.average) {
                event.sentiment = {
                    label: result.sentiments.average.sentiment,
                    confidence: Math.abs(result.sentiments.average.sentiment_score),
                };
            }
            this.emit('transcript', event);
            // speech_final indicates the speaker paused — emit speech_end
            if (result.speech_final && this.speechActive) {
                this.speechActive = false;
                this.emit('speech_end');
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Provider (Factory)
// ---------------------------------------------------------------------------
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
export class DeepgramStreamingSTT {
    constructor(config) {
        this.config = config;
        this.providerId = 'deepgram-streaming';
        this.isStreaming = true;
    }
    /**
     * Create a new streaming STT session connected to Deepgram.
     * The session opens a WebSocket and is ready to receive audio frames.
     */
    async startSession(config) {
        const session = new DeepgramStreamingSTTSession(this.config, config ?? {});
        await session.connect();
        return session;
    }
}
//# sourceMappingURL=DeepgramStreamingSTT.js.map