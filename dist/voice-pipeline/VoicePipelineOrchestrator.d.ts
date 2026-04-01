/**
 * @module voice-pipeline/VoicePipelineOrchestrator
 *
 * Central state machine that wires together transport, STT, endpoint detection,
 * TTS, barge-in handling, and the agent session into a coordinated real-time
 * voice conversation loop.
 *
 * ## State transitions
 *
 * ```
 * IDLE -----> startSession() ---------> LISTENING
 * LISTENING -> turn_complete ----------> PROCESSING
 * PROCESSING -> LLM tokens start -----> SPEAKING
 * SPEAKING --> TTS flush_complete -----> LISTENING
 * SPEAKING --> barge-in (cancel) ------> INTERRUPTING -> LISTENING
 * ANY ------> transport disconnect ----> CLOSED
 * ANY ------> stopSession() -----------> CLOSED
 * ```
 *
 * ## Design notes
 *
 * - The orchestrator does NOT resolve providers from ExtensionManager yet.
 *   All components must be injected via {@link VoicePipelineOverrides}.
 *   ExtensionManager integration is a planned future task.
 * - Event wiring is done once during `startSession()` and never rewired.
 *   The transport/STT/TTS sessions are immutable for the session's lifetime.
 * - A watchdog timer prevents the pipeline from staying in LISTENING forever
 *   if the user walks away (default 30 s). The watchdog resets after each
 *   completed turn.
 */
import { EventEmitter } from 'node:events';
import type { IBargeinHandler, IDiarizationEngine, IEndpointDetector, IStreamTransport, IStreamingSTT, IStreamingTTS, IVoicePipelineAgentSession, PipelineState, TurnCompleteEvent, VoicePipelineConfig, VoicePipelineSession } from './types.js';
/**
 * Overrides for injecting pre-built components, primarily for unit testing.
 * In production, components would be resolved from ExtensionManager by
 * provider ID (a planned future enhancement).
 *
 * See `VoicePipelineOrchestrator.startSession()` for the method that accepts these overrides.
 *
 * @example
 * ```typescript
 * const overrides: VoicePipelineOverrides = {
 *   streamingSTT: myDeepgramSTT,
 *   streamingTTS: myOpenAITTS,
 *   endpointDetector: new HeuristicEndpointDetector(),
 *   bargeinHandler: new HardCutBargeinHandler(),
 * };
 * ```
 */
export interface VoicePipelineOverrides {
    /** Pre-built streaming STT provider (bypasses ExtensionManager resolution). */
    streamingSTT?: IStreamingSTT;
    /** Pre-built streaming TTS provider (bypasses ExtensionManager resolution). */
    streamingTTS?: IStreamingTTS;
    /** Pre-built endpoint detector instance. */
    endpointDetector?: IEndpointDetector;
    /** Pre-built barge-in handler instance. */
    bargeinHandler?: IBargeinHandler;
    /** Pre-built diarization engine (optional; only needed for multi-speaker). */
    diarizationEngine?: IDiarizationEngine;
}
/**
 * VoicePipelineOrchestrator is the central state machine for the AgentOS
 * streaming voice pipeline. It coordinates audio capture, speech recognition,
 * endpoint detection, agent inference, text-to-speech synthesis, and barge-in
 * handling into a seamless real-time conversation loop.
 *
 * ## Events emitted
 *
 * | Event             | Payload                                      |
 * |-------------------|----------------------------------------------|
 * | `'state_changed'` | `{ from: PipelineState, to: PipelineState }`  |
 * | `'turn_complete'` | {@link TurnCompleteEvent}                     |
 *
 * @see {@link VoicePipelineSession} for the public session interface returned by `startSession()`.
 */
export declare class VoicePipelineOrchestrator extends EventEmitter {
    private readonly config;
    /** Current pipeline state. Transitions are managed exclusively by the internal state setter. */
    private _state;
    /** Active STT session created during `startSession()`. Null when idle or closed. */
    private _sttSession;
    /** Active TTS session created during `startSession()`. Null when idle or closed. */
    private _ttsSession;
    /** The endpoint detector wired during `startSession()`. Null when idle or closed. */
    private _endpointDetector;
    /** The barge-in handler consulted when speech is detected during SPEAKING. Null when idle or closed. */
    private _bargeinHandler;
    /** The transport bound to this session. Null when idle or closed. */
    private _transport;
    /** The agent session adapter for turn-based conversation. Null when idle or closed. */
    private _agentSession;
    /**
     * Watchdog timer ID for max turn duration. Fires a synthetic speech_end
     * VAD event if the pipeline stays in LISTENING too long without a turn_complete.
     */
    private _watchdogTimer;
    /**
     * Tracks cumulative TTS text for barge-in context. Reset at the start
     * of each agent response (PROCESSING -> SPEAKING transition).
     */
    private _currentTTSText;
    /**
     * Tracks cumulative played duration (ms) for barge-in context.
     * Incremented as each {@link EncodedAudioChunk} is forwarded to the transport.
     */
    private _currentPlayedMs;
    /**
     * Current pipeline state (read-only).
     *
     * @example
     * ```typescript
     * if (orchestrator.state === 'listening') {
     *   console.log('Waiting for user input...');
     * }
     * ```
     */
    get state(): PipelineState;
    /**
     * Create a new orchestrator with the given pipeline configuration.
     *
     * The orchestrator starts in `'idle'` state. Call `startSession()`
     * to wire up components and transition to `'listening'`.
     *
     * @param config - Top-level pipeline configuration specifying providers and options.
     */
    constructor(config: VoicePipelineConfig);
    /**
     * Start a voice session. Accepts pre-built components via overrides for testing.
     * In production, components would be resolved from ExtensionManager (future task).
     *
     * This method:
     * 1. Validates the orchestrator is in `'idle'` state.
     * 2. Creates STT and TTS sub-sessions from the provided factories.
     * 3. Wires all event handlers (transport -> STT -> endpoint -> agent -> TTS -> transport).
     * 4. Transitions to `'listening'` and starts the watchdog timer.
     * 5. Returns a {@link VoicePipelineSession} handle.
     *
     * @param transport - The bidirectional audio/text stream transport.
     * @param agentSession - The agent session adapter for turn-based conversation.
     * @param overrides - Optional pre-built components (for testing or manual wiring).
     * @returns A live VoicePipelineSession object.
     *
     * @throws {Error} If the orchestrator is not in `'idle'` state.
     * @throws {Error} If any required component (STT, TTS, endpoint, bargein) is missing.
     */
    startSession(transport: IStreamTransport, agentSession: IVoicePipelineAgentSession, overrides?: VoicePipelineOverrides): Promise<VoicePipelineSession>;
    /**
     * Stop the current session, tearing down all sub-sessions and timers.
     *
     * Safe to call multiple times -- subsequent calls after the first are no-ops.
     *
     * @param reason - Optional human-readable reason for diagnostics.
     */
    stopSession(reason?: string): Promise<void>;
    /**
     * Wait for the next user turn to complete.
     *
     * Wraps the internal `'turn_complete'` event in a one-shot Promise so that
     * graph nodes (via VoiceTransportAdapter) can `await` user input without
     * having to manage raw EventEmitter subscriptions themselves.
     *
     * Resolves with the first {@link TurnCompleteEvent} fired after this call.
     * If the session is closed before a turn completes, the Promise will never
     * resolve -- callers should race it against a session-close signal if needed.
     *
     * @returns A Promise that resolves with the completed turn event.
     *
     * @example
     * ```typescript
     * const turn = await orchestrator.waitForUserTurn();
     * console.log('User said:', turn.transcript);
     * console.log('Reason:', turn.reason);
     * ```
     */
    waitForUserTurn(): Promise<TurnCompleteEvent>;
    /**
     * Push text to the active TTS session.
     *
     * Accepts either a plain string or an `AsyncIterable<string>` of token chunks
     * (e.g. a streaming LLM response). Calls `pushTokens()` on the active TTS
     * session for each token, then calls `flush()` to signal end-of-utterance.
     *
     * Used by VoiceTransportAdapter to deliver graph node output as speech
     * without the caller needing a direct reference to the TTS session.
     *
     * @param text - A complete string, or an async iterable of string tokens.
     *
     * @throws {Error} If there is no active TTS session (i.e. session not started
     *   or already stopped).
     *
     * @example
     * ```typescript
     * // Plain string
     * await orchestrator.pushToTTS('Hello, how can I help?');
     *
     * // Streaming tokens from an LLM
     * await orchestrator.pushToTTS(llm.streamTokens(prompt));
     * ```
     */
    pushToTTS(text: string | AsyncIterable<string>): Promise<void>;
    /**
     * Wire segment 1: Transport -> STT.
     *
     * Every inbound audio frame from the transport is forwarded directly to
     * the STT session for recognition. No buffering or resampling is done here;
     * the STT provider is expected to handle sample rate conversion internally.
     *
     * @param transport - The bidirectional transport receiving client audio.
     * @param sttSession - The STT session that will process the audio.
     */
    private _wireTransportToSTT;
    /**
     * Wire segment 2: STT -> Endpoint Detector + Transport.
     *
     * Every transcript event from STT is:
     * 1. Forwarded to the endpoint detector for turn-boundary analysis.
     * 2. Relayed to the transport so the client can display real-time captions.
     *
     * @param sttSession - The STT session emitting transcript events.
     * @param endpointDetector - The detector analysing transcripts for turn boundaries.
     * @param transport - The transport for relaying transcript events to the client.
     */
    private _wireSTTToEndpoint;
    /**
     * Wire segment 3: Endpoint Detector -> Agent -> TTS.
     *
     * When the endpoint detector fires `turn_complete`, the orchestrator:
     * 1. Transitions LISTENING -> PROCESSING.
     * 2. Sends the transcript to the agent session.
     * 3. Transitions PROCESSING -> SPEAKING as LLM tokens start arriving.
     * 4. Pipes each token to the TTS session.
     *
     * The turn is only processed if the orchestrator is currently in LISTENING
     * state, preventing duplicate processing from stale events.
     *
     * @param endpointDetector - The detector that fires turn_complete events.
     * @param transport - For sending agent_thinking/agent_speaking control messages.
     * @param agentSession - The agent session that generates the response.
     * @param ttsSession - The TTS session that synthesises the response as audio.
     */
    private _wireTurnComplete;
    /**
     * Wire segment 4: TTS -> Transport.
     *
     * Each audio chunk from TTS is forwarded to the transport for client playback.
     * The `flush_complete` event signals that all tokens have been synthesised,
     * triggering the SPEAKING -> LISTENING transition.
     *
     * @param ttsSession - The TTS session emitting audio chunks.
     * @param transport - The transport delivering audio to the client.
     */
    private _wireTTSToTransport;
    /**
     * Wire segment 5: Barge-in detection.
     *
     * When `speech_start` is detected (from the STT session) during the SPEAKING
     * state, the barge-in handler is consulted. Depending on the handler's
     * decision:
     *
     * - **cancel**: TTS is stopped, agent is aborted, state goes
     *   SPEAKING -> INTERRUPTING -> LISTENING.
     * - **pause**: A control message is sent but state remains SPEAKING.
     * - **ignore**: No action taken (e.g. lip smack below threshold).
     *
     * The `speech_start` and `speech_end` events are also forwarded to the
     * endpoint detector as synthetic VAD events so it can track speech activity
     * even when a dedicated VAD model is not present.
     *
     * @param sttSession - The STT session that re-emits speech_start/speech_end.
     * @param ttsSession - The TTS session to cancel on barge-in.
     * @param bargeinHandler - The policy handler deciding what to do.
     * @param transport - For sending barge_in control messages.
     * @param agentSession - The agent session to abort on cancel.
     */
    private _wireBargein;
    /**
     * Wire segment 6: Transport disconnect.
     *
     * When the transport closes (e.g. WebSocket disconnect, client navigation),
     * all sub-sessions are torn down and the orchestrator transitions to CLOSED.
     * This is a terminal state -- no further events are emitted.
     *
     * @param transport - The transport to monitor for closure.
     * @param sttSession - The STT session to close on disconnect.
     * @param ttsSession - The TTS session to close on disconnect.
     */
    private _wireDisconnect;
    /**
     * Transition to a new pipeline state, emitting a `'state_changed'` event.
     *
     * No-ops if the target state equals the current state (idempotent).
     * This is the ONLY method that mutates the internal `_state`, ensuring all
     * transitions are observable via the `'state_changed'` event.
     *
     * @param state - The target pipeline state.
     */
    private _setState;
    /**
     * Reset the watchdog timer for max turn duration.
     *
     * If the pipeline stays in LISTENING for longer than
     * {@link VoicePipelineConfig.maxTurnDurationMs} (default 30 s) without a
     * `turn_complete`, the watchdog fires a synthetic `speech_end` VAD event
     * to trigger the endpoint detector's silence timeout logic. This prevents
     * the pipeline from hanging indefinitely when the user walks away or
     * the microphone captures no meaningful audio.
     */
    private _resetWatchdog;
    /**
     * Clear the watchdog timer if one is active.
     * Safe to call even when no timer is pending (no-op).
     */
    private _clearWatchdog;
}
//# sourceMappingURL=VoicePipelineOrchestrator.d.ts.map