/**
 * @module voice-pipeline/AcousticEndpointDetector
 *
 * Acoustic-only endpoint detector that wraps {@link SilenceDetector} to convert
 * VAD events into turn-completion decisions. It ignores transcript content entirely
 * and relies solely on the duration of post-speech silence to decide when the user
 * has finished speaking.
 *
 * ## How it works
 *
 * This detector delegates all silence timing to a {@link SilenceDetector} instance
 * (from `media/audio/`). The SilenceDetector maintains an internal timer that
 * starts when `handleSpeechEnd()` is called and fires `'utterance_end_detected'`
 * when silence exceeds the configured `utteranceEndThresholdMs`. A
 * `handleSpeechStart()` call cancels the timer.
 *
 * ## Energy threshold adaptation
 *
 * The SilenceDetector internally uses adaptive energy thresholds from the
 * {@link AdaptiveVAD}. The VAD continuously recalibrates its speech/silence
 * boundary based on ambient noise levels, so the effective silence threshold
 * adapts to the environment (e.g. coffee shop vs quiet room). This detector
 * does not perform its own energy analysis -- it trusts the upstream VAD's
 * speech_start/speech_end decisions.
 *
 * ## When to use
 *
 * Use this detector when:
 * - The STT provider does not produce reliable punctuation.
 * - You want the simplest possible endpoint detection with no linguistic analysis.
 * - Latency tolerance is higher (the full `utteranceEndThresholdMs` is always
 *   consumed, unlike the {@link HeuristicEndpointDetector} which can fire
 *   immediately on terminal punctuation).
 *
 * @see {@link HeuristicEndpointDetector} for the rule-based alternative with
 *   punctuation-triggered fast path.
 * @see {@link IEndpointDetector} for the interface contract.
 * @see {@link SilenceDetector} for the underlying silence timing logic.
 *
 * ## Events emitted
 *
 * | Event             | Payload                  | Description                                 |
 * |-------------------|--------------------------|---------------------------------------------|
 * | `'turn_complete'` | {@link TurnCompleteEvent} | Silence exceeded `utteranceEndThresholdMs`. |
 * | `'speech_start'`  | *(none)*                 | Re-emitted from incoming VAD event.         |
 */
import { EventEmitter } from 'node:events';
import { SilenceDetector } from '../hearing/SilenceDetector.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Purely acoustic endpoint detector.
 *
 * Delegates silence timing to a {@link SilenceDetector} instance. VAD
 * `speech_end` events start the silence clock; `speech_start` events cancel
 * any pending turn-complete emission. Transcript content is completely ignored.
 *
 * @see {@link IEndpointDetector} for the interface contract.
 * @see {@link HeuristicEndpointDetector} for the heuristic alternative.
 *
 * @example
 * ```typescript
 * const detector = new AcousticEndpointDetector({ utteranceEndThresholdMs: 2000 });
 * detector.on('turn_complete', (event) => {
 *   console.log(`Turn done after ${event.durationMs}ms of speech`);
 * });
 * detector.pushVadEvent({ type: 'speech_start', timestamp: Date.now() });
 * detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now() + 500 });
 * // -> After 2000ms of silence, 'turn_complete' fires with reason 'silence_timeout'
 * ```
 */
export class AcousticEndpointDetector extends EventEmitter {
    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------
    /**
     * Creates a new AcousticEndpointDetector.
     *
     * @param config - Optional silence-threshold overrides.
     */
    constructor(config = {}) {
        super();
        /**
         * Detection mode identifier. Always `'acoustic'` for this implementation.
         * See `IEndpointDetector.mode`.
         */
        this.mode = 'acoustic';
        /**
         * Timestamp (ms) when the current speech segment began. Used to compute
         * `durationMs` in the emitted {@link TurnCompleteEvent} as:
         * `speechEndTimeMs - speechStartTimeMs`.
         *
         * Reset to `null` on each `reset` call.
         */
        this.speechStartTimeMs = null;
        /**
         * Timestamp (ms) when the most recent `speech_end` VAD event was received.
         * Used together with `speechStartTimeMs` to calculate `durationMs`
         * for the turn-complete event.
         *
         * Reset to `null` on each `reset` call.
         */
        this.speechEndTimeMs = null;
        // Build SilenceDetector config from our options with sensible defaults
        const sdConfig = {
            significantPauseThresholdMs: config.significantPauseThresholdMs ?? 1500,
            utteranceEndThresholdMs: config.utteranceEndThresholdMs ?? 3000,
        };
        this.silenceDetector = new SilenceDetector(sdConfig);
        // When SilenceDetector decides the utterance has ended (silence exceeded
        // utteranceEndThresholdMs), translate that into a TurnCompleteEvent.
        this.silenceDetector.on('utterance_end_detected', (_silenceDurationMs) => {
            // Compute the duration of actual speech (not including silence).
            // Falls back to 0 if timestamps are missing (defensive).
            const durationMs = this.speechStartTimeMs !== null && this.speechEndTimeMs !== null
                ? this.speechEndTimeMs - this.speechStartTimeMs
                : 0;
            const event = {
                // Acoustic mode has no transcript access -- the orchestrator will
                // use whatever transcript the STT session has accumulated separately.
                transcript: '',
                // Confidence is 0 because we have no STT data to score.
                confidence: 0,
                durationMs,
                reason: 'silence_timeout',
            };
            this.emit('turn_complete', event);
        });
    }
    // ---------------------------------------------------------------------------
    // IEndpointDetector -- pushVadEvent
    // ---------------------------------------------------------------------------
    /**
     * Converts a {@link VadEvent} into the SilenceDetector's expected API calls.
     *
     * - **`speech_start`**: Resets silence state (cancels pending timers) and
     *   re-emits `'speech_start'` on this detector for pipeline consumption.
     * - **`speech_end`**: Records the timestamp and starts the silence clock.
     * - **`silence`**: Treated as ongoing non-speech frames, advancing the
     *   SilenceDetector's internal timer.
     *
     * @param event - Incoming VAD event from the upstream voice activity detector.
     */
    pushVadEvent(event) {
        // The SilenceDetector's API requires a VADResult parameter, but it only
        // uses it as a pass-through and doesn't inspect its contents. We pass
        // a minimal stub typed as `never` to satisfy the signature without
        // introducing a dependency on the full VADResult type.
        const vadResultStub = { timestamp: event.timestamp };
        switch (event.type) {
            case 'speech_start':
                // Record when speech began for duration calculation
                this.speechStartTimeMs = event.timestamp;
                // Clear the previous speech_end since a new speech segment started
                this.speechEndTimeMs = null;
                // Notify SilenceDetector to cancel any pending silence timer
                this.silenceDetector.handleSpeechStart(vadResultStub);
                // Re-emit for pipeline consumers (e.g. barge-in detection)
                this.emit('speech_start');
                break;
            case 'speech_end':
                // Record when speech ended for duration calculation
                this.speechEndTimeMs = event.timestamp;
                // Start the silence clock -- if silence persists beyond
                // utteranceEndThresholdMs, SilenceDetector fires utterance_end_detected.
                // The second argument (0) is the energy level -- not used in our context.
                this.silenceDetector.handleSpeechEnd(vadResultStub, 0);
                break;
            case 'silence':
                // Periodic silence heartbeat -- advance SilenceDetector's internal
                // timer by notifying it of continued non-speech activity.
                this.silenceDetector.handleNoVoiceActivity(vadResultStub);
                break;
        }
    }
    // ---------------------------------------------------------------------------
    // IEndpointDetector -- pushTranscript
    // ---------------------------------------------------------------------------
    /**
     * No-op -- this detector is purely acoustic and does not use transcript content.
     *
     * The method exists solely to satisfy the {@link IEndpointDetector} interface.
     * Calling it has no effect and does not throw.
     *
     * @param _event - Ignored transcript event.
     */
    pushTranscript(_event) {
        // Intentional no-op: acoustic mode ignores all linguistic content.
        // The HeuristicEndpointDetector should be used if transcript-based
        // endpoint detection is desired.
    }
    // ---------------------------------------------------------------------------
    // IEndpointDetector -- reset
    // ---------------------------------------------------------------------------
    /**
     * Resets all internal state and cancels pending timers.
     *
     * Should be called at the start of each new turn to ensure clean state.
     * This also resets the underlying SilenceDetector, cancelling any pending
     * utterance_end_detected timer.
     */
    reset() {
        this.speechStartTimeMs = null;
        this.speechEndTimeMs = null;
        this.silenceDetector.reset();
    }
}
//# sourceMappingURL=AcousticEndpointDetector.js.map