/**
 * @file VoiceTurnCollector.ts
 * @description Subscribes to voice pipeline session events and maintains a
 * running transcript buffer, turn counter, and last-speaker tracker.
 *
 * The collector bridges the raw EventEmitter-based voice pipeline session into
 * the typed `GraphEvent` stream consumed by the graph runtime. Four session
 * events are handled:
 *
 * - `interim_transcript` — partial STT result; forwarded as a non-final
 *   `voice_transcript` GraphEvent but **not** buffered (too noisy).
 * - `final_transcript` — confirmed STT result; buffered in `transcript` and
 *   forwarded as a final `voice_transcript` GraphEvent.
 * - `turn_complete` — endpoint detection fired; increments `turnCount` and
 *   emits a `voice_turn_complete` GraphEvent.
 * - `barge_in` — user interrupted the agent mid-speech; emits a
 *   `voice_barge_in` GraphEvent.
 *
 * The `initialTurnCount` constructor parameter enables checkpoint restore:
 * pass the previously persisted count so that `turnIndex` values continue
 * from where the session left off rather than resetting to zero.
 */

import { EventEmitter } from 'events';
import type { GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// TranscriptEntry
// ---------------------------------------------------------------------------

/**
 * A single confirmed (final) utterance captured from the voice pipeline.
 *
 * Only `final_transcript` events populate this buffer — interim partials are
 * discarded to keep the transcript clean and avoid duplicate entries.
 */
export interface TranscriptEntry {
  /** Speaker identifier as reported by the STT service (e.g. `"Speaker_0"`). */
  speaker: string;
  /** Recognised text for this utterance. */
  text: string;
  /**
   * Wall-clock timestamp (milliseconds since Unix epoch) recorded at the
   * moment the `final_transcript` event was processed.
   */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// VoiceTurnCollector
// ---------------------------------------------------------------------------

/**
 * Stateful collector that subscribes to a voice pipeline session and routes
 * session events into the AgentOS `GraphEvent` stream.
 *
 * @example
 * ```ts
 * const collector = new VoiceTurnCollector(
 *   session,
 *   (evt) => graphEventEmitter.emit(evt),
 *   'voice-node-1',
 * );
 *
 * // After the conversation:
 * console.log(collector.getTurnCount());   // number of completed turns
 * console.log(collector.getTranscript());  // full buffered transcript
 * console.log(collector.getLastSpeaker()); // last identified speaker
 * ```
 */
export class VoiceTurnCollector {
  /** Buffered confirmed utterances in chronological order. */
  private transcript: TranscriptEntry[] = [];

  /** Running count of completed turns (endpoint-detected). */
  private turnCount: number;

  /** Speaker identifier from the most recent `final_transcript` event. */
  private lastSpeaker = '';

  /**
   * @param session          - The voice pipeline `EventEmitter` to subscribe to.
   * @param eventSink        - Callback invoked synchronously for every emitted `GraphEvent`.
   * @param nodeId           - Identifies the owning graph node in every emitted event.
   * @param initialTurnCount - Seed value for `turnCount`; pass a persisted value to
   *                           resume from a checkpoint rather than starting at zero.
   */
  constructor(
    session: EventEmitter,
    private readonly eventSink: (event: GraphEvent) => void,
    private readonly nodeId: string,
    initialTurnCount = 0,
  ) {
    this.turnCount = initialTurnCount;

    // ------------------------------------------------------------------
    // interim_transcript — partial STT result, forwarded but not buffered
    // ------------------------------------------------------------------
    session.on('interim_transcript', (evt: any) => {
      this.eventSink({
        type: 'voice_transcript',
        nodeId: this.nodeId,
        text: evt.text ?? '',
        isFinal: false,
        speaker: evt.speaker,
        confidence: evt.confidence ?? 0,
      });
    });

    // ------------------------------------------------------------------
    // final_transcript — confirmed utterance, buffered and forwarded
    // ------------------------------------------------------------------
    session.on('final_transcript', (evt: any) => {
      const speaker = evt.speaker ?? 'user';

      // Buffer the confirmed entry for downstream consumers.
      this.transcript.push({
        speaker,
        text: evt.text ?? '',
        timestamp: Date.now(),
      });

      // Track the most recent speaker for quick access without iterating the buffer.
      this.lastSpeaker = speaker;

      this.eventSink({
        type: 'voice_transcript',
        nodeId: this.nodeId,
        text: evt.text ?? '',
        isFinal: true,
        speaker,
        confidence: evt.confidence ?? 0,
      });
    });

    // ------------------------------------------------------------------
    // turn_complete — endpoint detection fired; advance the turn counter
    // ------------------------------------------------------------------
    session.on('turn_complete', (evt: any) => {
      // Increment before emitting so that turnIndex reflects the new count.
      this.turnCount++;

      this.eventSink({
        type: 'voice_turn_complete',
        nodeId: this.nodeId,
        transcript: evt.transcript ?? '',
        turnIndex: this.turnCount,
        endpointReason: evt.reason ?? 'unknown',
      });
    });

    // ------------------------------------------------------------------
    // barge_in — user interrupted agent mid-speech
    // ------------------------------------------------------------------
    session.on('barge_in', (evt: any) => {
      this.eventSink({
        type: 'voice_barge_in',
        nodeId: this.nodeId,
        interruptedText: evt.interruptedText ?? '',
        userSpeech: evt.userSpeech ?? '',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Returns the total number of completed turns since construction (or since the
   * provided `initialTurnCount` when restoring from a checkpoint).
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Returns a shallow copy of the buffered transcript entries.
   *
   * A copy is returned to prevent external callers from mutating the internal
   * buffer — entries are append-only and must remain ordered.
   */
  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  /**
   * Returns the speaker identifier from the most recent `final_transcript` event,
   * or an empty string if no final transcript has been received yet.
   */
  getLastSpeaker(): string {
    return this.lastSpeaker;
  }
}
