/**
 * @module voice-pipeline/HeuristicEndpointDetector
 *
 * A lightweight, rule-based endpoint detector that combines terminal punctuation
 * analysis with a configurable silence timeout to determine when the user has
 * finished speaking. Suitable for low-latency deployments where an LLM-based
 * semantic detector would add unacceptable round-trip overhead.
 *
 * Detection strategy:
 *   1. On `speech_end`, if the accumulated final transcript ends with `.`, `?`, or `!`,
 *      fire `turn_complete` immediately with reason `'punctuation'`.
 *   2. Otherwise, start a silence timer (default 1 500 ms). If speech does not
 *      resume before the timer fires, emit `turn_complete` with reason `'silence_timeout'`.
 *   3. Backchannel phrases (e.g. "uh huh", "yeah") are recognised, suppressed from
 *      accumulation, and re-emitted as `'backchannel_detected'` events so the
 *      pipeline can decide whether to suppress an agent response.
 */

import { EventEmitter } from 'node:events';
import type {
  IEndpointDetector,
  TranscriptEvent,
  VadEvent,
  TurnCompleteEvent,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default silence duration (ms) after speech stops before firing `turn_complete`.
 */
const DEFAULT_SILENCE_TIMEOUT_MS = 1_500;

/**
 * Terminal punctuation characters that signal sentence completion.
 */
const TERMINAL_PUNCTUATION = /[.?!]$/;

/**
 * Normalised backchannel phrases that indicate the listener is acknowledging
 * but not taking a full conversational turn. Compared after `.trim().toLowerCase()`.
 */
const BACKCHANNEL_PHRASES = new Set([
  'uh huh',
  'yeah',
  'okay',
  'ok',
  'mm hmm',
  'mmhmm',
  'mhm',
  'mm-hmm',
  'right',
  'sure',
  'yep',
  'yup',
  'gotcha',
]);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link HeuristicEndpointDetector}.
 */
export interface HeuristicEndpointDetectorOptions {
  /**
   * How long (ms) to wait after `speech_end` before emitting `turn_complete`
   * when no terminal punctuation is detected.
   * @defaultValue 1500
   */
  silenceTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Heuristic endpoint detector that uses terminal punctuation and a silence
 * timeout to decide when the user's turn is complete.
 *
 * Emits:
 * - `'turn_complete'` ({@link TurnCompleteEvent}) — user turn has ended.
 * - `'backchannel_detected'` (`{ text: string }`) — a backchannel phrase was
 *   recognised; accumulation is suppressed for this utterance.
 *
 * @example
 * ```typescript
 * const detector = new HeuristicEndpointDetector({ silenceTimeoutMs: 1000 });
 * detector.on('turn_complete', (event) => console.log('Turn done:', event));
 * detector.pushTranscript({ text: 'Hello there.', isFinal: true, confidence: 0.95, words: [] });
 * detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now(), source: 'vad' });
 * // → 'turn_complete' fires immediately with reason 'punctuation'
 * ```
 */
export class HeuristicEndpointDetector
  extends EventEmitter
  implements IEndpointDetector
{
  /**
   * Active detection strategy label.
   * Typed as `'hybrid'` to satisfy {@link IEndpointDetector.mode}; consumers
   * that need to distinguish heuristic detectors may inspect `instanceof`.
   */
  readonly mode: IEndpointDetector['mode'] = 'heuristic';

  /** Resolved silence timeout in milliseconds. */
  private readonly silenceTimeoutMs: number;

  /** The latest final transcript text accumulated for the current turn. */
  private accumulatedText = '';

  /** Whether the VAD currently reports active speech. */
  private speechActive = false;

  /** Handle to a pending silence timeout, or `null` if none is running. */
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Wall-clock timestamp (ms) when the current turn's speech started. */
  private turnStartMs: number | null = null;

  /** Confidence of the most recent final transcript. */
  private lastConfidence = 1;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new {@link HeuristicEndpointDetector}.
   *
   * @param options — Optional configuration overrides.
   */
  constructor(options: HeuristicEndpointDetectorOptions = {}) {
    super();
    this.silenceTimeoutMs = options.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
  }

  // ---------------------------------------------------------------------------
  // IEndpointDetector — pushTranscript
  // ---------------------------------------------------------------------------

  /**
   * Ingest a transcript event from the upstream STT session.
   *
   * Only final events (`isFinal: true`) affect internal state. Interim results
   * are silently ignored — they may arrive very frequently and their text is
   * unstable.
   *
   * If the final text is a recognised backchannel phrase the detector emits
   * `'backchannel_detected'` and returns without accumulating the text, so that
   * a subsequent `speech_end` event does not trigger `turn_complete`.
   *
   * @param transcript — Transcript event from the STT session.
   */
  pushTranscript(transcript: TranscriptEvent): void {
    if (!transcript.isFinal) {
      // Ignore partial/interim hypotheses — they will be superseded.
      return;
    }

    const text = transcript.text;
    const normalised = text.trim().toLowerCase();

    // Detect backchannel acknowledgements before accumulating.
    if (BACKCHANNEL_PHRASES.has(normalised)) {
      this.emit('backchannel_detected', { text });
      return;
    }

    // Accumulate the final transcript and store the confidence score.
    this.accumulatedText = text;
    this.lastConfidence = transcript.confidence;
  }

  // ---------------------------------------------------------------------------
  // IEndpointDetector — pushVadEvent
  // ---------------------------------------------------------------------------

  /**
   * Ingest a VAD (voice activity detection) event.
   *
   * - `speech_start`: marks the turn as active and cancels any pending silence
   *   timer (the user resumed speaking before the timeout elapsed).
   * - `speech_end`: if accumulated text is available, either fires
   *   `turn_complete` immediately (punctuation) or starts the silence timer.
   * - `silence`: heartbeat events are ignored; only explicit `speech_end`
   *   drives the timeout logic.
   *
   * @param event — VAD transition event.
   */
  pushVadEvent(event: VadEvent): void {
    switch (event.type) {
      case 'speech_start': {
        this.speechActive = true;
        this._clearSilenceTimer();
        if (this.turnStartMs === null) {
          this.turnStartMs = event.timestamp;
        }
        break;
      }

      case 'speech_end': {
        this.speechActive = false;

        if (!this.accumulatedText) {
          // Nothing to flush — no transcript arrived yet.
          break;
        }

        if (TERMINAL_PUNCTUATION.test(this.accumulatedText)) {
          // Sentence-terminal punctuation → fire immediately.
          this._emitTurnComplete('punctuation', event.timestamp);
        } else {
          // No punctuation → wait for silence timeout.
          this._startSilenceTimer(event.timestamp);
        }
        break;
      }

      case 'silence': {
        // Periodic heartbeat — no action required; the silence timer already
        // handles the delayed fire if one is pending.
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IEndpointDetector — reset
  // ---------------------------------------------------------------------------

  /**
   * Reset all internal state, cancel pending timers, and prepare the detector
   * for the next user turn. Should be called by the pipeline after each
   * `turn_complete` event before audio for the next turn begins to arrive.
   */
  reset(): void {
    this._clearSilenceTimer();
    this.accumulatedText = '';
    this.speechActive = false;
    this.turnStartMs = null;
    this.lastConfidence = 1;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Emit `turn_complete` with the currently accumulated transcript and then
   * reset internal state so the detector is ready for the next turn.
   *
   * @param reason — The semantic reason driving this completion.
   * @param speechEndTimestamp — Unix epoch ms timestamp of the `speech_end` event,
   *   used to compute `durationMs`.
   */
  private _emitTurnComplete(
    reason: TurnCompleteEvent['reason'],
    speechEndTimestamp: number,
  ): void {
    const durationMs =
      this.turnStartMs !== null ? speechEndTimestamp - this.turnStartMs : 0;

    const event: TurnCompleteEvent = {
      transcript: this.accumulatedText,
      confidence: this.lastConfidence,
      durationMs,
      reason,
    };

    // Reset before emitting so that any re-entrant listeners see clean state.
    this.reset();

    this.emit('turn_complete', event);
  }

  /**
   * Start the silence-timeout timer. If the user does not resume speaking
   * within {@link silenceTimeoutMs} ms the detector fires `turn_complete`.
   *
   * @param speechEndTimestamp — Timestamp passed through to `_emitTurnComplete`.
   */
  private _startSilenceTimer(speechEndTimestamp: number): void {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this._emitTurnComplete('silence_timeout', speechEndTimestamp);
    }, this.silenceTimeoutMs);
  }

  /**
   * Cancel a pending silence timer without any side effects.
   */
  private _clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}
