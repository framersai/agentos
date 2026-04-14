import { ApiKeyPool } from '../../core/providers/ApiKeyPool.js';
/**
 * Maps Deepgram word-level data to {@link SpeechTranscriptionSegment} objects.
 *
 * Each word is promoted to its own segment so that per-word timing and speaker
 * information is preserved in the normalized result. This 1:1 word-to-segment
 * mapping enables downstream consumers to reconstruct speaker-attributed
 * timelines at the finest granularity Deepgram provides.
 *
 * Deepgram returns times in seconds (unlike AssemblyAI which uses milliseconds),
 * so no unit conversion is needed here.
 *
 * @param words - Array of Deepgram word objects from the API response.
 * @returns An array of normalized transcription segments, one per word.
 *
 * @see {@link DeepgramWord} for the input shape
 * @see {@link SpeechTranscriptionSegment} for the output shape
 */
function wordsToSegments(words) {
    return words.map((w) => ({
        text: w.word,
        startTime: w.start,
        endTime: w.end,
        confidence: w.confidence,
        speaker: w.speaker,
        words: [
            {
                word: w.word,
                start: w.start,
                end: w.end,
                confidence: w.confidence,
            },
        ],
    }));
}
/**
 * Speech-to-text provider that uses the Deepgram batch (pre-recorded) REST API.
 *
 * ## REST API Contract
 *
 * - **Endpoint:** `POST https://api.deepgram.com/v1/listen`
 * - **Authentication:** `Authorization: Token <apiKey>` header
 * - **Content-Type:** Set to the audio's MIME type (e.g. `audio/wav`)
 * - **Body:** Raw audio bytes sent directly (no multipart form)
 * - **Query parameters:** `model`, `punctuate`, `diarize`, `language`
 * - **Response:** JSON containing `results.channels[].alternatives[]` with
 *   transcript text, confidence scores, and optional word-level timing
 *
 * ## Word-Level Diarization Mapping
 *
 * When `enableSpeakerDiarization` is `true`, the `diarize=true` query parameter
 * is set. Deepgram then includes a `speaker` field (zero-based integer index) on
 * each word in the response. These speaker indices are preserved through the
 * `wordsToSegments()` mapping into the normalized result.
 *
 * ## Error Handling
 *
 * Non-2xx responses from Deepgram trigger an `Error` with the HTTP status code
 * and response body text included in the message for debugging. Network-level
 * errors (DNS failures, timeouts) propagate as-is from the fetch implementation.
 *
 * Streaming is NOT supported by this provider — use a Deepgram WebSocket adapter
 * for real-time transcription.
 *
 * @see {@link DeepgramBatchSTTProviderConfig} for configuration options
 * See `wordsToSegments()` for the word-to-segment mapping logic.
 *
 * @example
 * ```ts
 * const provider = new DeepgramBatchSTTProvider({
 *   apiKey: process.env.DEEPGRAM_API_KEY!,
 *   model: 'nova-2',
 * });
 * const result = await provider.transcribe(
 *   { data: audioBuffer, mimeType: 'audio/wav' },
 *   { enableSpeakerDiarization: true },
 * );
 * console.log(result.text);
 * console.log(result.segments?.map(s => `[Speaker ${s.speaker}] ${s.text}`));
 * ```
 */
export class DeepgramBatchSTTProvider {
    constructor(config) {
        this.config = config;
        /** Unique provider identifier used for registration and resolution. */
        this.id = 'deepgram-batch';
        /** Human-readable display name for UI and logging. */
        this.displayName = 'Deepgram (Batch)';
        /** This provider uses synchronous HTTP requests, not WebSocket streaming. */
        this.supportsStreaming = false;
        this.fetchImpl = config.fetchImpl ?? fetch;
        this.keyPool = new ApiKeyPool(config.apiKey);
    }
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'Deepgram (Batch)'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'Deepgram (Batch)'
     * ```
     */
    getProviderName() {
        return this.displayName;
    }
    /**
     * Transcribes an audio buffer using the Deepgram pre-recorded API.
     *
     * Sends the raw audio bytes as the request body (not multipart form) with
     * the appropriate Content-Type header. The response is parsed and normalized
     * into a {@link SpeechTranscriptionResult}.
     *
     * @param audio - Raw audio data and associated metadata (buffer, MIME type,
     *   duration). The `data` buffer is sent directly as the request body.
     * @param options - Optional transcription settings. Supports `model`,
     *   `language`, and `enableSpeakerDiarization` overrides.
     * @returns A promise resolving to the normalized transcription result with
     *   text, confidence, timing, and optional speaker-attributed segments.
     * @throws {Error} When the Deepgram API returns a non-2xx status code.
     *   The error message includes the HTTP status and response body for debugging.
     *
     * @example
     * ```ts
     * const result = await provider.transcribe(
     *   { data: wavBuffer, mimeType: 'audio/wav', durationSeconds: 5.2 },
     *   { language: 'fr-FR', enableSpeakerDiarization: true },
     * );
     * ```
     */
    async transcribe(audio, options = {}) {
        // Resolve configuration with fallback chain: options > config > defaults
        const model = options.model ?? this.config.model ?? 'nova-2';
        const lang = options.language ?? this.config.language ?? 'en-US';
        const diarize = options.enableSpeakerDiarization ?? false;
        // Build the Deepgram REST API URL with query parameters.
        // Punctuation is always enabled for better transcript readability.
        const url = `https://api.deepgram.com/v1/listen` +
            `?model=${encodeURIComponent(model)}` +
            `&punctuate=true` +
            `&diarize=${diarize}` +
            `&language=${encodeURIComponent(lang)}`;
        // Use the audio's actual MIME type so Deepgram can decode correctly.
        // Deepgram supports wav, mp3, ogg, flac, webm, and many other formats.
        const contentType = audio.mimeType ?? 'audio/wav';
        const response = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
                Authorization: `Token ${this.keyPool.next()}`,
                'Content-Type': contentType,
            },
            // Cast needed because SpeechAudioInput.data is typed as Buffer but
            // fetch expects BodyInit (Blob | ArrayBuffer | string | etc.)
            body: audio.data,
        });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`Deepgram transcription failed (${response.status}): ${message}`);
        }
        const payload = (await response.json());
        // Extract the first channel's first alternative — Deepgram always returns
        // at least one channel with one alternative for valid audio input.
        const firstAlternative = payload.results?.channels?.[0]?.alternatives?.[0];
        const transcript = firstAlternative?.transcript ?? '';
        const confidence = firstAlternative?.confidence;
        const words = firstAlternative?.words ?? [];
        // Prefer the API's reported duration over the client-provided estimate
        const durationSeconds = payload.metadata?.duration ?? audio.durationSeconds;
        return {
            text: transcript,
            language: lang,
            durationSeconds,
            confidence,
            cost: 0, // Cost tracking is handled at a higher layer
            segments: words.length > 0 ? wordsToSegments(words) : undefined,
            providerResponse: payload,
            isFinal: true, // Batch API always returns final results
            usage: {
                durationMinutes: (durationSeconds ?? 0) / 60,
                modelUsed: model,
            },
        };
    }
}
//# sourceMappingURL=DeepgramBatchSTTProvider.js.map