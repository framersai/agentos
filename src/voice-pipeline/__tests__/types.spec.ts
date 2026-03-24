import { describe, it, expect } from 'vitest';
// Import ALL types and verify they compile and are usable
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
  it('AudioFrame has required fields', () => {
    const frame: AudioFrame = { samples: new Float32Array(160), sampleRate: 16000, timestamp: Date.now() };
    expect(frame.samples).toBeInstanceOf(Float32Array);
    expect(frame.sampleRate).toBe(16000);
  });

  it('EncodedAudioChunk is distinct from AudioFrame', () => {
    const chunk: EncodedAudioChunk = { audio: Buffer.from([0,1,2]), format: 'opus', sampleRate: 24000, durationMs: 500, text: 'hello' };
    expect(chunk.audio).toBeInstanceOf(Buffer);
  });

  it('VadEvent supports source field', () => {
    const event: VadEvent = { type: 'speech_start', timestamp: Date.now(), source: 'vad', energyLevel: 0.5 };
    expect(event.source).toBe('vad');
  });

  it('BargeinAction discriminated union works', () => {
    const cancel: BargeinAction = { type: 'cancel', injectMarker: '[interrupted]' };
    const pause: BargeinAction = { type: 'pause', fadeMs: 200 };
    const resume: BargeinAction = { type: 'resume' };
    const ignore: BargeinAction = { type: 'ignore' };
    expect(cancel.type).toBe('cancel');
    expect(pause.type).toBe('pause');
    expect(resume.type).toBe('resume');
    expect(ignore.type).toBe('ignore');
  });

  it('PipelineState includes all states', () => {
    const states: PipelineState[] = ['idle', 'listening', 'processing', 'speaking', 'interrupting', 'closed'];
    expect(states).toHaveLength(6);
  });

  it('VoicePipelineConfig has sensible defaults documented', () => {
    const config: VoicePipelineConfig = { stt: 'whisper-chunked', tts: 'openai' };
    expect(config.endpointing).toBeUndefined();
    expect(config.stt).toBe('whisper-chunked');
  });
});
