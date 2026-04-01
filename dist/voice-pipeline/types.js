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
 * ## Dependency order (no circular refs)
 *
 * ```
 *   AudioFrame / EncodedAudioChunk
 *   -> Transport (IStreamTransport)
 *   -> STT (IStreamingSTT + StreamingSTTSession)
 *   -> Endpoint detection (IEndpointDetector + VadEvent)
 *   -> Diarization (IDiarizationEngine + DiarizationSession)
 *   -> TTS (IStreamingTTS + StreamingTTSSession)
 *   -> Barge-in (IBargeinHandler)
 *   -> Session (VoicePipelineSession)
 *   -> Protocol messages (ClientTextMessage, ServerTextMessage)
 * ```
 *
 * ## Design rationale
 *
 * Every interface in this module is kept deliberately narrow so that
 * implementations can be swapped at runtime (e.g. Deepgram STT vs Whisper
 * vs browser WebSpeechAPI) without touching the orchestrator. The
 * EventEmitter-based session pattern was chosen over callback interfaces
 * because it naturally supports fan-out (multiple listeners) and backpressure
 * is handled at the transport level rather than per-callback.
 */
export {};
//# sourceMappingURL=types.js.map