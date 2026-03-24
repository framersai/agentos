/**
 * @module voice-pipeline/VoicePipelineOrchestrator
 *
 * Central state machine that wires together transport, STT, endpoint detection,
 * TTS, barge-in handling, and the agent session into a coordinated real-time
 * voice conversation loop.
 *
 * State transitions:
 * ```
 * IDLE → startSession() → LISTENING
 * LISTENING → turn_complete → PROCESSING
 * PROCESSING → LLM tokens start → SPEAKING
 * SPEAKING → TTS complete → LISTENING
 * SPEAKING → barge-in → INTERRUPTING → LISTENING
 * ANY → transport disconnect → CLOSED
 * ```
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type {
  AudioFrame,
  EncodedAudioChunk,
  IBargeinHandler,
  IDiarizationEngine,
  IEndpointDetector,
  IStreamTransport,
  IStreamingSTT,
  IStreamingTTS,
  IVoicePipelineAgentSession,
  PipelineState,
  StreamingSTTSession,
  StreamingTTSSession,
  TranscriptEvent,
  TurnCompleteEvent,
  VoicePipelineConfig,
  VoicePipelineSession,
  VoiceTurnMetadata,
} from './types.js';

/**
 * Overrides for injecting pre-built components (primarily for testing).
 * In production, components would be resolved from ExtensionManager.
 */
export interface VoicePipelineOverrides {
  /** Pre-built streaming STT provider. */
  streamingSTT?: IStreamingSTT;
  /** Pre-built streaming TTS provider. */
  streamingTTS?: IStreamingTTS;
  /** Pre-built endpoint detector. */
  endpointDetector?: IEndpointDetector;
  /** Pre-built barge-in handler. */
  bargeinHandler?: IBargeinHandler;
  /** Pre-built diarization engine. */
  diarizationEngine?: IDiarizationEngine;
}

/**
 * VoicePipelineOrchestrator is the central state machine for the AgentOS
 * streaming voice pipeline. It coordinates audio capture, speech recognition,
 * endpoint detection, agent inference, text-to-speech synthesis, and barge-in
 * handling into a seamless real-time conversation loop.
 *
 * Emits:
 * - `'state_changed'` ({ from: PipelineState, to: PipelineState })
 */
export class VoicePipelineOrchestrator extends EventEmitter {
  /** Current pipeline state. */
  private _state: PipelineState = 'idle';

  /** Active sub-sessions and components, set during startSession. */
  private _sttSession: StreamingSTTSession | null = null;
  private _ttsSession: StreamingTTSSession | null = null;
  private _endpointDetector: IEndpointDetector | null = null;
  private _bargeinHandler: IBargeinHandler | null = null;
  private _transport: IStreamTransport | null = null;
  private _agentSession: IVoicePipelineAgentSession | null = null;

  /** Watchdog timer ID for max turn duration. */
  private _watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  /** Tracks cumulative TTS text for barge-in context. */
  private _currentTTSText = '';

  /** Tracks cumulative played duration for barge-in context. */
  private _currentPlayedMs = 0;

  /** Current pipeline state (read-only). */
  get state(): PipelineState {
    return this._state;
  }

  constructor(private readonly config: VoicePipelineConfig) {
    super();
  }

  /**
   * Start a voice session. Accepts pre-built components via overrides for testing.
   * In production, components are resolved from ExtensionManager (future task).
   *
   * @param transport - The bidirectional audio/text stream transport.
   * @param agentSession - The agent session adapter for turn-based conversation.
   * @param overrides - Optional pre-built components (for testing or manual wiring).
   * @returns A live VoicePipelineSession object.
   */
  async startSession(
    transport: IStreamTransport,
    agentSession: IVoicePipelineAgentSession,
    overrides?: VoicePipelineOverrides,
  ): Promise<VoicePipelineSession> {
    if (this._state !== 'idle') {
      throw new Error(`Cannot start session in state '${this._state}'; expected 'idle'.`);
    }

    this._transport = transport;
    this._agentSession = agentSession;

    const stt = overrides?.streamingSTT;
    const tts = overrides?.streamingTTS;
    const endpointDetector = overrides?.endpointDetector;
    const bargeinHandler = overrides?.bargeinHandler;

    if (!stt) throw new Error('streamingSTT is required (pass via overrides or wait for ExtensionManager support).');
    if (!tts) throw new Error('streamingTTS is required (pass via overrides or wait for ExtensionManager support).');
    if (!endpointDetector) throw new Error('endpointDetector is required.');
    if (!bargeinHandler) throw new Error('bargeinHandler is required.');

    // Create sub-sessions
    const sttSession = await stt.startSession({ language: this.config.language });
    const ttsSession = await tts.startSession({
      voice: this.config.voice,
      format: this.config.format,
    });

    this._sttSession = sttSession;
    this._ttsSession = ttsSession;
    this._endpointDetector = endpointDetector;
    this._bargeinHandler = bargeinHandler;

    // Wire everything up
    this._wireTransportToSTT(transport, sttSession);
    this._wireSTTToEndpoint(sttSession, endpointDetector, transport);
    this._wireTurnComplete(endpointDetector, transport, agentSession, ttsSession);
    this._wireTTSToTransport(ttsSession, transport);
    this._wireBargein(sttSession, ttsSession, bargeinHandler, transport, agentSession);
    this._wireDisconnect(transport, sttSession, ttsSession);

    // Transition to listening
    this._setState('listening');

    // Start watchdog
    this._resetWatchdog();

    // Build and return the VoicePipelineSession object
    const sessionId = randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const orchestrator = this;
    const session: VoicePipelineSession = Object.assign(new EventEmitter(), {
      sessionId,
      get state(): PipelineState {
        return orchestrator._state;
      },
      transport,
      async close(reason?: string): Promise<void> {
        await orchestrator.stopSession(reason);
      },
    });

    // Forward state_changed events to the session
    this.on('state_changed', (evt) => session.emit('state_change', evt.to));

    return session;
  }

  /**
   * Stop the current session, tearing down all sub-sessions and timers.
   *
   * @param reason - Optional human-readable reason for diagnostics.
   */
  async stopSession(reason?: string): Promise<void> {
    if (this._state === 'closed') return;

    this._clearWatchdog();
    this._sttSession?.close();
    this._ttsSession?.close();
    this._transport?.close(1000, reason);
    this._setState('closed');

    // Clean up references
    this._sttSession = null;
    this._ttsSession = null;
    this._endpointDetector = null;
    this._bargeinHandler = null;
    this._transport = null;
    this._agentSession = null;
  }

  // --------------------------------------------------------------------------
  // Wiring helpers
  // --------------------------------------------------------------------------

  /**
   * Forward audio frames from transport to STT session.
   */
  private _wireTransportToSTT(
    transport: IStreamTransport,
    sttSession: StreamingSTTSession,
  ): void {
    transport.on('audio', (frame: AudioFrame) => {
      sttSession.pushAudio(frame);
    });
  }

  /**
   * Forward STT transcript events to endpoint detector and transport.
   */
  private _wireSTTToEndpoint(
    sttSession: StreamingSTTSession,
    endpointDetector: IEndpointDetector,
    transport: IStreamTransport,
  ): void {
    sttSession.on('transcript', (transcript: TranscriptEvent) => {
      endpointDetector.pushTranscript(transcript);
      transport.sendControl({
        type: 'transcript',
        text: transcript.text,
        isFinal: transcript.isFinal,
        confidence: transcript.confidence,
      });
    });
  }

  /**
   * Handle turn_complete from endpoint detector — transition through
   * PROCESSING → SPEAKING → LISTENING.
   */
  private _wireTurnComplete(
    endpointDetector: IEndpointDetector,
    transport: IStreamTransport,
    agentSession: IVoicePipelineAgentSession,
    ttsSession: StreamingTTSSession,
  ): void {
    endpointDetector.on('turn_complete', async (event: TurnCompleteEvent) => {
      if (this._state !== 'listening') return;

      this._clearWatchdog();
      this._setState('processing');
      transport.sendControl({ type: 'agent_thinking' });

      const metadata: VoiceTurnMetadata = {
        speakers: [],
        endpointReason: event.reason,
        speechDurationMs: event.durationMs,
        wasInterrupted: false,
        transcriptConfidence: event.confidence,
      };

      const tokenStream = agentSession.sendText(event.transcript, metadata);
      this._setState('speaking');
      this._currentTTSText = '';
      this._currentPlayedMs = 0;
      transport.sendControl({ type: 'agent_speaking', text: '' });

      for await (const token of tokenStream) {
        if ((this._state as string) !== 'speaking') break; // barge-in happened
        this._currentTTSText += token;
        ttsSession.pushTokens(token);
      }

      if ((this._state as string) === 'speaking') {
        await ttsSession.flush();
      }
    });
  }

  /**
   * Forward TTS audio chunks to the transport and handle utterance completion.
   */
  private _wireTTSToTransport(
    ttsSession: StreamingTTSSession,
    transport: IStreamTransport,
  ): void {
    ttsSession.on('audio', (chunk: EncodedAudioChunk) => {
      if (this._state === 'speaking') {
        this._currentPlayedMs += chunk.durationMs;
        transport.sendAudio(chunk);
      }
    });

    ttsSession.on('flush_complete', () => {
      if (this._state === 'speaking') {
        this._setState('listening');
        transport.sendControl({
          type: 'agent_done',
          text: this._currentTTSText,
          durationMs: this._currentPlayedMs,
        });
        this._endpointDetector?.reset();
        this._resetWatchdog();
      }
    });
  }

  /**
   * Wire barge-in detection: when speech is detected during SPEAKING state,
   * consult the barge-in handler and act accordingly.
   */
  private _wireBargein(
    sttSession: StreamingSTTSession,
    ttsSession: StreamingTTSSession,
    bargeinHandler: IBargeinHandler,
    transport: IStreamTransport,
    agentSession: IVoicePipelineAgentSession,
  ): void {
    sttSession.on('speech_start', async () => {
      // Also push VAD event to endpoint detector
      this._endpointDetector?.pushVadEvent({
        type: 'speech_start',
        timestamp: Date.now(),
        source: 'stt',
      });

      if (this._state === 'speaking') {
        const action = await bargeinHandler.handleBargein({
          speechDurationMs: 0,
          interruptedText: this._currentTTSText,
          playedDurationMs: this._currentPlayedMs,
        });

        if (action.type === 'cancel') {
          this._setState('interrupting');
          ttsSession.cancel();
          agentSession.abort?.();
          transport.sendControl({ type: 'barge_in', action });
          this._setState('listening');
          this._endpointDetector?.reset();
          this._resetWatchdog();
        } else if (action.type === 'pause') {
          transport.sendControl({ type: 'barge_in', action });
        }
        // 'ignore' and 'resume' — do nothing
      }
    });

    sttSession.on('speech_end', () => {
      this._endpointDetector?.pushVadEvent({
        type: 'speech_end',
        timestamp: Date.now(),
        source: 'stt',
      });
    });
  }

  /**
   * Handle transport disconnect — close everything.
   */
  private _wireDisconnect(
    transport: IStreamTransport,
    sttSession: StreamingSTTSession,
    ttsSession: StreamingTTSSession,
  ): void {
    transport.on('close', () => {
      this._clearWatchdog();
      this._setState('closed');
      sttSession.close();
      ttsSession.close();
    });
  }

  // --------------------------------------------------------------------------
  // State management
  // --------------------------------------------------------------------------

  /**
   * Transition to a new pipeline state, emitting a `state_changed` event.
   */
  private _setState(state: PipelineState): void {
    const from = this._state;
    if (from === state) return;
    this._state = state;
    this.emit('state_changed', { from, to: state });
  }

  // --------------------------------------------------------------------------
  // Watchdog timer
  // --------------------------------------------------------------------------

  /**
   * Reset the watchdog timer for max turn duration. If the pipeline stays in
   * LISTENING for longer than `maxTurnDurationMs` (default 30s) without a
   * turn_complete, force a timeout.
   */
  private _resetWatchdog(): void {
    this._clearWatchdog();
    const maxMs = this.config.maxTurnDurationMs ?? 30_000;
    this._watchdogTimer = setTimeout(() => {
      if (this._state === 'listening') {
        this._endpointDetector?.pushVadEvent({
          type: 'speech_end',
          timestamp: Date.now(),
          source: 'vad',
        });
      }
    }, maxMs);
  }

  /**
   * Clear the watchdog timer if active.
   */
  private _clearWatchdog(): void {
    if (this._watchdogTimer !== null) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }
}
