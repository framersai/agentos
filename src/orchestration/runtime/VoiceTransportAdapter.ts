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

// ---------------------------------------------------------------------------
// VoiceTransportConfig
// ---------------------------------------------------------------------------

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
 * 2. Call `init()` once before the graph starts running. This lazily imports
 *    `VoicePipelineOrchestrator`, creates an instance, and injects the transport
 *    into `state.scratch.voiceTransport`.
 * 3. Use `getNodeInput()` to obtain the user's transcribed speech for a node.
 *    Delegates to `pipeline.waitForUserTurn()` when a pipeline is available.
 * 4. Use `deliverNodeOutput()` to send the node's response to TTS via
 *    `pipeline.pushToTTS()`.
 * 5. Call `dispose()` to clean up resources when the session ends.
 */
export class VoiceTransportAdapter {
  /**
   * Lazily-initialised `VoicePipelineOrchestrator` instance.
   * Typed as `any` to avoid a hard import cycle with the voice subsystem.
   */
  private pipeline: any | null = null;

  /**
   * Tracks whether `init()` has been called successfully.
   * Set to `false` by `dispose()` to prevent use-after-teardown.
   */
  private initialized = false;

  /**
   * Creates a new VoiceTransportAdapter.
   *
   * @param config     - Voice pipeline configuration knobs.
   * @param transport  - Bidirectional audio/control stream transport (`IStreamTransport`).
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
   * Lazily imports `VoicePipelineOrchestrator`, creates an instance from config,
   * injects the transport into `state.scratch.voiceTransport`, and emits a
   * `voice_session` started event.
   */
  async init(state: Partial<GraphState>): Promise<void> {
    const scratch = ((state as any).scratch ??= {});
    scratch.voiceTransport = this.transport;

    // Lazily import to avoid hard dependency cycle with the voice subsystem
    try {
      const { VoicePipelineOrchestrator } = await import(
        '../../voice-pipeline/VoicePipelineOrchestrator.js'
      );
      this.pipeline = new VoicePipelineOrchestrator({
        stt: this.config.stt ?? 'deepgram',
        tts: this.config.tts ?? 'elevenlabs',
        endpointing: this.config.endpointing as any,
        bargeIn: this.config.bargeIn as any,
        voice: this.config.voice,
        language: this.config.language,
      });
    } catch {
      // Pipeline unavailable — fall back to transport-only mode
      this.pipeline = null;
    }

    this.initialized = true;

    this.eventSink({
      type: 'voice_session',
      nodeId: '__transport__',
      action: 'started',
    });
  }

  // -------------------------------------------------------------------------
  // Node I/O
  // -------------------------------------------------------------------------

  /**
   * Wait for the user's next speech turn and return the transcript text.
   *
   * Delegates to `VoicePipelineOrchestrator.waitForUserTurn()` when a pipeline
   * is available. Falls back to listening for `turn_complete` on the transport.
   */
  async getNodeInput(nodeId: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // Delegate to pipeline if available
    if (this.pipeline?.waitForUserTurn) {
      const turnEvent = await this.pipeline.waitForUserTurn();
      const transcript: string = turnEvent?.transcript ?? '';

      this.eventSink({
        type: 'voice_turn_complete',
        nodeId,
        transcript,
        turnIndex: 0,
        endpointReason: turnEvent?.reason ?? 'unknown',
      });

      return transcript;
    }

    // Fallback: listen on transport directly
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
   * Delegates to `VoicePipelineOrchestrator.pushToTTS()` when a pipeline is
   * available, then emits a `voice_audio` outbound GraphEvent.
   */
  async deliverNodeOutput(nodeId: string, output: string | AsyncIterable<string>): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceTransportAdapter not initialized');
    }

    // Delegate to pipeline TTS if available
    if (this.pipeline?.pushToTTS) {
      await this.pipeline.pushToTTS(output);
    }

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
   * Emits a `voice_barge_in` event so that graph event consumers can react.
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
   * Stops the pipeline if one was initialised, then marks the adapter as
   * uninitialised so subsequent calls throw.
   */
  async dispose(): Promise<void> {
    if (this.pipeline?.stopSession) {
      await this.pipeline.stopSession('adapter-disposed');
    }

    this.eventSink({
      type: 'voice_session',
      nodeId: '__transport__',
      action: 'ended',
      exitReason: 'transport-disposed',
    });
    this.initialized = false;
    this.pipeline = null;
  }
}
