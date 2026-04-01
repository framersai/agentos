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
 * See `VoiceNodeExecutor` for the owner of this collector during voice node execution.
 * @see {@link VoiceNodeCheckpoint} -- persists `turnIndex` and `transcript` across suspensions.
 */
import { EventEmitter } from 'events';
import type { GraphEvent } from '../events/GraphEvent.js';
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
 * See `VoiceNodeExecutor` for the executor that creates and queries the collector.
 */
export declare class VoiceTurnCollector {
    private readonly eventSink;
    private readonly nodeId;
    /** Buffered confirmed utterances in chronological order. Append-only. */
    private transcript;
    /** Running count of completed turns (endpoint-detected). */
    private turnCount;
    /**
     * Speaker identifier from the most recent `final_transcript` event.
     * Empty string until the first final transcript arrives.
     */
    private lastSpeaker;
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
    constructor(session: EventEmitter, eventSink: (event: GraphEvent) => void, nodeId: string, initialTurnCount?: number);
    /**
     * Returns the total number of completed turns since construction (or since the
     * provided `initialTurnCount` when restoring from a checkpoint).
     *
     * @returns The current turn count. Always >= `initialTurnCount`.
     */
    getTurnCount(): number;
    /**
     * Returns a shallow copy of the buffered transcript entries.
     *
     * A copy is returned to prevent external callers from mutating the internal
     * buffer -- entries are append-only and must remain in chronological order
     * for correct checkpoint persistence.
     *
     * @returns A new array containing all confirmed transcript entries in order.
     */
    getTranscript(): TranscriptEntry[];
    /**
     * Returns the speaker identifier from the most recent `final_transcript` event,
     * or an empty string if no final transcript has been received yet.
     *
     * @returns The last speaker label, or `''` if none.
     */
    getLastSpeaker(): string;
}
//# sourceMappingURL=VoiceTurnCollector.d.ts.map