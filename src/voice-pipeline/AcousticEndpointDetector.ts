/**
 * @module voice-pipeline/AcousticEndpointDetector
 *
 * Acoustic-only endpoint detector that wraps {@link SilenceDetector} to convert
 * VAD events into turn-completion decisions. It ignores transcript content entirely
 * and relies solely on the duration of post-speech silence to decide when the user
 * has finished speaking.
 *
 * Emits:
 * - `'turn_complete'` ({@link TurnCompleteEvent}) — silence exceeded the configured
 *   `utteranceEndThresholdMs` after the most recent `speech_end` VAD event.
 * - `'speech_start'` () — re-emitted when a `speech_start` VAD event is received.
 */

import { EventEmitter } from 'node:events';
import { SilenceDetector, type SilenceDetectorConfig } from '../core/audio/SilenceDetector.js';
import type {
  IEndpointDetector,
  VadEvent,
  TranscriptEvent,
  TurnCompleteEvent,
} from './types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link AcousticEndpointDetector}.
 */
export interface AcousticEndpointDetectorConfig {
  /**
   * Silence duration after speech (ms) that triggers a "significant pause"
   * notification on the underlying {@link SilenceDetector}. Does not directly
   * cause `turn_complete` to fire, but is forwarded to the SilenceDetector.
   * @defaultValue 1500
   */
  significantPauseThresholdMs?: number;

  /**
   * Silence duration after speech (ms) that triggers `turn_complete` with
   * `reason: 'silence_timeout'`.
   * @defaultValue 3000
   */
  utteranceEndThresholdMs?: number;
}

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
 * @example
 * ```ts
 * const detector = new AcousticEndpointDetector({ utteranceEndThresholdMs: 2000 });
 * detector.on('turn_complete', (event) => console.log('Turn done:', event));
 * detector.pushVadEvent({ type: 'speech_end', timestamp: Date.now() });
 * ```
 */
export class AcousticEndpointDetector extends EventEmitter implements IEndpointDetector {
  /** @inheritdoc */
  public readonly mode = 'acoustic' as const;

  /** Underlying silence-duration tracker. */
  private readonly silenceDetector: SilenceDetector;

  /**
   * Timestamp (ms) when the current speech segment began. Tracked so that
   * `durationMs` in the emitted {@link TurnCompleteEvent} can be computed.
   */
  private speechStartTimeMs: number | null = null;

  /**
   * Timestamp (ms) when the most recent `speech_end` VAD event was received.
   * Used to calculate `durationMs` for the turn-complete event.
   */
  private speechEndTimeMs: number | null = null;

  // ---------------------------------------------------------------------------

  /**
   * Creates a new AcousticEndpointDetector.
   *
   * @param config - Optional silence-threshold overrides.
   */
  constructor(config: AcousticEndpointDetectorConfig = {}) {
    super();

    const sdConfig: SilenceDetectorConfig = {
      significantPauseThresholdMs: config.significantPauseThresholdMs ?? 1500,
      utteranceEndThresholdMs: config.utteranceEndThresholdMs ?? 3000,
    };

    this.silenceDetector = new SilenceDetector(sdConfig);

    // When SilenceDetector decides the utterance has ended, fire turn_complete.
    this.silenceDetector.on('utterance_end_detected', (_silenceDurationMs: number) => {
      const durationMs =
        this.speechStartTimeMs !== null && this.speechEndTimeMs !== null
          ? this.speechEndTimeMs - this.speechStartTimeMs
          : 0;

      const event: TurnCompleteEvent = {
        transcript: '',   // Acoustic mode has no transcript access
        confidence: 0,
        durationMs,
        reason: 'silence_timeout',
      };

      this.emit('turn_complete', event);
    });
  }

  // ---------------------------------------------------------------------------
  // IEndpointDetector
  // ---------------------------------------------------------------------------

  /**
   * Converts a {@link VadEvent} into the SilenceDetector's expected API calls.
   *
   * - `speech_start` — resets silence state and re-emits `'speech_start'` on self.
   * - `speech_end` — starts the silence clock.
   * - `silence` — treated as ongoing non-speech frames.
   *
   * @param event - Incoming VAD event.
   */
  public pushVadEvent(event: VadEvent): void {
    // Minimal VADResult stub — SilenceDetector's public methods only use it as
    // a pass-through parameter and don't inspect its contents.
    const vadResultStub = { timestamp: event.timestamp } as never;

    switch (event.type) {
      case 'speech_start':
        this.speechStartTimeMs = event.timestamp;
        this.speechEndTimeMs = null;
        this.silenceDetector.handleSpeechStart(vadResultStub);
        this.emit('speech_start');
        break;

      case 'speech_end':
        this.speechEndTimeMs = event.timestamp;
        this.silenceDetector.handleSpeechEnd(vadResultStub, 0);
        break;

      case 'silence':
        // Periodic silence heartbeat — pass as a non-speech frame.
        this.silenceDetector.handleNoVoiceActivity(vadResultStub);
        break;
    }
  }

  /**
   * No-op — this detector is purely acoustic and does not use transcript content.
   *
   * @param _event - Ignored transcript event.
   */
  public pushTranscript(_event: TranscriptEvent): void {
    // Intentional no-op: acoustic mode ignores linguistic content.
  }

  /**
   * Resets all internal state and timers. Call at the start of each new turn.
   */
  public reset(): void {
    this.speechStartTimeMs = null;
    this.speechEndTimeMs = null;
    this.silenceDetector.reset();
  }
}
