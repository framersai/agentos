/**
 * @file VoiceTransportAdapter.ts
 * @description Bridges graph I/O to the voice pipeline when a workflow runs in
 * voice transport mode.
 *
 * `VoiceTransportAdapter` wraps a graph's input/output cycle so that:
 * - **Node input** is obtained by waiting for the user's next speech turn
 *   (`waitForUserTurn()` on the underlying `VoicePipelineOrchestrator`).
 * - **Node output** is delivered to the TTS engine (`pushToTTS()` on the
 *   underlying `VoicePipelineOrchestrator`).
 *
 * The adapter is lazy — it does not create a `VoicePipelineOrchestrator` until
 * `init()` is called.  The pipeline reference is `any` typed to avoid a hard
 * import cycle with the voice subsystem; callers that want stronger types may
 * cast.
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
 * All fields are optional — defaults are resolved from agent.config.json or
 * sensible library defaults.
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
   * - `'hard-cut'`  — interrupt TTS immediately when speech is detected.
   * - `'soft-fade'` — ramp TTS volume down before cutting.
   * - `'disabled'`  — ignore user speech while the agent is speaking.
   */
  bargeIn?: string;
  /**
   * Endpoint detection mode used to decide when the user has finished speaking.
   * - `'acoustic'`  — energy/VAD-based detection.
   * - `'heuristic'` — punctuation + silence heuristics.
   * - `'semantic'`  — LLM-assisted turn boundary detection.
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
 * Lifecycle:
 * 1. Construct with {@link VoiceTransportConfig}, an `IStreamTransport`, and an
 *    event sink callback.
 * 2. Call `init()` once before the graph starts running.
 * 3. Use `getNodeInput()` to obtain the user's transcribed speech for a node.
 * 4. Use `deliverNodeOutput()` to send the node's response to TTS.
 * 5. Call `dispose()` to clean up resources when the session ends.
 */
export class VoiceTransportAdapter {
  /**
   * Lazily-initialised `VoicePipelineOrchestrator` instance.
   * Typed as `any` to avoid a hard import cycle with the voice subsystem.
   * In a full implementation this would be `VoicePipelineOrchestrator | null`.
   */
  private pipeline: any | null = null; // VoicePipelineOrchestrator (lazy)

  /** Tracks whether `init()` has been called successfully. */
  private initialized = false;

  /**
   * @param config     - Voice pipeline configuration knobs.
   * @param transport  - Bidirectional audio/control stream transport (`IStreamTransport`).
   * @param eventSink  - Callback receiving all `GraphEvent` values emitted by this adapter.
   */
  constructor(
    private readonly config: VoiceTransportConfig,
    private readonly transport: any, // IStreamTransport
    private readonly eventSink: (event: GraphEvent) => void,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialise the adapter.
   *
   * Injects the `IStreamTransport` instance into `state.scratch.voiceTransport` so
   * that graph nodes can access it if needed, then emits a `voice_session` started
   * event to signal that the voice session is live.
   *
   * Must be called exactly once before {@link getNodeInput} or
   * {@link deliverNodeOutput}.
   *
   * @param state - Mutable `GraphState` (or partial) for the current run.
   *               `state.scratch` is created lazily if absent.
   */
  async init(state: Partial<GraphState>): Promise<void> {
    // Lazily create the scratch bag if the caller passed a partial state.
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
   * `VoicePipelineOrchestrator.waitForUserTurn()`.  In the current implementation
   * it listens for a single `'turn_complete'` event from the underlying transport
   * and resolves with the transcript text.
   *
   * Also emits a {@link GraphEvent} of type `voice_turn_complete` so that the
   * runtime event bus stays in sync.
   *
   * @param nodeId - The id of the graph node requesting input; used to tag the emitted event.
   * @returns Resolved transcript string from the user's speech turn.
   * @throws {Error} If called before `init()`.
   */
  async getNodeInput(nodeId: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // In real implementation: this.pipeline.waitForUserTurn()
    // For now, listen directly to transport events.
    return new Promise<string>((resolve) => {
      this.transport.once('turn_complete', (evt: any) => {
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
   * chunks (e.g. a streaming LLM response).  In a full production implementation
   * this delegates to `VoicePipelineOrchestrator.pushToTTS(output)`.
   *
   * Emits a {@link GraphEvent} of type `voice_audio` (direction `'outbound'`)
   * so that the runtime event bus records the TTS delivery.
   *
   * @param nodeId - The id of the graph node delivering the output.
   * @param output - Text or async token stream to synthesise as speech.
   * @throws {Error} If called before `init()`.
   */
  async deliverNodeOutput(nodeId: string, _output: string | AsyncIterable<string>): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // In real implementation: this.pipeline.pushToTTS(output)
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
   * speaking while the agent is mid-utterance.  Emits a `voice_barge_in` event
   * so that graph event consumers can react (e.g. cancel pending tool calls).
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
