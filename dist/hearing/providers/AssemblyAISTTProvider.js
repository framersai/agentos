/** Base URL for all AssemblyAI API v2 endpoints. */
const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
/**
 * Maximum time (in milliseconds) to wait for a transcript to complete
 * before throwing a timeout error.
 *
 * 120 seconds is generous — most transcripts complete within 10–30 seconds.
 * The timeout exists to prevent indefinite polling in case of AssemblyAI
 * service degradation or stuck transcripts.
 */
const DEFAULT_TIMEOUT_MS = 120000;
/**
 * Polling interval (in milliseconds) between transcript status checks.
 *
 * 1 second strikes a balance between responsiveness and API rate limiting.
 * AssemblyAI does not document a rate limit for polling, but 1-second
 * intervals are considered polite and are used in their official examples.
 */
const POLL_INTERVAL_MS = 1000;
/**
 * Maps AssemblyAI word objects to {@link SpeechTranscriptionSegment} entries.
 *
 * Each word becomes its own segment so that per-word timing and speaker
 * attribution are preserved in the normalized result.
 *
 * **Important:** AssemblyAI returns word timings in milliseconds, so we
 * divide by 1000 to convert to seconds for consistency with our normalized
 * {@link SpeechTranscriptionSegment} interface (which uses seconds).
 *
 * @param words - Array of AssemblyAI word objects with millisecond timings.
 * @returns An array of normalized transcription segments with second-based timings.
 *
 * @see {@link AssemblyAIWord} for the input shape
 * @see {@link SpeechTranscriptionSegment} for the output shape
 */
function wordsToSegments(words) {
    return words.map((w) => ({
        text: w.text,
        startTime: w.start / 1000, // AssemblyAI returns milliseconds -> convert to seconds
        endTime: w.end / 1000,
        confidence: w.confidence,
        // Convert null speaker labels to undefined for type consistency
        speaker: w.speaker ?? undefined,
        words: [
            {
                word: w.text,
                start: w.start / 1000,
                end: w.end / 1000,
                confidence: w.confidence,
            },
        ],
    }));
}
/**
 * Speech-to-text provider that uses the AssemblyAI async transcription API.
 *
 * ## Three-Step Workflow
 *
 * AssemblyAI uses an asynchronous transcription pipeline that requires three
 * sequential HTTP requests:
 *
 * 1. **Upload** — `POST /v2/upload` sends the raw audio bytes to AssemblyAI's
 *    CDN and returns an `upload_url`. This step is necessary because the
 *    transcript endpoint accepts URLs, not raw audio.
 *
 * 2. **Submit** — `POST /v2/transcript` creates a transcription job referencing
 *    the upload URL. Returns a transcript `id` used for polling. Optional
 *    features like `speaker_labels` are enabled in this request's JSON body.
 *
 * 3. **Poll** — `GET /v2/transcript/:id` is called every `POLL_INTERVAL_MS`
 *    (1 second) until the transcript `status` transitions to `'completed'` or
 *    `'error'`. The polling loop is bounded by `DEFAULT_TIMEOUT_MS`
 *    (120 seconds) to prevent indefinite waiting.
 *
 * ## AbortController Usage
 *
 * An optional `AbortSignal` can be passed via
 * `options.providerSpecificOptions.signal` to cancel the transcription at any
 * point. The signal is forwarded to all three fetch calls and also checked at
 * the top of each polling iteration. When aborted, an error is thrown
 * immediately without waiting for the current fetch to complete.
 *
 * ## Error Handling
 *
 * - Non-2xx responses at any step throw an `Error` with the HTTP status and body.
 * - `status === 'error'` on the transcript throws with AssemblyAI's error message.
 * - Timeout expiry throws with the transcript ID for manual inspection.
 * - Aborted signals throw with a descriptive cancellation message.
 *
 * @see {@link AssemblyAISTTProviderConfig} for configuration options
 * See `AssemblyAITranscript` for the polling response shape.
 *
 * @example
 * ```ts
 * const provider = new AssemblyAISTTProvider({
 *   apiKey: process.env.ASSEMBLYAI_API_KEY!,
 * });
 *
 * // Basic transcription
 * const result = await provider.transcribe({ data: audioBuffer });
 *
 * // With diarization and cancellation support
 * const controller = new AbortController();
 * const result = await provider.transcribe(
 *   { data: audioBuffer },
 *   {
 *     enableSpeakerDiarization: true,
 *     providerSpecificOptions: { signal: controller.signal },
 *   },
 * );
 * ```
 */
export class AssemblyAISTTProvider {
    /**
     * Creates a new AssemblyAISTTProvider.
     *
     * @param config - Provider configuration including the API key.
     *
     * @example
     * ```ts
     * const provider = new AssemblyAISTTProvider({
     *   apiKey: 'your-assemblyai-api-key',
     * });
     * ```
     */
    constructor(config) {
        this.config = config;
        /** Unique provider identifier used for registration and resolution. */
        this.id = 'assemblyai';
        /** Human-readable display name for UI and logging. */
        this.displayName = 'AssemblyAI';
        /**
         * Streaming is not supported by this provider's async pipeline.
         * AssemblyAI does offer a separate real-time streaming API via WebSocket,
         * but that would be a different provider implementation.
         */
        this.supportsStreaming = false;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }
    /**
     * Returns the human-readable provider name.
     *
     * @returns The display name string `'AssemblyAI'`.
     *
     * @example
     * ```ts
     * provider.getProviderName(); // 'AssemblyAI'
     * ```
     */
    getProviderName() {
        return this.displayName;
    }
    /**
     * Transcribes an audio buffer via the AssemblyAI three-step async pipeline:
     * upload, submit, and poll.
     *
     * @param audio - Raw audio data and associated metadata. The `data` buffer
     *   is uploaded to AssemblyAI's CDN in step 1.
     * @param options - Optional transcription settings. Pass
     *   `providerSpecificOptions.signal` (an `AbortSignal`) to cancel
     *   at any point in the pipeline.
     * @returns A promise resolving to the normalized transcription result.
     * @throws {Error} When the upload API returns a non-2xx status.
     * @throws {Error} When the transcript submit API returns a non-2xx status.
     * @throws {Error} When the polling API returns a non-2xx status.
     * @throws {Error} When the transcript status becomes `'error'` (includes
     *   AssemblyAI's error message, e.g. "Audio file could not be decoded").
     * @throws {Error} When the 120-second timeout is exceeded (includes the
     *   transcript ID for manual inspection via the AssemblyAI dashboard).
     * @throws {Error} When the caller's AbortSignal is triggered.
     *
     * @example
     * ```ts
     * const result = await provider.transcribe(
     *   { data: wavBuffer, mimeType: 'audio/wav' },
     *   { enableSpeakerDiarization: true, language: 'en' },
     * );
     * console.log(result.text);
     * console.log(result.segments?.map(s => `[${s.speaker}] ${s.text}`));
     * ```
     */
    async transcribe(audio, options = {}) {
        // Extract the optional AbortSignal for cancellation support.
        // Cast is safe because we document the expected type in the JSDoc.
        const signal = options.providerSpecificOptions?.signal;
        const timeoutMs = DEFAULT_TIMEOUT_MS;
        // ── Step 1: Upload audio to AssemblyAI's CDN ──────────────────────────
        // The upload endpoint returns an `upload_url` that the transcript
        // endpoint can reference. This avoids sending raw bytes to /transcript.
        const uploadResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/upload`, {
            method: 'POST',
            headers: {
                Authorization: this.config.apiKey,
                'Content-Type': audio.mimeType ?? 'audio/wav',
            },
            body: audio.data,
            signal,
        });
        if (!uploadResponse.ok) {
            const msg = await uploadResponse.text();
            throw new Error(`AssemblyAI upload failed (${uploadResponse.status}): ${msg}`);
        }
        const { upload_url } = (await uploadResponse.json());
        // ── Step 2: Submit transcript request ─────────────────────────────────
        // Create a transcription job with the uploaded audio URL and any
        // optional features like speaker diarization.
        const submitPayload = {
            audio_url: upload_url,
            speaker_labels: options.enableSpeakerDiarization ?? false,
        };
        if (options.language)
            submitPayload.language_code = options.language;
        const submitResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/transcript`, {
            method: 'POST',
            headers: {
                Authorization: this.config.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(submitPayload),
            signal,
        });
        if (!submitResponse.ok) {
            const msg = await submitResponse.text();
            throw new Error(`AssemblyAI transcript submit failed (${submitResponse.status}): ${msg}`);
        }
        const { id } = (await submitResponse.json());
        // ── Step 3: Poll until completed or error ─────────────────────────────
        // Check the transcript status every POLL_INTERVAL_MS until it reaches
        // a terminal state or the timeout is exceeded.
        const deadline = Date.now() + timeoutMs;
        while (true) {
            // Check for caller-initiated cancellation before each poll
            if (signal?.aborted) {
                throw new Error('AssemblyAI transcription aborted by caller signal');
            }
            // Check for timeout before each poll to avoid one extra unnecessary request
            if (Date.now() >= deadline) {
                throw new Error(`AssemblyAI transcription timed out after ${timeoutMs / 1000}s (transcript id: ${id})`);
            }
            const pollResponse = await this.fetchImpl(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
                headers: { Authorization: this.config.apiKey },
                signal,
            });
            if (!pollResponse.ok) {
                const msg = await pollResponse.text();
                throw new Error(`AssemblyAI poll failed (${pollResponse.status}): ${msg}`);
            }
            const transcript = (await pollResponse.json());
            // Terminal state: transcription failed on AssemblyAI's side
            if (transcript.status === 'error') {
                throw new Error(`AssemblyAI transcription error: ${transcript.error ?? 'unknown error'}`);
            }
            // Terminal state: transcription succeeded — normalize and return
            if (transcript.status === 'completed') {
                const text = transcript.text ?? '';
                const durationSeconds = transcript.audio_duration ?? audio.durationSeconds;
                const words = transcript.words ?? [];
                return {
                    text,
                    language: transcript.language_code ?? options.language,
                    durationSeconds,
                    confidence: transcript.confidence ?? undefined,
                    cost: 0, // Cost tracking is handled at a higher layer
                    segments: words.length > 0 ? wordsToSegments(words) : undefined,
                    providerResponse: transcript,
                    isFinal: true, // Async API always returns final results
                    usage: {
                        durationMinutes: (durationSeconds ?? 0) / 60,
                        modelUsed: 'assemblyai',
                    },
                };
            }
            // Non-terminal state ('queued' or 'processing') — wait before polling again.
            // Using setTimeout instead of a busy loop to yield the event loop.
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    }
}
//# sourceMappingURL=AssemblyAISTTProvider.js.map