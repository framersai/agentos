/**
 * @module voice-pipeline/HeuristicEndpointDetector
 *
 * A lightweight, rule-based endpoint detector that combines terminal punctuation
 * analysis with a configurable silence timeout to determine when the user has
 * finished speaking. Suitable for low-latency deployments where an LLM-based
 * semantic detector would add unacceptable round-trip overhead.
 *
 * ## Detection strategy
 *
 * 1. On `speech_end`, if the accumulated final transcript ends with `.`, `?`,
 *    or `!`, fire `turn_complete` immediately with reason `'punctuation'`.
 *    This provides the lowest-latency turn handoff for well-punctuated speech.
 *
 * 2. Otherwise, start a silence timer (default 1,500 ms). If speech does not
 *    resume before the timer fires, emit `turn_complete` with reason
 *    `'silence_timeout'`. The timeout acts as a safety net for STT providers
 *    that don't produce terminal punctuation reliably.
 *
 * 3. Backchannel phrases (e.g. "uh huh", "yeah") are recognised, suppressed
 *    from accumulation, and re-emitted as `'backchannel_detected'` events so
 *    the pipeline can decide whether to suppress an agent response.
 *
 * ## Why heuristic over acoustic-only?
 *
 * Pure silence timeout adds up to 1.5 s of unnecessary latency on every turn
 * when the user ends a sentence cleanly. By checking for terminal punctuation,
 * this detector can fire turn_complete immediately, cutting perceived latency
 * by more than half for typical conversational speech.
 *
 * @see {@link AcousticEndpointDetector} for the purely acoustic alternative.
 * @see {@link IEndpointDetector} for the interface contract.
 */
import { EventEmitter } from 'node:events';
import type { IEndpointDetector, TranscriptEvent, VadEvent } from './types.js';
/**
 * Constructor options for {@link HeuristicEndpointDetector}.
 *
 * @example
 * ```typescript
 * const detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 1000 });
 * ```
 */
export interface HeuristicEndpointDetectorOptions {
    /**
     * How long (ms) to wait after `speech_end` before emitting `turn_complete`
     * when no terminal punctuation is detected. Lower values reduce latency
     * but risk firing mid-sentence during natural pauses.
     * @defaultValue 1500
     */
    silenceTimeoutMs?: number;
}
/**
 * Heuristic endpoint detector that uses terminal punctuation and a silence
 * timeout to decide when the user's turn is complete.
 *
 * ## Events emitted
 *
 * | Event                    | Payload                  | Description                        |
 * |--------------------------|--------------------------|------------------------------------|
 * | `'turn_complete'`        | {@link TurnCompleteEvent}| User turn has ended.               |
 * | `'backchannel_detected'` | `{ text: string }`       | Backchannel phrase was recognised.  |
 *
 * @see {@link IEndpointDetector} for the interface contract.
 * @see {@link AcousticEndpointDetector} for the purely acoustic alternative.
 *
 * @example
 * ```typescript
 * const detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 1000 });
 * detector.on('turn_complete', (event) => console.log('Turn done:', event));
 *
 * // Simulate a punctuated sentence followed by speech_end
 * detector.pushTranscript({ text: 'Hello there.', isFinal: true, confidence: 0.95, words: [] });
 * detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now(), source: 'vad' });
 * // -> 'turn_complete' fires immediately with reason 'punctuation'
 * ```
 */
export declare class HeuristicEndpointDetector extends EventEmitter implements IEndpointDetector {
    /**
     * Active detection strategy label.
     * Always `'heuristic'` for this implementation.
     *
     * See `IEndpointDetector.mode`.
     */
    readonly mode: IEndpointDetector['mode'];
    /** Resolved silence timeout in milliseconds. */
    private readonly silenceTimeoutMs;
    /**
     * The latest final transcript text accumulated for the current turn.
     * Only updated by final (non-interim) transcript events.
     * Reset to empty string after each `turn_complete` emission.
     */
    private accumulatedText;
    /**
     * Whether the VAD currently reports active speech. Set to `true` on
     * `speech_start` and `false` on `speech_end`. Used to prevent the
     * silence timer from starting while the user is still speaking.
     */
    private speechActive;
    /**
     * Handle to a pending silence timeout, or `null` if none is running.
     * Cleared when speech resumes or when the detector is reset.
     */
    private silenceTimer;
    /**
     * Wall-clock timestamp (ms) when the current turn's speech started.
     * Used to compute `durationMs` in the emitted {@link TurnCompleteEvent}.
     * `null` when no speech has been detected in the current turn.
     */
    private turnStartMs;
    /**
     * Confidence of the most recent final transcript. Forwarded into the
     * emitted {@link TurnCompleteEvent}. Defaults to 1 (perfect confidence)
     * and is updated with each final transcript event.
     */
    private lastConfidence;
    /**
     * Create a new {@link HeuristicEndpointDetector}.
     *
     * @param options - Optional configuration overrides.
     */
    constructor(options?: HeuristicEndpointDetectorOptions);
    /**
     * Ingest a transcript event from the upstream STT session.
     *
     * Only final events (`isFinal: true`) affect internal state. Interim results
     * are silently ignored because:
     * 1. They arrive very frequently (10-50 per second) and would trigger
     *    excessive punctuation checks.
     * 2. Their text is unstable -- a word ending with "." may be revised in
     *    the next interim result, causing false turn-completion signals.
     *
     * If the final text is a recognised backchannel phrase, the detector emits
     * `'backchannel_detected'` and returns WITHOUT accumulating the text. This
     * prevents a subsequent `speech_end` event from triggering `turn_complete`
     * for what was merely an acknowledgement, not a real conversational turn.
     *
     * @param transcript - Transcript event from the STT session.
     */
    pushTranscript(transcript: TranscriptEvent): void;
    /**
     * Ingest a VAD (voice activity detection) event.
     *
     * Event handling by type:
     *
     * - **`speech_start`**: Marks the turn as active and cancels any pending
     *   silence timer (the user resumed speaking before the timeout elapsed).
     *   This is critical for avoiding false turn-completion when the user
     *   takes a brief pause mid-sentence.
     *
     * - **`speech_end`**: If accumulated text is available, either fires
     *   `turn_complete` immediately (when text ends with terminal punctuation)
     *   or starts the silence timer (when no punctuation is detected).
     *
     * - **`silence`**: Periodic heartbeat events are ignored. The silence timer
     *   (started on `speech_end`) already handles delayed turn-completion
     *   independently of heartbeat cadence.
     *
     * @param event - VAD transition event.
     */
    pushVadEvent(event: VadEvent): void;
    /**
     * Reset all internal state, cancel pending timers, and prepare the detector
     * for the next user turn.
     *
     * Called by the pipeline after each `turn_complete` event (both internally
     * and by the orchestrator's flush_complete handler) to ensure clean state
     * before audio for the next turn begins to arrive.
     */
    reset(): void;
    /**
     * Emit `turn_complete` with the currently accumulated transcript and then
     * reset internal state so the detector is ready for the next turn.
     *
     * The reset happens BEFORE the emit to ensure that any re-entrant listeners
     * (e.g. an endpoint detector handler that immediately calls pushVadEvent)
     * see clean state.
     *
     * @param reason - The semantic reason driving this completion.
     * @param speechEndTimestamp - Unix epoch ms timestamp of the `speech_end` event,
     *   used to compute `durationMs` as `speechEndTimestamp - turnStartMs`.
     */
    private _emitTurnComplete;
    /**
     * Start the silence-timeout timer. If the user does not resume speaking
     * within `silenceTimeoutMs` ms, the detector fires `turn_complete`
     * with reason `'silence_timeout'`.
     *
     * Any previously running silence timer is cleared first to prevent
     * double-fires from rapid speech_end -> speech_start -> speech_end sequences.
     *
     * @param speechEndTimestamp - Timestamp passed through to the internal turn-complete emitter
     *   for duration calculation.
     */
    private _startSilenceTimer;
    /**
     * Cancel a pending silence timer without any side effects.
     * Safe to call when no timer is active (no-op).
     */
    private _clearSilenceTimer;
}
//# sourceMappingURL=HeuristicEndpointDetector.d.ts.map