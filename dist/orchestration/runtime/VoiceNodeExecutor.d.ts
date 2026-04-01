/**
 * @file VoiceNodeExecutor.ts
 * @description Executes voice nodes in the orchestration graph by managing a voice
 * pipeline session, collecting turns via `VoiceTurnCollector`, and racing
 * multiple exit conditions (hangup, turns exhausted, keyword, silence timeout,
 * barge-in abort) to determine when the voice node completes.
 *
 * ## Design rationale
 *
 * The executor follows the standard 2-arg `execute(node, state)` contract used by
 * {@link NodeExecutor}. Internally it creates an `AbortController` for barge-in
 * support and optionally merges a parent abort signal from `state.scratch.abortSignal`.
 *
 * Exit conditions are modelled as a **single `Promise.race`** rather than a state
 * machine because the conditions are orthogonal and any one of them can fire at any
 * time. The `settled` flag inside {@link raceExitConditions} guards against
 * double-resolution when two conditions fire within the same microtask.
 *
 * ## State contract
 *
 * Voice transport and session references are expected in `state.scratch`:
 * - `voiceTransport` -- the bidirectional transport EventEmitter (emits `close` / `disconnected`).
 * - `voiceTransport._voiceSession` -- the voice pipeline session EventEmitter that fires
 *   `final_transcript`, `turn_complete`, `speech_start`, and `barge_in` events.
 *
 * Checkpoint data is stored in `state.scratch[nodeId]` as a {@link VoiceNodeCheckpoint},
 * enabling the graph runtime to resume a voice session from the exact turn index where
 * it was previously suspended.
 *
 * See `VoiceTurnCollector` for transcript buffering and event bridging.
 * See `VoiceTransportAdapter` for how graph I/O is wrapped at the transport level.
 * @see {@link VoiceInterruptError} for the structured barge-in error type.
 */
import type { GraphNode, GraphState, VoiceNodeConfig } from '../ir/types.js';
import type { GraphEvent } from '../events/GraphEvent.js';
import type { NodeExecutionResult } from './NodeExecutor.js';
/**
 * Checkpoint data stored in `state.scratch[nodeId]` after a voice node completes.
 *
 * The graph runtime persists this structure so that a subsequent invocation of the
 * same voice node (e.g. after a graph loop or checkpoint restore) can continue the
 * conversation from `turnIndex` rather than resetting to zero.
 *
 * @example
 * ```ts
 * // Restoring from a checkpoint:
 * const checkpoint = state.scratch['voice-1'] as VoiceNodeCheckpoint;
 * const resumedTurnIndex = checkpoint.turnIndex; // e.g. 5
 * ```
 */
export interface VoiceNodeCheckpoint {
    /** Number of turns completed when the checkpoint was captured. */
    turnIndex: number;
    /**
     * Full transcript buffer at the time of checkpoint.
     *
     * Each entry records a confirmed (final) utterance with its speaker label
     * and wall-clock timestamp, preserving the full conversation history for
     * downstream summarisation or analytics.
     */
    transcript: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    /**
     * Exit reason that caused the voice node to complete.
     * `null` when the checkpoint was captured mid-session (e.g. process crash).
     */
    lastExitReason: string | null;
    /**
     * Maps diarization speaker labels to human-readable names.
     * Reserved for future use -- populated as an empty object today.
     */
    speakerMap: Record<string, string>;
    /**
     * The voice config that was active when this checkpoint was created.
     * Stored so that a resumed session can verify config compatibility before
     * continuing from the persisted turn index.
     */
    sessionConfig: VoiceNodeConfig;
}
/**
 * Executes voice-type graph nodes by running a voice pipeline session and racing
 * multiple exit conditions to determine when the node is done.
 *
 * Exit conditions are evaluated concurrently via a single `Promise` race:
 * - **Hangup** -- transport emits `close` or `disconnected`.
 * - **Turns exhausted** -- session emits `turn_complete` and the collector's count
 *   reaches `config.maxTurns`.
 * - **Keyword** -- a `final_transcript` event contains one of `config.exitKeywords`.
 * - **Silence timeout** -- no speech activity for 30 seconds (when `exitOn: 'silence-timeout'`).
 * - **Abort/barge-in** -- the internal `AbortController` is signalled, either by a
 *   parent abort signal or a `VoiceInterruptError`.
 *
 * @example
 * ```ts
 * const executor = new VoiceNodeExecutor((event) => emitter.emit(event));
 * const result = await executor.execute(voiceNode, graphState);
 * console.log(result.output.exitReason);
 * // 'turns-exhausted' | 'hangup' | 'keyword:goodbye' | 'silence-timeout' | 'interrupted'
 * ```
 *
 * See `VoiceTurnCollector` for session subscription and transcript buffering.
 * @see {@link VoiceInterruptError} -- structured barge-in error that triggers the `interrupted` path.
 */
export declare class VoiceNodeExecutor {
    private readonly eventSink;
    /**
     * Creates a new VoiceNodeExecutor.
     *
     * @param eventSink - Callback invoked synchronously for every emitted {@link GraphEvent}.
     *                     Typically bound to the graph runtime's event emitter so that
     *                     voice lifecycle events (`voice_session`, `voice_transcript`, etc.)
     *                     are visible to all graph event consumers.
     */
    constructor(eventSink: (event: GraphEvent) => void);
    /**
     * Execute a voice node. Matches the standard 2-arg `execute(node, state)` signature
     * used throughout the orchestration runtime.
     *
     * ## Lifecycle
     *
     * 1. Validates that `node.executorConfig.type` is `'voice'`.
     * 2. Creates an internal `AbortController` for barge-in, wiring it to any parent
     *    abort signal in `state.scratch.abortSignal`.
     * 3. Extracts the `voiceTransport` from `state.scratch` (must be pre-placed by
     *    the graph runtime or `VoiceTransportAdapter`).
     * 4. Checks for a {@link VoiceNodeCheckpoint} to resume from.
     * 5. Emits a `voice_session` started event.
     * 6. Wires a `VoiceTurnCollector` onto the session and races exit conditions.
     * 7. Resolves the exit reason to a route target via the node's edge map.
     * 8. Returns a {@link NodeExecutionResult} with transcript, exit reason, checkpoint,
     *    and optional route target.
     *
     * @param node  - Immutable voice node descriptor from the compiled graph IR.
     *                Must have `executorConfig.type === 'voice'`.
     * @param state - Current (partial) graph state threaded from the runtime.
     *                Must contain `scratch.voiceTransport` for the voice session.
     * @returns A {@link NodeExecutionResult} with transcript, exit reason, and optional route target.
     *          On success, `output` contains `{ transcript, turns, exitReason, lastSpeaker, interruptedText }`.
     *          `scratchUpdate` carries the {@link VoiceNodeCheckpoint} keyed by node id.
     * @throws Never -- all errors are caught and returned as `{ success: false, error }`.
     *         {@link VoiceInterruptError} is caught and mapped to `exitReason: 'interrupted'`.
     *
     * @see {@link raceExitConditions} for the concurrent exit condition implementation.
     */
    execute(node: GraphNode, state: Partial<GraphState>): Promise<NodeExecutionResult>;
    /**
     * Races all configured exit conditions against each other and resolves with
     * the first one that fires.
     *
     * ## How it works
     *
     * Each exit condition is wired as a listener on either the `session` or
     * `transport` EventEmitter. All listeners call a shared `settleWith()` helper
     * that resolves the outer Promise exactly once (guarded by a `settled` boolean).
     *
     * The `AbortController` signal is also monitored -- if it fires with a
     * {@link VoiceInterruptError} the Promise rejects (handled by the caller's
     * catch block), otherwise it resolves with `{ reason: 'interrupted' }`.
     *
     * ## Why a Promise race instead of a state machine?
     *
     * The exit conditions are independent and asynchronous. A Promise-based race
     * avoids complex state transitions and lets each condition be a simple
     * event listener. The `settled` guard handles the only tricky case: two
     * conditions firing in the same microtask.
     *
     * @param session    - Voice pipeline session EventEmitter that fires
     *                     `turn_complete`, `final_transcript`, `speech_start`, `barge_in`.
     * @param collector  - Active turn collector tracking turn count and transcript.
     * @param config     - Voice node configuration with exit settings (`maxTurns`,
     *                     `exitOn`, `exitKeywords`).
     * @param controller - Internal AbortController for barge-in signalling.
     * @param transport  - Bidirectional transport EventEmitter that fires `close`
     *                     and `disconnected` on hangup.
     * @returns The winning exit condition's reason string and optional interrupted text.
     */
    private raceExitConditions;
}
//# sourceMappingURL=VoiceNodeExecutor.d.ts.map