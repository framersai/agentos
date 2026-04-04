/**
 * @file VoiceTransportAdapter.ts
 * @description Bridges graph I/O to the voice pipeline when a workflow runs in
 * voice transport mode.
 *
 * ## Purpose
 *
 * `VoiceTransportAdapter` wraps a graph's input/output cycle so that:
 * - **Node input** is obtained by waiting for the user's next speech turn
 *   (`waitForUserTurn()` on the underlying `VoicePipelineOrchestrator`).
 * - **Node output** is delivered to the TTS engine (`pushToTTS()` on the
 *   underlying `VoicePipelineOrchestrator`).
 *
 * ## `getNodeInput` / `deliverNodeOutput` contract
 *
 * - `getNodeInput(nodeId)` delegates to `pipeline.waitForUserTurn()` when a
 *   pipeline is available, or falls back to listening for `turn_complete` on
 *   the transport directly.
 * - `deliverNodeOutput(nodeId, output)` delegates to `pipeline.pushToTTS()`
 *   and emits a `voice_audio` outbound GraphEvent.
 * - Both methods throw if called before `init()`.
 *
 * ## Lazy initialisation
 *
 * The adapter is lazy -- it does not create a `VoicePipelineOrchestrator` until
 * `init()` is called. The pipeline reference is `any` typed to avoid a hard
 * import cycle with the voice subsystem; callers that want stronger types may cast.
 *
 * @example
 * ```typescript
 * const adapter = new VoiceTransportAdapter(
 *   { stt: 'deepgram', tts: 'openai' },
 *   transport,
 *   (event) => eventBus.emit(event),
 * );
 *
 * await adapter.init(state);
 * const userInput = await adapter.getNodeInput('greet');
 * await adapter.deliverNodeOutput('greet', 'Hello, how can I help you today?');
 * await adapter.dispose();
 * ```
 *
 * See `VoiceNodeExecutor` for the executor that consumes this adapter's events.
 * @see {@link VoiceTransportConfig} -- configuration knobs forwarded to the pipeline.
 */
import type { GraphState } from '../ir/types.js';
import type { GraphEvent } from '../events/GraphEvent.js';
/**
 * Configuration knobs forwarded to the voice pipeline when the adapter
 * initialises its internal `VoicePipelineOrchestrator` instance.
 *
 * All fields are optional -- defaults are resolved from agent.config.json or
 * sensible library defaults within the voice pipeline itself.
 */
export interface VoiceTransportConfig {
    /** STT provider identifier (e.g. `'deepgram'`, `'openai'`). */
    stt?: string;
    /** TTS provider identifier (e.g. `'openai'`, `'elevenlabs'`). */
    tts?: string;
    /** TTS voice name or id forwarded to the TTS provider. */
    voice?: string;
    /**
     * Barge-in handling strategy.
     * - `'hard-cut'`  -- interrupt TTS immediately when speech is detected.
     * - `'soft-fade'` -- ramp TTS volume down before cutting.
     * - `'disabled'`  -- ignore user speech while the agent is speaking.
     */
    bargeIn?: string;
    /**
     * Endpoint detection mode used to decide when the user has finished speaking.
     * - `'acoustic'`  -- energy/VAD-based detection.
     * - `'heuristic'` -- punctuation + silence heuristics.
     * - `'semantic'`  -- LLM-assisted turn boundary detection.
     */
    endpointing?: string;
    /** Whether to enable speaker diarization for multi-speaker sessions. */
    diarization?: boolean;
    /** BCP-47 language tag forwarded to STT (e.g. `'en-US'`). */
    language?: string;
}
/**
 * Adapts a compiled graph's I/O cycle to the real-time voice pipeline.
 *
 * ## Lifecycle
 *
 * 1. Construct with {@link VoiceTransportConfig}, an `IStreamTransport`, and an
 *    event sink callback.
 * 2. Call `init()` once before the graph starts running. This lazily imports
 *    `VoicePipelineOrchestrator`, creates an instance, and injects the transport
 *    into `state.scratch.voiceTransport`.
 * 3. Use `getNodeInput()` to obtain the user's transcribed speech for a node.
 *    Delegates to `pipeline.waitForUserTurn()` when a pipeline is available.
 * 4. Use `deliverNodeOutput()` to send the node's response to TTS via
 *    `pipeline.pushToTTS()`.
 * 5. Call `dispose()` to clean up resources when the session ends.
 */
export declare class VoiceTransportAdapter {
    private readonly config;
    private readonly transport;
    private readonly eventSink;
    /**
     * Lazily-initialised `VoicePipelineOrchestrator` instance.
     * Typed as `any` to avoid a hard import cycle with the voice subsystem.
     */
    private pipeline;
    /**
     * Tracks whether `init()` has been called successfully.
     * Set to `false` by `dispose()` to prevent use-after-teardown.
     */
    private initialized;
    /**
     * Creates a new VoiceTransportAdapter.
     *
     * @param config     - Voice pipeline configuration knobs.
     * @param transport  - Bidirectional audio/control stream transport (`IStreamTransport`).
     * @param eventSink  - Callback receiving all `GraphEvent` values emitted by
     *                     this adapter. Must not throw.
     */
    constructor(config: VoiceTransportConfig, transport: any, // IStreamTransport
    eventSink: (event: GraphEvent) => void);
    /**
     * Initialise the adapter.
     *
     * Lazily imports `VoicePipelineOrchestrator`, creates an instance from config,
     * injects the transport into `state.scratch.voiceTransport`, and emits a
     * `voice_session` started event.
     */
    init(state: Partial<GraphState>): Promise<void>;
    /**
     * Wait for the user's next speech turn and return the transcript text.
     *
     * Delegates to `VoicePipelineOrchestrator.waitForUserTurn()` when a pipeline
     * is available. Falls back to listening for `turn_complete` on the transport.
     */
    getNodeInput(nodeId: string): Promise<string>;
    /**
     * Deliver a node's text output to the TTS engine.
     *
     * Delegates to `VoicePipelineOrchestrator.pushToTTS()` when a pipeline is
     * available, then emits a `voice_audio` outbound GraphEvent.
     */
    deliverNodeOutput(nodeId: string, output: string | AsyncIterable<string>): Promise<void>;
    /**
     * Handle a user barge-in at the transport level.
     *
     * Emits a `voice_barge_in` event so that graph event consumers can react.
     */
    handleBargeIn(): void;
    /**
     * Dispose the adapter and emit a `voice_session` ended event.
     *
     * Stops the pipeline if one was initialised, then marks the adapter as
     * uninitialised so subsequent calls throw.
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=VoiceTransportAdapter.d.ts.map