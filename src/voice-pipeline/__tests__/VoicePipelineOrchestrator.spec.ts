/**
 * @module voice-pipeline/__tests__/VoicePipelineOrchestrator.spec
 *
 * Tests for the VoicePipelineOrchestrator state machine. All pipeline
 * components are mocked to isolate the orchestrator's wiring and state
 * transition logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { VoicePipelineOrchestrator } from '../VoicePipelineOrchestrator.js';
import type {
  AudioFrame,
  BargeinAction,
  EncodedAudioChunk,
  IBargeinHandler,
  IEndpointDetector,
  IStreamTransport,
  IStreamingSTT,
  IStreamingTTS,
  IVoicePipelineAgentSession,
  StreamingSTTSession,
  StreamingTTSSession,
  TurnCompleteEvent,
  VoicePipelineConfig,
} from '../types.js';

// ============================================================================
// Mock factories
// ============================================================================

function createMockTransport(): IStreamTransport & EventEmitter {
  const emitter = new EventEmitter() as IStreamTransport & EventEmitter;
  Object.defineProperty(emitter, 'id', { value: 'transport-1' });
  Object.defineProperty(emitter, 'state', { value: 'open', writable: true });
  (emitter as any).sendAudio = vi.fn().mockResolvedValue(undefined);
  (emitter as any).sendControl = vi.fn().mockResolvedValue(undefined);
  (emitter as any).close = vi.fn();
  return emitter;
}

function createMockSTTSession(): StreamingSTTSession & EventEmitter {
  const emitter = new EventEmitter() as StreamingSTTSession & EventEmitter;
  (emitter as any).pushAudio = vi.fn();
  (emitter as any).flush = vi.fn().mockResolvedValue(undefined);
  (emitter as any).close = vi.fn();
  return emitter;
}

function createMockSTT(session: StreamingSTTSession): IStreamingSTT {
  return {
    providerId: 'mock-stt',
    isStreaming: false,
    startSession: vi.fn().mockResolvedValue(session),
  };
}

function createMockTTSSession(): StreamingTTSSession & EventEmitter {
  const emitter = new EventEmitter() as StreamingTTSSession & EventEmitter;
  (emitter as any).pushTokens = vi.fn();
  (emitter as any).flush = vi.fn().mockResolvedValue(undefined);
  (emitter as any).cancel = vi.fn();
  (emitter as any).close = vi.fn();
  return emitter;
}

function createMockTTS(session: StreamingTTSSession): IStreamingTTS {
  return {
    providerId: 'mock-tts',
    startSession: vi.fn().mockResolvedValue(session),
  };
}

function createMockEndpoint(): IEndpointDetector & EventEmitter {
  const emitter = new EventEmitter() as IEndpointDetector & EventEmitter;
  Object.defineProperty(emitter, 'mode', { value: 'heuristic' });
  (emitter as any).pushVadEvent = vi.fn();
  (emitter as any).pushTranscript = vi.fn();
  (emitter as any).reset = vi.fn();
  return emitter;
}

function createMockBargeinHandler(action: BargeinAction = { type: 'cancel' }): IBargeinHandler {
  return {
    mode: 'hard-cut',
    handleBargein: vi.fn().mockReturnValue(action),
  };
}

function createMockAgentSession(tokens: string[] = ['Hello', ' world']): IVoicePipelineAgentSession {
  return {
    sendText: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const t of tokens) yield t;
      },
    }),
    abort: vi.fn(),
  };
}

function makeConfig(overrides?: Partial<VoicePipelineConfig>): VoicePipelineConfig {
  return {
    stt: 'mock-stt',
    tts: 'mock-tts',
    maxTurnDurationMs: 30_000,
    ...overrides,
  };
}

function makeFrame(): AudioFrame {
  return {
    samples: new Float32Array([0.1, 0.2]),
    sampleRate: 16000,
    timestamp: Date.now(),
  };
}

function makeTurnComplete(): TurnCompleteEvent {
  return {
    transcript: 'Hello there',
    confidence: 0.95,
    durationMs: 1200,
    reason: 'silence_timeout',
  };
}

function makeAudioChunk(): EncodedAudioChunk {
  return {
    audio: Buffer.from([0]),
    format: 'opus',
    sampleRate: 24000,
    durationMs: 100,
    text: 'Hello',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('VoicePipelineOrchestrator', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let sttSession: ReturnType<typeof createMockSTTSession>;
  let ttsSession: ReturnType<typeof createMockTTSSession>;
  let endpoint: ReturnType<typeof createMockEndpoint>;
  let bargein: IBargeinHandler;
  let agentSession: IVoicePipelineAgentSession;
  let orchestrator: VoicePipelineOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    sttSession = createMockSTTSession();
    ttsSession = createMockTTSSession();
    endpoint = createMockEndpoint();
    bargein = createMockBargeinHandler();
    agentSession = createMockAgentSession();
    orchestrator = new VoicePipelineOrchestrator(makeConfig());
  });

  async function startSession() {
    return orchestrator.startSession(transport, agentSession, {
      streamingSTT: createMockSTT(sttSession),
      streamingTTS: createMockTTS(ttsSession),
      endpointDetector: endpoint,
      bargeinHandler: bargein,
    });
  }

  it('starts in idle state', () => {
    expect(orchestrator.state).toBe('idle');
  });

  it('transitions to listening on startSession', async () => {
    await startSession();
    expect(orchestrator.state).toBe('listening');
  });

  it('forwards audio frames from transport to STT', async () => {
    await startSession();
    const frame = makeFrame();
    transport.emit('audio', frame);
    expect(sttSession.pushAudio).toHaveBeenCalledWith(frame);
  });

  it('forwards transcript events to endpoint detector', async () => {
    await startSession();
    const transcript = { text: 'hello', confidence: 0.9, words: [], isFinal: false };
    sttSession.emit('transcript', transcript);
    expect(endpoint.pushTranscript).toHaveBeenCalledWith(transcript);
  });

  it('sends transcript control messages to transport', async () => {
    await startSession();
    const transcript = { text: 'hello', confidence: 0.9, words: [], isFinal: true };
    sttSession.emit('transcript', transcript);
    expect(transport.sendControl).toHaveBeenCalledWith({
      type: 'transcript',
      text: 'hello',
      isFinal: true,
      confidence: 0.9,
    });
  });

  it('transitions LISTENING → PROCESSING → SPEAKING on turn_complete', async () => {
    await startSession();
    const states: string[] = [];
    orchestrator.on('state_changed', (evt: { from: string; to: string }) => states.push(evt.to));

    endpoint.emit('turn_complete', makeTurnComplete());
    // Allow async iteration to complete
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toContain('processing');
    expect(states).toContain('speaking');
  });

  it('pipes LLM tokens to TTS', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    expect(ttsSession.pushTokens).toHaveBeenCalledWith('Hello');
    expect(ttsSession.pushTokens).toHaveBeenCalledWith(' world');
  });

  it('sends TTS audio chunks to transport', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    const chunk = makeAudioChunk();
    ttsSession.emit('audio', chunk);
    expect(transport.sendAudio).toHaveBeenCalledWith(chunk);
  });

  it('transitions SPEAKING → LISTENING on flush_complete', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    expect(orchestrator.state).toBe('speaking');
    ttsSession.emit('flush_complete');
    expect(orchestrator.state).toBe('listening');
  });

  it('sends agent_done on flush_complete', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    ttsSession.emit('flush_complete');
    expect(transport.sendControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent_done' }),
    );
  });

  it('handles barge-in: SPEAKING → cancel TTS → LISTENING', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    expect(orchestrator.state).toBe('speaking');

    // Simulate speech_start during speaking (barge-in)
    sttSession.emit('speech_start');
    await vi.advanceTimersByTimeAsync(0);

    expect(ttsSession.cancel).toHaveBeenCalled();
    expect(agentSession.abort).toHaveBeenCalled();
    expect(orchestrator.state).toBe('listening');
    expect(transport.sendControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'barge_in' }),
    );
  });

  it('transitions to CLOSED on transport disconnect', async () => {
    await startSession();
    transport.emit('close');
    expect(orchestrator.state).toBe('closed');
    expect(sttSession.close).toHaveBeenCalled();
    expect(ttsSession.close).toHaveBeenCalled();
  });

  it('stopSession tears down everything', async () => {
    await startSession();
    await orchestrator.stopSession('test teardown');
    expect(orchestrator.state).toBe('closed');
    expect(sttSession.close).toHaveBeenCalled();
    expect(ttsSession.close).toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledWith(1000, 'test teardown');
  });

  it('resets endpoint detector after flush_complete', async () => {
    await startSession();
    endpoint.emit('turn_complete', makeTurnComplete());
    await vi.advanceTimersByTimeAsync(0);

    ttsSession.emit('flush_complete');
    expect(endpoint.reset).toHaveBeenCalled();
  });

  it('pushes VAD events from STT speech_start/speech_end', async () => {
    await startSession();
    sttSession.emit('speech_start');
    await vi.advanceTimersByTimeAsync(0);
    expect(endpoint.pushVadEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'speech_start', source: 'stt' }),
    );

    sttSession.emit('speech_end');
    expect(endpoint.pushVadEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'speech_end', source: 'stt' }),
    );
  });
});
