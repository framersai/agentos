/**
 * @module voice-pipeline/types
 *
 * Core interfaces and types for the AgentOS streaming voice pipeline.
 *
 * The voice pipeline connects speech-to-text, endpoint detection, diarization,
 * agent processing, and text-to-speech into a low-latency, real-time conversation
 * system. All heavy I/O crosses EventEmitter-based session boundaries to keep
 * the hot path non-blocking.
 *
 * Dependency order (no circular refs):
 *   AudioFrame / EncodedAudioChunk
 *   → Transport (IStreamTransport)
 *   → STT (IStreamingSTT + StreamingSTTSession)
 *   → Endpoint detection (IEndpointDetector + VadEvent)
 *   → Diarization (IDiarizationEngine + DiarizationSession)
 *   → TTS (IStreamingTTS + StreamingTTSSession)
 *   → Barge-in (IBargeinHandler)
 *   → Session (VoicePipelineSession)
 *   → Protocol messages (ClientTextMessage, ServerTextMessage)
 */

import type { EventEmitter } from 'node:events';

// ============================================================================
// Raw audio types
// ============================================================================

/**
 * A single frame of raw PCM audio, as produced by a microphone capture or
 * a VAD pre-processor. Each frame typically represents 10–20 ms of audio.
 */
export interface AudioFrame {
  /**
   * Interleaved 32-bit float PCM samples, normalised to [-1, 1].
   * For mono audio this is a flat array; stereo interleaves L/R pairs.
   */
  samples: Float32Array;

  /**
   * Samples per second (e.g. 16000, 24000, 48000).
   */
  sampleRate: number;

  /**
   * Unix epoch millisecond timestamp at which this frame was captured.
   * Used for synchronisation across STT, VAD, and diarization streams.
   */
  timestamp: number;

  /**
   * Optional hint from the capture layer identifying the speaker source
   * (e.g. a hardware device label or a WebRTC peer ID). Used by the
   * diarization engine when native speaker IDs are unavailable.
   */
  speakerHint?: string;
}

/**
 * A compressed audio chunk ready for transmission over the wire (e.g. to a
 * TTS websocket or a playback buffer). Contains the rendered text to allow
 * barge-in handlers to track interrupted utterance state.
 */
export interface EncodedAudioChunk {
  /**
   * Raw encoded bytes in the format specified by `format`.
   */
  audio: Buffer;

  /**
   * Codec/container format of `audio`.
   */
  format: 'pcm' | 'mp3' | 'opus';

  /**
   * Samples per second for the encoded stream.
   */
  sampleRate: number;

  /**
   * Playback duration of this chunk in milliseconds.
   */
  durationMs: number;

  /**
   * The text fragment that was synthesised into this chunk. Preserved so
   * barge-in handlers can report `interruptedRemainder` accurately.
   */
  text: string;
}

// ============================================================================
// Transport layer
// ============================================================================

/**
 * Discriminated union of control messages sent from the pipeline to the
 * underlying stream transport (e.g. a WebSocket or WebRTC data-channel).
 */
export type TransportControlMessage =
  | {
      /** Mute the outbound audio stream without closing the session. */
      type: 'mute';
    }
  | {
      /** Unmute the outbound audio stream previously muted. */
      type: 'unmute';
    }
  | {
      /** Reconfigure transport-layer parameters at runtime. */
      type: 'config';
      /** Partial configuration overrides. Keys are transport-specific. */
      params: Record<string, unknown>;
    }
  | {
      /** Gracefully stop the transport and signal end-of-stream. */
      type: 'stop';
      /** Optional human-readable reason included in the closing handshake. */
      reason?: string;
    };

/**
 * Abstraction over any bidirectional audio/text stream transport.
 * Implementations include WebSocket, WebRTC data-channel, and in-process pipes.
 *
 * Emits:
 * - `'audio'` (AudioFrame) — inbound audio from the remote client.
 * - `'message'` (ClientTextMessage) — inbound JSON control message from the client.
 * - `'close'` () — transport has been closed (either side).
 * - `'error'` (Error) — fatal transport error.
 */
export interface IStreamTransport extends EventEmitter {
  /**
   * Stable identifier for this transport connection (e.g. a UUID or socket ID).
   */
  readonly id: string;

  /**
   * Current connection state.
   * - `'connecting'` — handshake in progress.
   * - `'open'` — fully established and ready.
   * - `'closing'` — graceful teardown initiated.
   * - `'closed'` — no longer usable.
   */
  readonly state: 'connecting' | 'open' | 'closing' | 'closed';

  /**
   * Send a synthesised audio chunk to the remote client for playback.
   * Resolves once the chunk has been handed to the underlying I/O layer.
   *
   * @param chunk — Encoded audio to deliver.
   */
  sendAudio(chunk: EncodedAudioChunk): Promise<void>;

  /**
   * Send a JSON control message to the remote client.
   *
   * @param message — Server-side protocol message.
   */
  sendControl(message: ServerTextMessage): Promise<void>;

  /**
   * Close the transport, optionally supplying a WebSocket-style close code and
   * human-readable reason string for diagnostics.
   *
   * @param code — Optional numeric close code (defaults to 1000 normal closure).
   * @param reason — Optional human-readable close reason.
   */
  close(code?: number, reason?: string): void;
}

// ============================================================================
// Streaming STT
// ============================================================================

/**
 * Configuration passed to {@link IStreamingSTT.startSession} when opening a new
 * speech recognition stream.
 */
export interface StreamingSTTConfig {
  /**
   * BCP-47 language code for recognition (e.g. `'en-US'`, `'fr-FR'`).
   * Falls back to the provider default when omitted.
   */
  language?: string;

  /**
   * Whether to emit interim (non-final) transcript events. When `true`,
   * partial results arrive more frequently at the cost of higher word error rate.
   * @defaultValue true
   */
  interimResults?: boolean;

  /**
   * Enable automatic punctuation insertion if the provider supports it.
   * @defaultValue true
   */
  punctuate?: boolean;

  /**
   * Mask profanity in transcripts if supported by the provider.
   * @defaultValue false
   */
  profanityFilter?: boolean;

  /**
   * Pass-through options forwarded verbatim to the underlying provider SDK.
   * Useful for enabling provider-specific features (e.g. custom vocabulary,
   * speaker adaptation models) without modifying the interface.
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * A single word within a {@link TranscriptEvent}, augmented with timing and
 * optional speaker attribution.
 */
export interface TranscriptWord {
  /**
   * The recognised word token (may include punctuation if `punctuate` is enabled).
   */
  word: string;

  /**
   * Millisecond offset from the start of the utterance at which this word begins.
   */
  start: number;

  /**
   * Millisecond offset from the start of the utterance at which this word ends.
   */
  end: number;

  /**
   * Recognition confidence in the range [0, 1]. Higher is better.
   */
  confidence: number;

  /**
   * Speaker label when diarization is performed natively by the STT provider
   * (e.g. Deepgram's `diarize` option). When diarization is handled by a
   * separate {@link IDiarizationEngine}, this field is populated post-hoc.
   */
  speaker?: string;
}

/**
 * Emitted by a {@link StreamingSTTSession} each time the provider produces a
 * recognition hypothesis.
 */
export interface TranscriptEvent {
  /**
   * Full transcript text for the current utterance hypothesis.
   */
  text: string;

  /**
   * Aggregate confidence score for `text` in the range [0, 1].
   */
  confidence: number;

  /**
   * Word-level detail, sorted by `start` time. May be empty for interim events
   * from providers that only supply word timing in final results.
   */
  words: TranscriptWord[];

  /**
   * `true` when this hypothesis is stable and will not be revised.
   * `false` for interim (streaming) hypotheses.
   */
  isFinal: boolean;

  /**
   * Duration of the recognised speech segment in milliseconds.
   * Populated only on final events where the provider supplies timing.
   */
  durationMs?: number;
}

/**
 * An active streaming speech-to-text session. Audio frames are pushed in
 * and transcript events flow out via EventEmitter.
 *
 * Emits:
 * - `'transcript'` (TranscriptEvent) — interim or final hypothesis.
 * - `'error'` (Error) — unrecoverable provider error.
 * - `'close'` () — session has been fully terminated.
 */
export interface StreamingSTTSession extends EventEmitter {
  /**
   * Push a raw audio frame into the recognition stream. Frames must arrive
   * in capture order; gaps or out-of-order frames degrade accuracy.
   *
   * @param frame — PCM audio frame to process.
   */
  pushAudio(frame: AudioFrame): void;

  /**
   * Signal end-of-utterance to the provider. The provider will flush any
   * buffered audio and emit a final {@link TranscriptEvent} before `'close'`.
   */
  flush(): Promise<void>;

  /**
   * Immediately terminate the session without waiting for a final result.
   * Useful during barge-in where the in-flight hypothesis is discarded.
   */
  close(): void;
}

/**
 * Factory interface for streaming speech-to-text providers.
 *
 * Implementations are registered via the `EXTENSION_KIND_STREAMING_STT`
 * extension kind and resolved by the voice pipeline at session creation time.
 */
export interface IStreamingSTT {
  /**
   * Unique, stable identifier for this provider (e.g. `'deepgram'`, `'whisper-live'`).
   */
  readonly providerId: string;

  /**
   * `true` when the provider has at least one active session open.
   */
  readonly isStreaming: boolean;

  /**
   * Open a new streaming recognition session.
   *
   * @param config — Session-level configuration overriding provider defaults.
   * @returns A ready-to-use session whose lifecycle is independent of this factory.
   */
  startSession(config?: StreamingSTTConfig): Promise<StreamingSTTSession>;
}

// ============================================================================
// Endpoint detection
// ============================================================================

/**
 * A VAD (Voice Activity Detection) or STT-derived event describing speech
 * energy transitions over time.
 */
export interface VadEvent {
  /**
   * Type of the VAD transition:
   * - `'speech_start'` — voice energy detected after silence.
   * - `'speech_end'` — voice energy fell below the silence threshold.
   * - `'silence'` — periodic silence heartbeat (emitted at `silenceIntervalMs` cadence).
   */
  type: 'speech_start' | 'speech_end' | 'silence';

  /**
   * Unix epoch millisecond timestamp at which this transition was detected.
   */
  timestamp: number;

  /**
   * Optional raw energy level used to trigger this event (implementation-defined scale).
   */
  energyLevel?: number;

  /**
   * Origin of the VAD event:
   * - `'vad'` — emitted by a standalone VAD model (e.g. Silero, WebRTC VAD).
   * - `'stt'` — inferred from STT activity (e.g. provider-side endpointing signals).
   */
  source?: 'vad' | 'stt';
}

/**
 * Semantic reason why the endpoint detector decided the user has finished speaking.
 */
export type EndpointReason =
  | 'silence_timeout'   // VAD silence exceeded configured threshold
  | 'punctuation'       // STT final result ends with sentence-terminal punctuation
  | 'syntax_complete'   // Syntax model determined utterance is grammatically complete
  | 'semantic_model'    // Small LM scored intent as complete
  | 'manual'            // Explicitly triggered by a ClientTextMessage control
  | 'timeout';          // Hard maximum turn duration elapsed

/**
 * Emitted by {@link IEndpointDetector} when it determines the user has finished
 * their turn and the pipeline should hand off to the agent.
 */
export interface TurnCompleteEvent {
  /**
   * The final consolidated transcript for this turn.
   */
  transcript: string;

  /**
   * Aggregate STT confidence score for the transcript, in the range [0, 1].
   */
  confidence: number;

  /**
   * Total duration of detected speech in this turn, in milliseconds.
   */
  durationMs: number;

  /**
   * The semantic reason that triggered turn completion.
   */
  reason: EndpointReason;
}

/**
 * Detects turn boundaries in a continuous audio/transcript stream.
 * Combines VAD events with linguistic signals to decide when the user
 * has finished speaking.
 *
 * Emits:
 * - `'turn_complete'` (TurnCompleteEvent) — the user's turn has ended.
 * - `'speech_start'` () — the user has started speaking (re-emitted from VAD).
 * - `'barge_in_detected'` () — user started speaking while TTS was playing.
 */
export interface IEndpointDetector extends EventEmitter {
  /**
   * Active detection strategy:
   * - `'silence'` — pure silence-timeout based.
   * - `'hybrid'` — silence + linguistic completeness signals.
   * - `'semantic'` — small LM scoring utterance completeness.
   */
  readonly mode: 'acoustic' | 'heuristic' | 'semantic';

  /**
   * Push a VAD event from the upstream voice activity detector.
   *
   * @param event — The VAD event to process.
   */
  pushVadEvent(event: VadEvent): void;

  /**
   * Push a partial or final STT result for linguistic analysis.
   *
   * @param event — Transcript event from the STT session.
   */
  pushTranscript(event: TranscriptEvent): void;

  /**
   * Reset all internal state (timers, partial transcripts) without destroying
   * the detector instance. Called at the start of each new turn.
   */
  reset(): void;
}

// ============================================================================
// Diarization
// ============================================================================

/**
 * Configuration for a diarization session. Controls expected speaker count and
 * chunking behaviour for providers that require buffered audio.
 */
export interface DiarizationConfig {
  /**
   * Hint to the provider about how many distinct speakers are expected.
   * When omitted, the provider uses auto-detection.
   */
  expectedSpeakers?: number;

  /**
   * When `true`, use the provider's built-in diarization instead of the
   * AgentOS diarization engine (e.g. Deepgram `diarize` option).
   * @defaultValue false
   */
  preferProviderNative?: boolean;

  /**
   * Size of audio chunks processed per diarization inference, in milliseconds.
   * Smaller values reduce latency; larger values improve accuracy.
   * @defaultValue 500
   */
  chunkSizeMs?: number;

  /**
   * Overlap between consecutive chunks in milliseconds. Overlap improves
   * speaker boundary accuracy at the cost of extra compute.
   * @defaultValue 100
   */
  overlapMs?: number;
}

/**
 * A contiguous segment of transcript text with millisecond timing metadata.
 */
export interface TranscriptSegment {
  /**
   * The text content of the segment.
   */
  text: string;

  /**
   * Start of the segment in milliseconds from the beginning of the stream.
   */
  startMs: number;

  /**
   * End of the segment in milliseconds from the beginning of the stream.
   */
  endMs: number;
}

/**
 * A {@link TranscriptSegment} extended with speaker attribution produced by the
 * diarization engine.
 */
export interface DiarizedSegment extends TranscriptSegment {
  /**
   * Stable speaker label assigned by the diarization engine (e.g. `'SPEAKER_0'`).
   * The label is consistent within a session but not across sessions unless
   * speaker enrollment is used.
   */
  speakerId: string;

  /**
   * Confidence that this segment belongs to `speakerId`, in the range [0, 1].
   */
  speakerConfidence: number;
}

/**
 * An active diarization session. Accepts raw audio and outputs speaker-attributed
 * transcript segments via EventEmitter.
 *
 * Emits:
 * - `'segment'` (DiarizedSegment) — a diarized transcript segment is ready.
 * - `'speaker_change'` ({ from: string; to: string }) — speaker transition detected.
 * - `'error'` (Error) — unrecoverable engine error.
 * - `'close'` () — session terminated.
 */
export interface DiarizationSession extends EventEmitter {
  /**
   * Push a raw audio frame for diarization analysis.
   *
   * @param frame — PCM audio frame from the capture stream.
   */
  pushAudio(frame: AudioFrame): void;

  /**
   * Apply speaker labels to an existing transcript using the session's
   * current speaker model. Returns labelled segments.
   *
   * @param transcript — Plain transcript segments to label.
   */
  labelTranscript(transcript: TranscriptSegment[]): Promise<DiarizedSegment[]>;

  /**
   * Enroll a known speaker so subsequent audio is attributed to a named identity
   * rather than an anonymous `SPEAKER_N` label.
   *
   * @param speakerId — Stable identifier for the speaker (e.g. user UUID).
   * @param samples — Representative audio frames for the speaker's voice.
   */
  enrollSpeaker(speakerId: string, samples: AudioFrame[]): Promise<void>;

  /**
   * Terminate the session and release all provider-side resources.
   */
  close(): void;
}

/**
 * Factory interface for diarization (speaker separation) engines.
 *
 * Registered via `EXTENSION_KIND_DIARIZATION`.
 */
export interface IDiarizationEngine {
  /**
   * Open a new diarization session.
   *
   * @param config — Session configuration controlling chunking and speaker hints.
   */
  startSession(config?: DiarizationConfig): Promise<DiarizationSession>;
}

// ============================================================================
// Streaming TTS
// ============================================================================

/**
 * Configuration passed to {@link IStreamingTTS.startSession} when opening a new
 * text-to-speech synthesis stream.
 */
export interface StreamingTTSConfig {
  /**
   * Provider-specific voice identifier (e.g. `'alloy'`, `'nova'`, `'en-US-Wavenet-D'`).
   * Defaults to the provider's built-in default when omitted.
   */
  voice?: string;

  /**
   * Output audio format.
   * @defaultValue 'opus'
   */
  format?: 'pcm' | 'mp3' | 'opus';

  /**
   * Output sample rate in Hz. Must be supported by the chosen `format`.
   * @defaultValue 24000
   */
  sampleRate?: number;

  /**
   * Controls how the provider segments incoming token streams into synthesis
   * requests:
   * - `'sentence'` — flush at sentence boundaries (lower latency).
   * - `'word'` — flush at word boundaries (minimum latency, may sound choppy).
   * - `'paragraph'` — flush at paragraph boundaries (highest quality).
   * @defaultValue 'sentence'
   */
  chunkingMode?: 'sentence' | 'word' | 'paragraph';

  /**
   * Maximum number of milliseconds of audio to buffer before forcing a flush,
   * regardless of `chunkingMode`. Prevents unbounded memory growth for very
   * long utterances.
   * @defaultValue 3000
   */
  maxBufferMs?: number;

  /**
   * Pass-through options forwarded to the underlying provider SDK.
   */
  providerOptions?: Record<string, unknown>;
}

/**
 * An active streaming TTS session. Token text is pushed in and encoded audio
 * chunks flow out via EventEmitter.
 *
 * Emits:
 * - `'audio'` (EncodedAudioChunk) — a synthesised audio chunk ready for playback.
 * - `'flush_complete'` () — all queued tokens have been synthesised.
 * - `'error'` (Error) — unrecoverable synthesis error.
 * - `'close'` () — session terminated.
 */
export interface StreamingTTSSession extends EventEmitter {
  /**
   * Push one or more LLM output tokens into the synthesis buffer.
   * The session will chunk and synthesise them according to `chunkingMode`.
   *
   * @param tokens — Text tokens to synthesise (may be partial words).
   */
  pushTokens(tokens: string): void;

  /**
   * Force synthesis of all buffered tokens, then emit `'flush_complete'`.
   * Call at end-of-response or when transitioning between agent turns.
   */
  flush(): Promise<void>;

  /**
   * Immediately stop synthesis and discard all buffered tokens. Audio chunks
   * currently in-flight are not recalled; the caller must stop playback separately.
   */
  cancel(): void;

  /**
   * Terminate the session and release provider-side resources.
   */
  close(): void;
}

/**
 * Factory interface for streaming text-to-speech providers.
 *
 * Registered via `EXTENSION_KIND_STREAMING_TTS`.
 */
export interface IStreamingTTS {
  /**
   * Unique, stable identifier for this provider (e.g. `'openai'`, `'elevenlabs'`).
   */
  readonly providerId: string;

  /**
   * Open a new streaming synthesis session.
   *
   * @param config — Session-level configuration overriding provider defaults.
   */
  startSession(config?: StreamingTTSConfig): Promise<StreamingTTSSession>;
}

// ============================================================================
// Barge-in handling
// ============================================================================

/**
 * Contextual information supplied to {@link IBargeinHandler.handleBargein} so the
 * handler can make an informed decision about how to respond to interruption.
 */
export interface BargeinContext {
  /**
   * Duration of detected user speech before the barge-in was confirmed, in ms.
   * Short durations may indicate accidental noise rather than intentional interruption.
   */
  speechDurationMs: number;

  /**
   * The partial TTS text that was interrupted. Used to construct `interruptedRemainder`
   * in {@link VoiceTurnMetadata}.
   */
  interruptedText: string;

  /**
   * How many milliseconds of audio had been played at the point of interruption.
   */
  playedDurationMs: number;
}

/**
 * Action the pipeline should take in response to a detected barge-in.
 * Returned by {@link IBargeinHandler.handleBargein}.
 */
export type BargeinAction =
  | {
      /** Immediately stop all TTS output and discard the remainder of the response. */
      type: 'cancel';
      /**
       * Optional text marker injected into the conversation context to signal that
       * the agent's turn was cut short (e.g. `'[interrupted]'`).
       */
      injectMarker?: string;
    }
  | {
      /** Fade out TTS audio over `fadeMs` milliseconds then pause. */
      type: 'pause';
      /** Duration of the fade-out in milliseconds. @defaultValue 150 */
      fadeMs?: number;
    }
  | {
      /**
       * Resume TTS playback from where it was paused (only valid after a prior
       * `'pause'` action).
       */
      type: 'resume';
    }
  | {
      /**
       * Treat the detected barge-in as noise and continue TTS playback uninterrupted.
       * Appropriate for very short, low-confidence speech detections.
       */
      type: 'ignore';
    };

/**
 * Handles the policy decision when a barge-in (user speaking over TTS) is detected.
 *
 * Registered via `EXTENSION_KIND_BARGEIN_HANDLER`.
 */
export interface IBargeinHandler {
  /**
   * Interruption strategy implemented by this handler:
   * - `'hard-cut'` — TTS audio is stopped immediately with no fade.
   * - `'soft-fade'` — TTS audio fades out over a short window before stopping.
   */
  readonly mode: 'hard-cut' | 'soft-fade';

  /**
   * Called by the pipeline when a barge-in is confirmed. The handler evaluates
   * the context and returns the action the pipeline should execute.
   *
   * @param context — Contextual snapshot at the moment of interruption.
   * @returns The action to perform (or a promise resolving to one).
   */
  handleBargein(context: BargeinContext): BargeinAction | Promise<BargeinAction>;
}

// ============================================================================
// Agent session interface
// ============================================================================

/**
 * Adapts any AgentOS agent to the voice pipeline's turn-based protocol.
 *
 * The pipeline calls {@link IVoicePipelineAgentSession.sendText} with the user's
 * final transcript and streams the response back as text tokens for TTS synthesis.
 */
export interface IVoicePipelineAgentSession {
  /**
   * Send the user's utterance to the agent and receive a streaming text response.
   *
   * @param text — Final transcript from the STT + endpoint detection pipeline.
   * @param metadata — Rich metadata about the current voice turn.
   * @returns An async iterable of text tokens (suitable for streaming into TTS).
   */
  sendText(text: string, metadata: VoiceTurnMetadata): AsyncIterable<string>;

  /**
   * Abort the current agent response mid-stream (called on barge-in when
   * `BargeinAction.type === 'cancel'`).
   *
   * Implementations should cancel any in-flight LLM requests. The pipeline
   * will discard any tokens emitted after `abort()` is called.
   */
  abort?(): void;
}

/**
 * Rich metadata attached to each voice turn and passed to the agent session.
 * Enables the agent to tailor its response based on conversation dynamics.
 */
export interface VoiceTurnMetadata {
  /**
   * Speaker labels present in this turn. Contains at least one entry (the user).
   * Multi-speaker turns arise in conference call or multi-party scenarios.
   */
  speakers: string[];

  /**
   * The reason the endpoint detector decided the user had finished speaking.
   */
  endpointReason: EndpointReason;

  /**
   * Duration of active user speech in this turn, in milliseconds.
   * Does not include silence periods.
   */
  speechDurationMs: number;

  /**
   * Whether the user's turn interrupted an in-progress TTS response.
   */
  wasInterrupted: boolean;

  /**
   * When `wasInterrupted` is `true`, the text remainder of the agent response
   * that was cut off. Useful for the agent to avoid re-stating information.
   */
  interruptedRemainder?: string;

  /**
   * Aggregate STT confidence for the complete transcript, in the range [0, 1].
   */
  transcriptConfidence: number;
}

// ============================================================================
// Pipeline configuration and state
// ============================================================================

/**
 * Top-level configuration for the {@link VoicePipelineSession}.
 * Specifies which providers to use and their session-level options.
 */
export interface VoicePipelineConfig {
  /**
   * Identifier of the streaming STT provider to use (must be registered via
   * `EXTENSION_KIND_STREAMING_STT`).
   * Examples: `'deepgram'`, `'whisper-live'`, `'whisper-chunked'`.
   */
  stt: string;

  /**
   * Identifier of the streaming TTS provider to use (must be registered via
   * `EXTENSION_KIND_STREAMING_TTS`).
   * Examples: `'openai'`, `'elevenlabs'`, `'cartesia'`.
   */
  tts: string;

  /**
   * Endpoint detection strategy. Defaults to `'hybrid'` when omitted.
   */
  endpointing?: 'acoustic' | 'heuristic' | 'semantic';

  /**
   * Enable speaker diarization for multi-speaker scenarios. Disabled by default.
   */
  diarization?: boolean;

  /**
   * Barge-in (interruption) handling mode. Defaults to `'hard-cut'` when omitted.
   */
  bargeIn?: 'hard-cut' | 'soft-fade' | 'disabled';

  /**
   * TTS voice identifier. Forwarded to {@link StreamingTTSConfig.voice}.
   */
  voice?: string;

  /**
   * Output audio format for TTS. Forwarded to {@link StreamingTTSConfig.format}.
   * @defaultValue 'opus'
   */
  format?: 'pcm' | 'mp3' | 'opus';

  /**
   * BCP-47 language code. Forwarded to both STT and TTS sessions.
   */
  language?: string;

  /**
   * Hard cap on how long a single user turn may last, in milliseconds.
   * When exceeded, the endpoint detector fires with reason `'timeout'`.
   * @defaultValue 30000
   */
  maxTurnDurationMs?: number;

  /**
   * Provider-level STT options merged into {@link StreamingSTTConfig.providerOptions}.
   */
  sttOptions?: Record<string, unknown>;

  /**
   * Provider-level TTS options merged into {@link StreamingTTSConfig.providerOptions}.
   */
  ttsOptions?: Record<string, unknown>;
}

/**
 * Lifecycle state of a {@link VoicePipelineSession}.
 *
 * Valid transitions:
 * ```
 * idle → listening → processing → speaking → listening
 *                                          → interrupting → listening
 * any  → closed
 * ```
 */
export type PipelineState =
  | 'idle'          // Session created but no audio flowing yet
  | 'listening'     // Capturing user audio; STT + VAD active
  | 'processing'    // User turn complete; agent generating response
  | 'speaking'      // TTS audio streaming to client
  | 'interrupting'  // Barge-in detected; winding down TTS
  | 'closed';       // Session terminated; no further state changes

/**
 * A live voice pipeline session binding a transport, STT, endpoint detection,
 * optional diarization, agent, and TTS into a single coordinated lifecycle.
 *
 * Emits:
 * - `'state_change'` (PipelineState) — pipeline state machine transition.
 * - `'turn_complete'` (TurnCompleteEvent) — user turn detected.
 * - `'agent_response_start'` () — agent has begun generating a response.
 * - `'agent_response_end'` () — agent response fully synthesised and played.
 * - `'barge_in'` (BargeinContext) — user interrupted TTS playback.
 * - `'error'` (Error) — unrecoverable pipeline error.
 * - `'close'` () — session has been fully torn down.
 */
export interface VoicePipelineSession extends EventEmitter {
  /**
   * Unique, stable identifier for this session (UUID).
   */
  readonly sessionId: string;

  /**
   * Current pipeline state machine state.
   */
  readonly state: PipelineState;

  /**
   * The transport this session is bound to. Useful for sending out-of-band
   * control messages without going through the pipeline.
   */
  readonly transport: IStreamTransport;

  /**
   * Gracefully close the session — flush in-flight audio, tear down all sub-sessions,
   * and emit `'close'`.
   *
   * @param reason — Optional human-readable reason for diagnostics.
   */
  close(reason?: string): Promise<void>;
}

// ============================================================================
// Wire protocol — client → server messages
// ============================================================================

/**
 * Messages sent from the client (browser/app) to the server over the transport.
 * All messages are JSON-serialised.
 */
export type ClientTextMessage =
  | {
      /**
       * Initial configuration sent once after the WebSocket connection is established.
       * The server responds with `session_started` after applying the config.
       */
      type: 'config';
      /** Pipeline configuration requested by the client. */
      config: VoicePipelineConfig;
    }
  | {
      /**
       * Runtime control commands sent during an active session.
       */
      type: 'control';
      /** The control action to perform. */
      action: TransportControlMessage;
    };

// ============================================================================
// Wire protocol — server → client messages
// ============================================================================

/**
 * Messages sent from the server to the client over the transport.
 * All messages are JSON-serialised.
 */
export type ServerTextMessage =
  | {
      /**
       * Sent once after the server has applied the client's `config` message
       * and is ready to receive audio.
       */
      type: 'session_started';
      /** The server-assigned session ID. */
      sessionId: string;
      /** Echo of the effective configuration (may differ from client request). */
      config: VoicePipelineConfig;
    }
  | {
      /**
       * Emitted for each STT hypothesis (interim and final).
       * Clients may display these in real time for visual feedback.
       */
      type: 'transcript';
      /** Transcript text for this event. */
      text: string;
      /** Whether this hypothesis is final. */
      isFinal: boolean;
      /** Aggregate confidence score [0, 1]. */
      confidence: number;
    }
  | {
      /**
       * Emitted when the agent has received the transcript and begun generating a reply.
       * Clients may show a thinking indicator.
       */
      type: 'agent_thinking';
    }
  | {
      /**
       * Emitted when TTS synthesis begins — audio chunks will follow over the audio channel.
       * Clients may hide thinking indicators.
       */
      type: 'agent_speaking';
      /**
       * Speculative text of the agent's response accumulated so far. May be partial
       * if the TTS is streaming token-by-token.
       */
      text: string;
    }
  | {
      /**
       * Emitted when the agent's complete response has been synthesised and sent.
       */
      type: 'agent_done';
      /** Full text of the completed response. */
      text: string;
      /** Duration of the synthesised audio in milliseconds. */
      durationMs: number;
    }
  | {
      /**
       * Emitted when the pipeline detects that the user has started speaking
       * over the current TTS output (barge-in).
       */
      type: 'barge_in';
      /** The action the pipeline is taking in response. */
      action: BargeinAction;
    }
  | {
      /**
       * Emitted when an unrecoverable error occurs in the pipeline.
       * The session will be closed after this message.
       */
      type: 'error';
      /** Machine-readable error code. */
      code: string;
      /** Human-readable description. */
      message: string;
    }
  | {
      /**
       * Emitted as the final message before the server closes the transport.
       */
      type: 'session_ended';
      /** Optional human-readable reason. */
      reason?: string;
    };
