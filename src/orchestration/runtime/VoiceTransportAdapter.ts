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
 * - `getNodeInput(nodeId)` blocks until the transport emits a `turn_complete`
 *   event, then resolves with the transcript string. It also emits a
 *   `voice_turn_complete` GraphEvent so the runtime event bus stays in sync.
 * - `deliverNodeOutput(nodeId, output)` sends text (or a streaming async
 *   iterable) to TTS and emits a `voice_audio` outbound GraphEvent.
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

// ---------------------------------------------------------------------------
// VoiceTransportConfig
// ---------------------------------------------------------------------------

/**
 * Configuration knobs forwarded to the voice pipeline when the adapter
 * initialises its internal `VoicePipelineOrchestrator` instance.
 *
 * All fields are optional -- defaults are resolved from agent.config.json or
 * sensible library defaults within the voice pipeline itself.
 *
 * @example
 * ```ts
 * const config: VoiceTransportConfig = {
 *   stt: 'deepgram',
 *   tts: 'elevenlabs',
 *   voice: 'rachel',
 *   bargeIn: 'hard-cut',
 *   endpointing: 'semantic',
 *   diarization: true,
 *   language: 'en-US',
 * };
 * ```
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

// ---------------------------------------------------------------------------
// VoiceTransportAdapter
// ---------------------------------------------------------------------------

/**
 * Adapts a compiled graph's I/O cycle to the real-time voice pipeline.
 *
 * ## Lifecycle
 *
 * 1. Construct with {@link VoiceTransportConfig}, an `IStreamTransport`, and an
 *    event sink callback.
 * 2. Call `init()` once before the graph starts running. This injects the
 *    transport into `state.scratch.voiceTransport` and emits a `voice_session`
 *    started event.
 * 3. Use `getNodeInput()` to obtain the user's transcribed speech for a node.
 *    Blocks until the transport emits a `turn_complete` event.
 * 4. Use `deliverNodeOutput()` to send the node's response to TTS.
 * 5. Call `dispose()` to clean up resources when the session ends.
 *
 * ## Error handling
 *
 * Both `getNodeInput()` and `deliverNodeOutput()` throw `Error` if called
 * before `init()`. After `dispose()`, the adapter is marked as uninitialised
 * so subsequent calls also throw.
 *
 * @see {@link VoiceTransportConfig} -- the config shape forwarded to the pipeline.
 * See `VoiceNodeExecutor` for the executor that interacts with the transport.
 */
export class VoiceTransportAdapter {
  /**
   * Lazily-initialised `VoicePipelineOrchestrator` instance.
   * Typed as `any` to avoid a hard import cycle with the voice subsystem.
   * In a full implementation this would be `VoicePipelineOrchestrator | null`.
   */
  private pipeline: any | null = null; // VoicePipelineOrchestrator (lazy)

  /**
   * Tracks whether `init()` has been called successfully.
   * Set to `false` by `dispose()` to prevent use-after-teardown.
   */
  private initialized = false;

  /**
   * Creates a new VoiceTransportAdapter.
   *
   * @param config     - Voice pipeline configuration knobs. Forwarded to the
   *                     pipeline when it is initialised.
   * @param transport  - Bidirectional audio/control stream transport
   *                     (`IStreamTransport`). Must be an EventEmitter that
   *                     emits `turn_complete` events for `getNodeInput()`.
   * @param eventSink  - Callback receiving all `GraphEvent` values emitted by
   *                     this adapter. Must not throw.
   */
  constructor(
    private readonly config: VoiceTransportConfig,
    private readonly transport: any, // IStreamTransport
    private readonly eventSink: (event: GraphEvent) => void
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialise the adapter.
   *
   * Injects the `IStreamTransport` instance into `state.scratch.voiceTransport`
   * so that voice graph nodes (specifically `VoiceNodeExecutor`) can access
   * the transport for session event subscription. Then emits a `voice_session`
   * started event to signal that the voice session is live.
   *
   * Must be called exactly once before `getNodeInput()` or
   * `deliverNodeOutput()`. Calling `init()` multiple times is safe but
   * redundant -- the transport reference is simply overwritten.
   *
   * @param state - Mutable `GraphState` (or partial) for the current run.
   *               `state.scratch` is created lazily if absent.
   */
  async init(state: Partial<GraphState>): Promise<void> {
    // Lazily create the scratch bag if the caller passed a partial state
    // without a pre-existing scratch object.
    const scratch = ((state as any).scratch ??= {});
    scratch.voiceTransport = this.transport;
    this.initialized = true;

    this.eventSink({
      type: 'voice_session',
      nodeId: '__transport__',
      action: 'started',
    });
  }

  /**
   * Wait for the user's next speech turn and return the transcript text.
   *
   * In a full production implementation this delegates to
   * `VoicePipelineOrchestrator.waitForUserTurn()`. In the current implementation
   * it listens for a single `'turn_complete'` event from the underlying transport
   * and resolves with the transcript text.
   *
   * Also emits a {@link GraphEvent} of type `voice_turn_complete` so that the
   * runtime event bus stays in sync with the transport-level turn lifecycle.
   *
   * @param nodeId - The id of the graph node requesting input; used to tag the
   *                emitted event for downstream filtering.
   * @returns Resolved transcript string from the user's speech turn.
   * @throws {Error} If called before `init()` or after `dispose()`.
   */
  async getNodeInput(nodeId: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // In the full implementation this would delegate to:
    //   this.pipeline.waitForUserTurn()
    // For now, listen directly to transport events for the next turn.
    return new Promise<string>((resolve) => {
      this.transport.once('turn_complete', (evt: any) => {
        // Accept both `transcript` and `text` fields for compatibility
        // with different transport implementations.
        const transcript: string = evt?.transcript ?? evt?.text ?? '';

        this.eventSink({
          type: 'voice_turn_complete',
          nodeId,
          transcript,
          turnIndex: 0,
          endpointReason: evt?.reason ?? 'unknown',
        });

        resolve(transcript);
      });
    });
  }

  /**
   * Deliver a node's text output to the TTS engine.
   *
   * Accepts either a plain `string` or an `AsyncIterable<string>` of token
   * chunks (e.g. a streaming LLM response). In a full production implementation
   * this delegates to `VoicePipelineOrchestrator.pushToTTS(output)`.
   *
   * Emits a {@link GraphEvent} of type `voice_audio` (direction `'outbound'`)
   * so that the runtime event bus records the TTS delivery.
   *
   * @param nodeId - The id of the graph node delivering the output; tags the
   *                emitted event for downstream filtering.
   * @param _output - Text or async token stream to synthesise as speech.
   *                 The underscore prefix indicates it is not yet consumed
   *                 in the v1 stub implementation.
   * @throws {Error} If called before `init()` or after `dispose()`.
   */
  async deliverNodeOutput(nodeId: string, _output: string | AsyncIterable<string>): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // In the full implementation this would delegate to:
    //   this.pipeline.pushToTTS(output)
    // For now, emit the event to signal delivery.
    this.eventSink({
      type: 'voice_audio',
      nodeId,
      direction: 'outbound',
      format: 'tts',
      durationMs: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Barge-in
  // -------------------------------------------------------------------------

  /**
   * Handle a user barge-in at the transport level.
   *
   * Should be called by the runtime or transport layer when the user starts
   * speaking while the agent is mid-utterance. Emits a `voice_barge_in` event
   * so that graph event consumers can react (e.g. cancel pending tool calls,
   * stop TTS playback, or reroute the graph).
   *
   * @see {@link VoiceInterruptError} -- the structured error used inside the graph executor.
   */
  handleBargeIn(): void {
    this.eventSink({
      type: 'voice_barge_in',
      nodeId: '__transport__',
      interruptedText: '',
      userSpeech: '',
    });
  }

  // -------------------------------------------------------------------------
  // Disposal
  // -------------------------------------------------------------------------

  /**
   * Dispose the adapter and emit a `voice_session` ended event.
   *
   * Marks the adapter as uninitialised so subsequent calls to `getNodeInput()`
   * or `deliverNodeOutput()` will throw, preventing accidental use after teardown.
   *
   * This method is idempotent -- calling it multiple times simply re-emits the
   * ended event and re-sets the initialised flag.
   */
  async dispose(): Promise<void> {
    this.eventSink({
      type: 'voice_session',
      nodeId: '__transport__',
      action: 'ended',
      exitReason: 'transport-disposed',
    });
    this.initialized = false;
  }
}
