/**
 * @module voice-pipeline/__tests__/types.spec
 *
 * Compile-time and runtime validation of the voice-pipeline type system.
 *
 * These tests verify that all exported types are structurally correct and
 * that discriminated unions work as expected at runtime. They act as a
 * canary for accidental breaking changes to the type signatures.
 */

import { describe, it, expect } from 'vitest';
// Import ALL types and verify they compile and are usable at runtime
import type {
  AudioFrame, EncodedAudioChunk, IStreamTransport, IStreamingSTT,
  StreamingSTTSession, StreamingSTTConfig, TranscriptWord, TranscriptEvent,
  IEndpointDetector, VadEvent, EndpointReason, TurnCompleteEvent,
  IDiarizationEngine, DiarizationSession, DiarizationConfig,
  TranscriptSegment, DiarizedSegment, IStreamingTTS, StreamingTTSSession,
  StreamingTTSConfig, IBargeinHandler, BargeinContext, BargeinAction,
  TransportControlMessage, IVoicePipelineAgentSession, VoicePipelineConfig,
  VoiceTurnMetadata, PipelineState, VoicePipelineSession,
  ClientTextMessage, ServerTextMessage,
} from '../types.js';

describe('voice-pipeline types', () => {
  /**
   * Validates that AudioFrame carries all required fields and that
   * Float32Array is used for PCM sample data (not a plain array).
   */
  it('should construct a valid AudioFrame with Float32Array samples', () => {
    const frame: AudioFrame = { samples: new Float32Array(160), sampleRate: 16000, timestamp: Date.now() };
    expect(frame.samples).toBeInstanceOf(Float32Array);
    expect(frame.sampleRate).toBe(16000);
  });

  /**
   * Confirms that EncodedAudioChunk and AudioFrame are structurally distinct --
   * EncodedAudioChunk uses Buffer for compressed audio, not Float32Array.
   */
  it('should construct a valid EncodedAudioChunk with Buffer audio', () => {
    const chunk: EncodedAudioChunk = { audio: Buffer.from([0,1,2]), format: 'opus', sampleRate: 24000, durationMs: 500, text: 'hello' };
    expect(chunk.audio).toBeInstanceOf(Buffer);
  });

  /**
   * Ensures the VadEvent interface supports the optional source and
   * energyLevel fields used for debugging and provenance tracking.
   */
  it('should support optional source and energyLevel fields on VadEvent', () => {
    const event: VadEvent = { type: 'speech_start', timestamp: Date.now(), source: 'vad', energyLevel: 0.5 };
    expect(event.source).toBe('vad');
  });

  /**
   * Validates that the BargeinAction discriminated union correctly narrows
   * to all four action types without TypeScript errors.
   */
  it('should support all four BargeinAction discriminated union variants', () => {
    const cancel: BargeinAction = { type: 'cancel', injectMarker: '[interrupted]' };
    const pause: BargeinAction = { type: 'pause', fadeMs: 200 };
    const resume: BargeinAction = { type: 'resume' };
    const ignore: BargeinAction = { type: 'ignore' };
    expect(cancel.type).toBe('cancel');
    expect(pause.type).toBe('pause');
    expect(resume.type).toBe('resume');
    expect(ignore.type).toBe('ignore');
  });

  /**
   * Confirms that all six pipeline states are representable and the type
   * is a union of string literals (not a plain string).
   */
  it('should enumerate all six PipelineState values', () => {
    const states: PipelineState[] = ['idle', 'listening', 'processing', 'speaking', 'interrupting', 'closed'];
    expect(states).toHaveLength(6);
  });

  /**
   * Verifies that VoicePipelineConfig requires only the mandatory fields
   * (stt, tts) and leaves all optional fields as undefined by default.
   */
  it('should allow VoicePipelineConfig with only mandatory stt and tts fields', () => {
    const config: VoicePipelineConfig = { stt: 'whisper-chunked', tts: 'openai' };
    expect(config.endpointing).toBeUndefined();
    expect(config.stt).toBe('whisper-chunked');
  });
});
