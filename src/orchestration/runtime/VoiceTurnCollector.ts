/**
 * @file VoiceTurnCollector.ts
 * @description Subscribes to voice pipeline session events and maintains a
 * running transcript buffer, turn counter, and last-speaker tracker.
 *
 * ## Event bridging strategy
 *
 * The collector bridges the raw EventEmitter-based voice pipeline session into
 * the typed `GraphEvent` stream consumed by the graph runtime. Four session
 * events are handled:
 *
 * | Session event        | GraphEvent emitted       | Buffered? | Why                                                    |
 * |----------------------|--------------------------|-----------|--------------------------------------------------------|
 * | `interim_transcript` | `voice_transcript`       | No        | Partials are noisy and would duplicate final entries.   |
 * | `final_transcript`   | `voice_transcript`       | Yes       | Confirmed utterances form the canonical transcript.     |
 * | `turn_complete`      | `voice_turn_complete`    | N/A       | Marks endpoint detection; advances the turn counter.    |
 * | `barge_in`           | `voice_barge_in`         | N/A       | Signals user interruption for downstream handlers.      |
 *
 * ## Checkpoint restore
 *
 * The `initialTurnCount` constructor parameter enables checkpoint restore:
 * pass the previously persisted count so that `turnIndex` values continue
 * from where the session left off rather than resetting to zero. This is
 * critical for `maxTurns` enforcement across graph suspensions.
 *
 * @see {@link VoiceNodeExecutor} -- creates and owns the collector during voice node execution.
 * @see {@link VoiceNodeCheckpoint} -- persists `turnIndex` and `transcript` across suspensions.
 */

import { EventEmitter } from 'events';
import type { GraphEvent } from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// TranscriptEntry
// ---------------------------------------------------------------------------

/**
 * A single confirmed (final) utterance captured from the voice pipeline.
 *
 * Only `final_transcript` events populate the transcript buffer -- interim
 * partials are discarded to keep the transcript clean and avoid duplicate
 * entries that would corrupt downstream summarisation.
 *
 * @example
 * ```ts
 * const entry: TranscriptEntry = {
 *   speaker: 'Speaker_0',
 *   text: 'Hello, how can I help you?',
 *   timestamp: Date.now(),
 * };
 * ```
 */
export interface TranscriptEntry {
  /**
   * Speaker identifier as reported by the STT service (e.g. `"Speaker_0"`).
   * Defaults to `"user"` when the STT service does not provide diarization labels.
   */
  speaker: string;

  /** Recognised text for this utterance. */
  text: string;

  /**
   * Wall-clock timestamp (milliseconds since Unix epoch) recorded at the
   * moment the `final_transcript` event was processed by the collector.
   *
   * This is the collector's receive time, not the STT service's recognition
   * time, so it includes any event loop latency between STT and the collector.
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
 * The collector is designed to be short-lived -- created at the start of a
 * voice node execution and discarded when the node completes. Its state
 * (transcript, turn count, last speaker) is captured into a
 * {@link VoiceNodeCheckpoint} by the executor before disposal.
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
 *
 * @see {@link TranscriptEntry} -- shape of each buffered transcript entry.
 * @see {@link VoiceNodeExecutor} -- the executor that creates and queries the collector.
 */
export class VoiceTurnCollector {
  /** Buffered confirmed utterances in chronological order. Append-only. */
  private transcript: TranscriptEntry[] = [];

  /** Running count of completed turns (endpoint-detected). */
  private turnCount: number;

  /**
   * Speaker identifier from the most recent `final_transcript` event.
   * Empty string until the first final transcript arrives.
   */
  private lastSpeaker = '';

  /**
   * Creates a new VoiceTurnCollector and immediately subscribes to session events.
   *
   * Subscription is performed in the constructor (rather than a separate `init()`
   * method) because the collector has no meaningful state before subscription and
   * there is no cleanup/unsubscribe lifecycle -- the session EventEmitter is
   * short-lived and garbage-collected with the collector.
   *
   * @param session          - The voice pipeline `EventEmitter` to subscribe to.
   *                           Must emit `interim_transcript`, `final_transcript`,
   *                           `turn_complete`, and `barge_in` events.
   * @param eventSink        - Callback invoked synchronously for every emitted
   *                           `GraphEvent`. Must not throw -- exceptions would
   *                           propagate into the session event loop.
   * @param nodeId           - Identifies the owning graph node in every emitted
   *                           event, enabling consumers to filter events by node.
   * @param initialTurnCount - Seed value for `turnCount`; pass a persisted value
   *                           to resume from a checkpoint rather than starting at
   *                           zero. Defaults to `0`.
   */
  constructor(
    session: EventEmitter,
    private readonly eventSink: (event: GraphEvent) => void,
    private readonly nodeId: string,
    initialTurnCount = 0,
  ) {
    this.turnCount = initialTurnCount;

    // ------------------------------------------------------------------
    // interim_transcript -- partial STT result, forwarded but NOT buffered.
    //
    // Why not buffer? Interim transcripts are speculative and frequently
    // revised by the STT engine. Buffering them would produce duplicate
    // or contradictory entries. They are forwarded as events so that UIs
    // can show live typing indicators.
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
    // final_transcript -- confirmed utterance, buffered AND forwarded.
    //
    // This is the canonical source of truth for what was said. Every
    // confirmed utterance is appended to the transcript buffer and the
    // last-speaker tracker is updated.
    // ------------------------------------------------------------------
    session.on('final_transcript', (evt: any) => {
      // Default speaker to 'user' when the STT service doesn't provide
      // diarization labels. This matches the most common single-speaker
      // scenario where the only speaker is the human user.
      const speaker = evt.speaker ?? 'user';

      // Buffer the confirmed entry for downstream consumers (checkpoint,
      // summarisation, analytics).
      this.transcript.push({
        speaker,
        text: evt.text ?? '',
        timestamp: Date.now(),
      });

      // Track the most recent speaker for quick access without iterating
      // the entire buffer. Used by the executor to populate the result.
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
    // turn_complete -- endpoint detection fired; advance the turn counter.
    //
    // The counter is incremented BEFORE emitting the event so that the
    // turnIndex in the emitted event reflects the new (post-increment)
    // count. This matches the semantics expected by VoiceNodeExecutor's
    // maxTurns check, which reads getTurnCount() after the event fires.
    // ------------------------------------------------------------------
    session.on('turn_complete', (evt: any) => {
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
    // barge_in -- user interrupted agent mid-speech.
    //
    // This event does not affect the turn count or transcript buffer
    // because the interruption itself is not a complete utterance. The
    // interrupted text (what the agent was saying) and the user's speech
    // (what triggered the interruption) are forwarded for downstream
    // handlers to process.
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
   *
   * @returns The current turn count. Always >= `initialTurnCount`.
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Returns a shallow copy of the buffered transcript entries.
   *
   * A copy is returned to prevent external callers from mutating the internal
   * buffer -- entries are append-only and must remain in chronological order
   * for correct checkpoint persistence.
   *
   * @returns A new array containing all confirmed transcript entries in order.
   */
  getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  /**
   * Returns the speaker identifier from the most recent `final_transcript` event,
   * or an empty string if no final transcript has been received yet.
   *
   * @returns The last speaker label, or `''` if none.
   */
  getLastSpeaker(): string {
    return this.lastSpeaker;
  }
}
