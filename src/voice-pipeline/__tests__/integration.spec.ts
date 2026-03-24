/**
 * @module voice-pipeline/__tests__/integration.spec
 *
 * Full conversational loop integration test for the voice pipeline.
 *
 * Uses real HeuristicEndpointDetector and HardCutBargeinHandler wired into
 * VoicePipelineOrchestrator. STT, TTS, and the agent session are mocked so
 * no real API calls are made.
 *
 * Scenario coverage:
 *   1. Full conversational turn (listening → processing → speaking → listening)
 *   2. Barge-in interruption with HardCutBargeinHandler threshold logic
 *   3. Transport disconnect collapses state to 'closed'
 *   4. Multiple sequential turns — endpoint detector resets between turns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

import { VoicePipelineOrchestrator } from '../VoicePipelineOrchestrator.js';
import { HeuristicEndpointDetector } from '../HeuristicEndpointDetector.js';
import { HardCutBargeinHandler } from '../HardCutBargeinHandler.js';

import type {
  AudioFrame,
  EncodedAudioChunk,
  IStreamingSTT,
  IStreamingTTS,
  StreamingSTTSession,
  StreamingTTSSession,
  VoicePipelineConfig,
} from '../types.js';

// ============================================================================
// Mock factories
// ============================================================================

/**
 * Creates a minimal in-process transport mock that fulfils IStreamTransport.
 * Callers may emit `'audio'`, `'close'`, or `'message'` to drive the pipeline.
 */
function createMockTransport() {
  const t = new EventEmitter() as any;
  t.id = 'integration-test';
  t.state = 'open';
  t.sendAudio = vi.fn().mockResolvedValue(undefined);
  t.sendControl = vi.fn().mockResolvedValue(undefined);
  t.close = vi.fn().mockResolvedValue(undefined);
  return t;
}

/**
 * Creates a mock STT session EventEmitter.
 * Callers emit `'transcript'`, `'speech_start'`, or `'speech_end'` to drive state.
 */
function createMockSTTSession(): StreamingSTTSession & EventEmitter {
  const s = new EventEmitter() as any;
  s.pushAudio = vi.fn();
  s.flush = vi.fn().mockResolvedValue(undefined);
  s.close = vi.fn().mockResolvedValue(undefined);
  return s as StreamingSTTSession & EventEmitter;
}

/**
 * Creates a mock STT factory that resolves with the given session.
 */
function createMockSTT(session: StreamingSTTSession): IStreamingSTT {
  return {
    providerId: 'mock-stt',
    isStreaming: false,
    startSession: vi.fn().mockResolvedValue(session),
  };
}

/**
 * Creates a mock TTS session EventEmitter.
 * Callers emit `'audio'` or `'flush_complete'` to drive state.
 */
function createMockTTSSession(): StreamingTTSSession & EventEmitter {
  const s = new EventEmitter() as any;
  s.pushTokens = vi.fn();
  s.flush = vi.fn().mockResolvedValue(undefined);
  s.cancel = vi.fn();
  s.close = vi.fn().mockResolvedValue(undefined);
  return s as StreamingTTSSession & EventEmitter;
}

/**
 * Creates a mock TTS factory that resolves with the given session.
 */
function createMockTTS(session: StreamingTTSSession): IStreamingTTS {
  return {
    providerId: 'mock-tts',
    startSession: vi.fn().mockResolvedValue(session),
  };
}

/**
 * Creates a mock agent session. The sendText generator yields two tokens then
 * returns. A new generator is returned on each call so the mock supports
 * multiple turns.
 */
function createMockAgentSession() {
  return {
    sendText: vi.fn().mockImplementation(() =>
      (async function* () {
        yield 'Hello ';
        yield 'back!';
      })(),
    ),
    abort: vi.fn(),
  };
}

/** Minimal pipeline config used throughout all tests. */
function makeConfig(overrides?: Partial<VoicePipelineConfig>): VoicePipelineConfig {
  return {
    stt: 'mock-stt',
    tts: 'mock-tts',
    maxTurnDurationMs: 30_000,
    ...overrides,
  };
}

/** Helper to build a minimal AudioFrame for injection tests. */
function makeAudioFrame(): AudioFrame {
  return {
    samples: new Float32Array([0.1, 0.2]),
    sampleRate: 16_000,
    timestamp: Date.now(),
  };
}

/** Helper to build a minimal EncodedAudioChunk for TTS emission. */
function makeAudioChunk(): EncodedAudioChunk {
  return {
    audio: Buffer.from([0xab]),
    format: 'opus',
    sampleRate: 24_000,
    durationMs: 120,
    text: 'Hello back!',
  };
}

// ============================================================================
// Shared setup
// ============================================================================

describe('voice pipeline — full conversational loop integration', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let sttSession: StreamingSTTSession & EventEmitter;
  let ttsSession: StreamingTTSSession & EventEmitter;
  let agentSession: ReturnType<typeof createMockAgentSession>;
  let orchestrator: VoicePipelineOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    sttSession = createMockSTTSession();
    ttsSession = createMockTTSSession();
    agentSession = createMockAgentSession();
    orchestrator = new VoicePipelineOrchestrator(makeConfig());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Start the orchestrator session with real HeuristicEndpointDetector and
   * real HardCutBargeinHandler, all other components mocked.
   */
  async function startSession(
    detectorOptions?: ConstructorParameters<typeof HeuristicEndpointDetector>[0],
    bargeinOptions?: ConstructorParameters<typeof HardCutBargeinHandler>[0],
  ) {
    const endpointDetector = new HeuristicEndpointDetector(detectorOptions);
    const bargeinHandler = new HardCutBargeinHandler(bargeinOptions);

    const session = await orchestrator.startSession(transport, agentSession, {
      streamingSTT: createMockSTT(sttSession),
      streamingTTS: createMockTTS(ttsSession),
      endpointDetector,
      bargeinHandler,
    });

    return { session, endpointDetector, bargeinHandler };
  }

  /**
   * Drive a full conversational turn:
   *   1. Emit a final transcript with terminal punctuation.
   *   2. Emit speech_end so the HeuristicEndpointDetector fires turn_complete.
   *   3. Flush the async token loop.
   *   4. Emit flush_complete to finish TTS and return to listening.
   *
   * Returns once the orchestrator is back in 'listening' state.
   */
  async function driveFullTurn(transcript = 'Hello.') {
    const now = Date.now();

    // Simulate STT producing a final transcript ending with terminal punctuation.
    sttSession.emit('transcript', {
      text: transcript,
      confidence: 0.93,
      words: [],
      isFinal: true,
    });

    // Simulate speech_end — the heuristic detector will fire turn_complete
    // immediately because of the terminal punctuation.
    sttSession.emit('speech_end');

    // Yield control so the async turn_complete handler and token loop run.
    await vi.advanceTimersByTimeAsync(0);

    // Emit an audio chunk from TTS (wired through to transport).
    ttsSession.emit('audio', makeAudioChunk());

    // Emit flush_complete → orchestrator transitions back to listening.
    ttsSession.emit('flush_complete');
  }

  // ============================================================================
  // Test 1: Full conversational turn
  // ============================================================================

  it('scenario 1: full conversational turn (listening → processing → speaking → listening)', async () => {
    await startSession();

    // Verify initial state after session start.
    expect(orchestrator.state).toBe('listening');

    // Simulate transport delivering an audio frame → STT should receive it.
    const frame = makeAudioFrame();
    transport.emit('audio', frame);
    expect((sttSession as any).pushAudio).toHaveBeenCalledWith(frame);

    // Collect state transitions.
    const states: string[] = [];
    orchestrator.on('state_changed', (evt: { from: string; to: string }) =>
      states.push(evt.to),
    );

    // Drive the full turn.
    await driveFullTurn('Hello.');

    // State should have progressed through processing and speaking and returned.
    expect(states).toContain('processing');
    expect(states).toContain('speaking');
    expect(states).toContain('listening');

    // Agent session must have been called with the recognised transcript.
    expect(agentSession.sendText).toHaveBeenCalledWith(
      'Hello.',
      expect.objectContaining({ endpointReason: 'punctuation' }),
    );

    // TTS session must have received both token chunks from the agent.
    expect((ttsSession as any).pushTokens).toHaveBeenCalledWith('Hello ');
    expect((ttsSession as any).pushTokens).toHaveBeenCalledWith('back!');

    // Transport must have received the TTS audio chunk.
    expect(transport.sendAudio).toHaveBeenCalledWith(expect.objectContaining({ format: 'opus' }));

    // Final state: back to listening.
    expect(orchestrator.state).toBe('listening');
  });

  // ============================================================================
  // Test 2: Barge-in interruption
  // ============================================================================

  it('scenario 2: barge-in below threshold is ignored (HardCutBargeinHandler)', async () => {
    await startSession({ silenceTimeoutMs: 500 }, { minSpeechMs: 300 });

    // Advance to SPEAKING state.
    sttSession.emit('transcript', {
      text: 'Tell me a story.',
      confidence: 0.9,
      words: [],
      isFinal: true,
    });
    sttSession.emit('speech_end');
    await vi.advanceTimersByTimeAsync(0);

    expect(orchestrator.state).toBe('speaking');

    // Simulate speech_start during SPEAKING — orchestrator passes speechDurationMs: 0
    // to the barge-in handler, which is below the 300 ms threshold → 'ignore'.
    sttSession.emit('speech_start');
    await vi.advanceTimersByTimeAsync(0);

    // TTS should NOT have been cancelled.
    expect((ttsSession as any).cancel).not.toHaveBeenCalled();
    // State must remain speaking.
    expect(orchestrator.state).toBe('speaking');
  });

  it('scenario 2b: barge-in above threshold cancels TTS and returns to listening', async () => {
    // Use minSpeechMs: 0 so any detection is treated as intentional.
    await startSession({ silenceTimeoutMs: 500 }, { minSpeechMs: 0 });

    // Advance to SPEAKING state.
    sttSession.emit('transcript', {
      text: 'Tell me a story.',
      confidence: 0.9,
      words: [],
      isFinal: true,
    });
    sttSession.emit('speech_end');
    await vi.advanceTimersByTimeAsync(0);

    expect(orchestrator.state).toBe('speaking');

    // Simulate speech_start with speechDurationMs: 0 >= minSpeechMs: 0 → 'cancel'.
    sttSession.emit('speech_start');
    await vi.advanceTimersByTimeAsync(0);

    // TTS must have been cancelled.
    expect((ttsSession as any).cancel).toHaveBeenCalled();
    // Agent abort must have been triggered.
    expect(agentSession.abort).toHaveBeenCalled();
    // Transport must have received a barge_in control message.
    expect(transport.sendControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'barge_in' }),
    );
    // State must return to listening.
    expect(orchestrator.state).toBe('listening');
  });

  // ============================================================================
  // Test 3: Transport disconnect
  // ============================================================================

  it('scenario 3: transport disconnect collapses state to closed', async () => {
    await startSession();
    expect(orchestrator.state).toBe('listening');

    // Simulate the transport closing (e.g. WebSocket disconnect).
    transport.emit('close');

    expect(orchestrator.state).toBe('closed');
    // Sub-sessions must have been torn down.
    expect((sttSession as any).close).toHaveBeenCalled();
    expect((ttsSession as any).close).toHaveBeenCalled();
  });

  // ============================================================================
  // Test 4: Multiple sequential turns
  // ============================================================================

  it('scenario 4: multiple sequential turns — endpoint detector resets between turns', async () => {
    const { endpointDetector } = await startSession();
    const resetSpy = vi.spyOn(endpointDetector, 'reset');

    // ----- First turn -----
    await driveFullTurn('First question.');
    await vi.advanceTimersByTimeAsync(0);

    // After a turn, the detector's reset() is invoked both internally (inside
    // _emitTurnComplete) and by the orchestrator after flush_complete — so 2
    // calls per completed turn is the expected count.
    expect(resetSpy).toHaveBeenCalledTimes(2);
    expect(orchestrator.state).toBe('listening');
    expect(agentSession.sendText).toHaveBeenCalledTimes(1);

    // ----- Second turn -----
    // Emit a second transcript and speech_end to start a new turn.
    sttSession.emit('transcript', {
      text: 'Second question!',
      confidence: 0.87,
      words: [],
      isFinal: true,
    });
    sttSession.emit('speech_end');
    await vi.advanceTimersByTimeAsync(0);

    // Agent must have been called a second time.
    expect(agentSession.sendText).toHaveBeenCalledTimes(2);
    expect(agentSession.sendText).toHaveBeenNthCalledWith(
      2,
      'Second question!',
      expect.objectContaining({ endpointReason: 'punctuation' }),
    );

    // Complete the second turn.
    ttsSession.emit('flush_complete');
    expect(orchestrator.state).toBe('listening');

    // After two full turns, reset should have been called 4 times total
    // (2 per turn: once internally in _emitTurnComplete, once from orchestrator).
    expect(resetSpy).toHaveBeenCalledTimes(4);
  });
});
