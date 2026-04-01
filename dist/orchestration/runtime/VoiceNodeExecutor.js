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
import { EventEmitter } from 'events';
import { VoiceTurnCollector } from './VoiceTurnCollector.js';
import { VoiceInterruptError } from '../../voice-pipeline/VoiceInterruptError.js';
// ---------------------------------------------------------------------------
// VoiceNodeExecutor
// ---------------------------------------------------------------------------
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
export class VoiceNodeExecutor {
    /**
     * Creates a new VoiceNodeExecutor.
     *
     * @param eventSink - Callback invoked synchronously for every emitted {@link GraphEvent}.
     *                     Typically bound to the graph runtime's event emitter so that
     *                     voice lifecycle events (`voice_session`, `voice_transcript`, etc.)
     *                     are visible to all graph event consumers.
     */
    constructor(eventSink) {
        this.eventSink = eventSink;
    }
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
    async execute(node, state) {
        const config = node.executorConfig;
        // Guard: only voice nodes should reach this executor.
        if (config.type !== 'voice') {
            return { success: false, error: 'VoiceNodeExecutor received non-voice node' };
        }
        const voiceConfig = config.voiceConfig;
        // Create an internal AbortController so barge-in events or parent cancellation
        // can terminate the exit condition race without waiting for a session event.
        const controller = new AbortController();
        // If a parent abort signal exists in scratch (e.g. from a graph-level timeout
        // or manual cancellation), forward its abort to our internal controller so that
        // the voice session is cancelled when the parent cancels.
        const parentSignal = state?.scratch?.abortSignal;
        if (parentSignal) {
            parentSignal.addEventListener('abort', () => controller.abort(parentSignal.reason), {
                once: true,
            });
        }
        // The voice transport must be pre-placed in state.scratch by the graph runtime
        // or VoiceTransportAdapter before executing a voice node. Without it we cannot
        // receive session events or detect hangup.
        const transport = state?.scratch?.voiceTransport;
        if (!transport) {
            return { success: false, error: 'Voice node requires voiceTransport in state.scratch' };
        }
        // Check for checkpoint restore -- if the node was previously executed and the
        // graph was suspended/restored, the prior turn count is in the checkpoint.
        // This lets the turn counter continue from where it left off rather than
        // resetting to zero, which would cause premature exits on maxTurns.
        const checkpoint = state?.scratch?.[node.id];
        const initialTurnCount = checkpoint?.turnIndex ?? 0;
        // Signal that the voice session is now active for this node.
        this.eventSink({ type: 'voice_session', nodeId: node.id, action: 'started' });
        try {
            // The voice session EventEmitter is expected on transport._voiceSession.
            // In production this is the VoicePipelineSession; in tests it can be a
            // plain EventEmitter. Fallback to a fresh emitter avoids null dereferences
            // when the transport doesn't have an attached session.
            const session = transport._voiceSession ?? new EventEmitter();
            // Create the turn collector -- it subscribes to session events (interim_transcript,
            // final_transcript, turn_complete, barge_in) and bridges them into GraphEvents
            // while maintaining a running transcript buffer and turn counter.
            const collector = new VoiceTurnCollector(session, this.eventSink, node.id, initialTurnCount);
            // Race all exit conditions against each other. The first condition to fire
            // determines exitReason and ends the voice node.
            const result = await this.raceExitConditions(session, collector, voiceConfig, controller, transport);
            // Map the exitReason string to a target node id using the edge map.
            // This is how voice nodes implement conditional routing: different exit
            // conditions route to different downstream nodes.
            const edges = node.edges ?? {};
            const routeTarget = typeof edges === 'object' ? edges[result.reason] : undefined;
            // Build the checkpoint so the runtime can persist and restore later.
            // This is written into scratchUpdate and merged back into state.scratch
            // by the graph runtime after execution completes.
            const voiceCheckpoint = {
                turnIndex: collector.getTurnCount(),
                transcript: collector.getTranscript(),
                lastExitReason: result.reason,
                speakerMap: {},
                sessionConfig: voiceConfig,
            };
            // Signal that the voice session has ended for this node.
            this.eventSink({
                type: 'voice_session',
                nodeId: node.id,
                action: 'ended',
                exitReason: result.reason,
            });
            return {
                success: true,
                output: {
                    transcript: collector.getTranscript(),
                    turns: collector.getTurnCount(),
                    exitReason: result.reason,
                    lastSpeaker: collector.getLastSpeaker(),
                    interruptedText: result.interruptedText,
                },
                routeTarget,
                scratchUpdate: { [node.id]: voiceCheckpoint },
            };
        }
        catch (err) {
            // VoiceInterruptError is a structured barge-in -- the user spoke over the
            // agent. This is not an error condition; it's a valid exit path that the
            // graph should be able to route on. We convert it to a successful result
            // with exitReason: 'interrupted' so edge routing works as expected.
            if (err instanceof VoiceInterruptError) {
                const edges = node.edges ?? {};
                const routeTarget = edges['interrupted'];
                this.eventSink({
                    type: 'voice_session',
                    nodeId: node.id,
                    action: 'ended',
                    exitReason: 'interrupted',
                });
                return {
                    success: true,
                    output: {
                        transcript: [],
                        turns: 0,
                        exitReason: 'interrupted',
                        interruptedText: err.interruptedText,
                        userSpeech: err.userSpeech,
                    },
                    routeTarget,
                };
            }
            // Unhandled error -- surface as a failed result so the graph runtime can
            // decide whether to retry, reroute, or halt.
            this.eventSink({
                type: 'voice_session',
                nodeId: node.id,
                action: 'ended',
                exitReason: 'error',
            });
            return { success: false, error: String(err) };
        }
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
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
    async raceExitConditions(session, collector, config, controller, transport) {
        return new Promise((resolve, reject) => {
            /** Prevents double-resolution when multiple conditions fire simultaneously. */
            let settled = false;
            /**
             * Settle the promise with a resolve value, guarding against double-settle.
             * Every exit condition calls this instead of `resolve()` directly.
             *
             * @param result - The exit condition result containing the reason string.
             */
            const settleWith = (result) => {
                if (settled)
                    return;
                settled = true;
                resolve(result);
            };
            // -- Hangup: transport disconnects -----------------------------------
            // Both `close` and `disconnected` events indicate the transport is gone.
            // We listen for both because different transport implementations emit
            // different event names (WebSocket uses `close`, telephony uses `disconnected`).
            const onDisconnect = () => settleWith({ reason: 'hangup' });
            transport.on('close', onDisconnect);
            transport.on('disconnected', onDisconnect);
            // -- Turns exhausted -------------------------------------------------
            // Only armed when maxTurns is a positive number. We check the collector's
            // count (not a local counter) because the collector may have been seeded
            // with an initialTurnCount from a checkpoint restore.
            if (config.maxTurns && config.maxTurns > 0) {
                session.on('turn_complete', () => {
                    if (collector.getTurnCount() >= config.maxTurns) {
                        settleWith({ reason: 'turns-exhausted' });
                    }
                });
            }
            // -- Keyword detection -----------------------------------------------
            // Only armed when exitOn is 'keyword' and at least one keyword is provided.
            // The keyword check is case-insensitive and uses substring matching so that
            // "goodbye" matches "okay goodbye then".
            if (config.exitOn === 'keyword' && config.exitKeywords?.length) {
                session.on('final_transcript', (evt) => {
                    const text = (evt.text ?? '').toLowerCase();
                    for (const kw of config.exitKeywords) {
                        if (text.includes(kw.toLowerCase())) {
                            settleWith({ reason: `keyword:${kw}` });
                            return;
                        }
                    }
                });
            }
            // -- Silence timeout (default 30 s) ----------------------------------
            // Only armed when exitOn is 'silence-timeout'. A watchdog timer is reset
            // on every speech activity event. If the timer fires without being reset,
            // the user has been silent for too long and the session ends.
            if (config.exitOn === 'silence-timeout') {
                let silenceTimer = null;
                const timeoutMs = 30000;
                /** Reset the silence watchdog -- called on any speech activity. */
                const resetTimer = () => {
                    if (silenceTimer)
                        clearTimeout(silenceTimer);
                    silenceTimer = setTimeout(() => settleWith({ reason: 'silence-timeout' }), timeoutMs);
                };
                // Reset on both speech_start (user began talking) and turn_complete
                // (user finished a turn) to cover all speech activity signals.
                session.on('speech_start', resetTimer);
                session.on('turn_complete', resetTimer);
                resetTimer(); // Start the initial timer immediately.
            }
            // -- Abort signal (barge-in or parent cancellation) ------------------
            // If the abort reason is a VoiceInterruptError, we reject the Promise
            // (the caller's catch block converts it to exitReason: 'interrupted').
            // For any other abort reason (e.g. parent timeout), we resolve normally
            // with reason: 'interrupted'.
            controller.signal.addEventListener('abort', () => {
                const reason = controller.signal.reason;
                if (reason instanceof VoiceInterruptError) {
                    reject(reason);
                }
                else {
                    settleWith({ reason: 'interrupted' });
                }
            }, { once: true });
        });
    }
}
//# sourceMappingURL=VoiceNodeExecutor.js.map