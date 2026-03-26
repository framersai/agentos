/**
 * @module voice-pipeline/__tests__/VoiceInterruptError.spec
 *
 * Unit tests for VoiceInterruptError and the two public integration methods
 * added to VoicePipelineOrchestrator: waitForUserTurn() and pushToTTS().
 *
 * ## What is tested
 *
 * ### VoiceInterruptError
 * - name property is 'VoiceInterruptError'
 * - message is 'Voice session interrupted by user'
 * - Structured context fields (interruptedText, userSpeech, playedDurationMs) are stored
 * - instanceof chain works (VoiceInterruptError -> Error)
 * - Can be caught and inspected as a typed error
 * - name field is stable (own property, not prototype)
 *
 * ### VoicePipelineOrchestrator.waitForUserTurn
 * - Resolves when turn_complete is emitted
 * - Only resolves once (one-shot via `once()`)
 * - Carries all TurnCompleteEvent fields
 *
 * ### VoicePipelineOrchestrator.pushToTTS
 * - Throws if no active TTS session
 * - Pushes plain string tokens and flushes
 * - Iterates async iterable and pushes each chunk
 * - Flushes exactly once for async iterables
 * - Works with empty async iterables (no tokens, still flushes)
 * - Throws after session is stopped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { VoiceInterruptError } from '../VoiceInterruptError.js';
import { VoicePipelineOrchestrator } from '../VoicePipelineOrchestrator.js';
import type {
  BargeinAction,
  IBargeinHandler,
  IEndpointDetector,
  IStreamTransport,
  IStreamingSTT,
  IStreamingTTS,
  StreamingSTTSession,
  StreamingTTSSession,
  TurnCompleteEvent,
  VoicePipelineConfig,
} from '../types.js';

// ============================================================================
// VoiceInterruptError unit tests
// ============================================================================

describe('VoiceInterruptError', () => {
  it('should have name "VoiceInterruptError" and correct message', () => {
    const err = new VoiceInterruptError({
      interruptedText: 'hello',
      userSpeech: 'wait',
      playedDurationMs: 500,
    });
    expect(err.name).toBe('VoiceInterruptError');
    expect(err.message).toBe('Voice session interrupted by user');
  });

  it('should store all structured context fields', () => {
    const err = new VoiceInterruptError({
      interruptedText: 'I was saying',
      userSpeech: 'stop',
      playedDurationMs: 1200,
    });
    expect(err.interruptedText).toBe('I was saying');
    expect(err.userSpeech).toBe('stop');
    expect(err.playedDurationMs).toBe(1200);
  });

  it('should be an instance of Error (prototype chain intact)', () => {
    const err = new VoiceInterruptError({
      interruptedText: '',
      userSpeech: '',
      playedDurationMs: 0,
    });
    expect(err).toBeInstanceOf(Error);
  });

  /**
   * Validates the primary catch pattern: throw, catch via instanceof,
   * and access typed fields without casting.
   */
  it('should be catchable and inspectable as a typed error via instanceof', () => {
    function throwIt() {
      throw new VoiceInterruptError({
        interruptedText: 'speaking...',
        userSpeech: 'hey',
        playedDurationMs: 300,
      });
    }

    let caught: unknown;
    try {
      throwIt();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(VoiceInterruptError);
    expect(caught).toBeInstanceOf(Error);
    const typed = caught as VoiceInterruptError;
    expect(typed.playedDurationMs).toBe(300);
  });

  /**
   * The name field is set as a class field (own property) rather than via
   * the prototype, ensuring it survives serialisation and can be used for
   * instanceof-free type checks across process boundaries.
   */
  it('should have name as an own property (not from prototype)', () => {
    const err = new VoiceInterruptError({
      interruptedText: 'hi',
      userSpeech: 'bye',
      playedDurationMs: 100,
    });
    expect(err.name).toBe('VoiceInterruptError');
    expect(Object.prototype.hasOwnProperty.call(err, 'name')).toBe(true);
  });
});

// ============================================================================
// Mock factories (shared between waitForUserTurn and pushToTTS tests)
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

function makeConfig(overrides?: Partial<VoicePipelineConfig>): VoicePipelineConfig {
  return {
    stt: 'mock-stt',
    tts: 'mock-tts',
    maxTurnDurationMs: 30_000,
    ...overrides,
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

// ============================================================================
// VoicePipelineOrchestrator.waitForUserTurn
// ============================================================================

describe('VoicePipelineOrchestrator.waitForUserTurn', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let sttSession: ReturnType<typeof createMockSTTSession>;
  let ttsSession: ReturnType<typeof createMockTTSSession>;
  let endpoint: ReturnType<typeof createMockEndpoint>;
  let orchestrator: VoicePipelineOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    sttSession = createMockSTTSession();
    ttsSession = createMockTTSSession();
    endpoint = createMockEndpoint();
    orchestrator = new VoicePipelineOrchestrator(makeConfig());
  });

  async function startSession() {
    return orchestrator.startSession(transport, { sendText: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: async function* () {} }), abort: vi.fn() }, {
      streamingSTT: createMockSTT(sttSession),
      streamingTTS: createMockTTS(ttsSession),
      endpointDetector: endpoint,
      bargeinHandler: createMockBargeinHandler(),
    });
  }

  it('should resolve when turn_complete is emitted on the orchestrator', async () => {
    await startSession();
    const turnEvent = makeTurnComplete();

    // Start the wait -- do NOT await yet
    const waitPromise = orchestrator.waitForUserTurn();

    // Emit turn_complete (waitForUserTurn uses `once()` on the orchestrator)
    orchestrator.emit('turn_complete', turnEvent);

    const resolved = await waitPromise;
    expect(resolved).toEqual(turnEvent);
  });

  /** `once()` ensures the listener auto-removes after the first emission. */
  it('should only resolve with the first turn_complete event (one-shot)', async () => {
    await startSession();
    const first = makeTurnComplete();
    const second = { ...makeTurnComplete(), transcript: 'Second turn' };

    const waitPromise = orchestrator.waitForUserTurn();

    orchestrator.emit('turn_complete', first);
    orchestrator.emit('turn_complete', second);

    const resolved = await waitPromise;
    // Should have resolved with the first event only
    expect(resolved.transcript).toBe(first.transcript);
  });

  it('should carry all TurnCompleteEvent fields through to the resolution', async () => {
    await startSession();
    const event: TurnCompleteEvent = {
      transcript: 'test transcript',
      confidence: 0.88,
      durationMs: 2400,
      reason: 'silence_timeout',
    };

    const waitPromise = orchestrator.waitForUserTurn();
    orchestrator.emit('turn_complete', event);

    const resolved = await waitPromise;
    expect(resolved.transcript).toBe('test transcript');
    expect(resolved.confidence).toBe(0.88);
    expect(resolved.durationMs).toBe(2400);
    expect(resolved.reason).toBe('silence_timeout');
  });
});

// ============================================================================
// VoicePipelineOrchestrator.pushToTTS
// ============================================================================

describe('VoicePipelineOrchestrator.pushToTTS', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let sttSession: ReturnType<typeof createMockSTTSession>;
  let ttsSession: ReturnType<typeof createMockTTSSession>;
  let endpoint: ReturnType<typeof createMockEndpoint>;
  let orchestrator: VoicePipelineOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    sttSession = createMockSTTSession();
    ttsSession = createMockTTSSession();
    endpoint = createMockEndpoint();
    orchestrator = new VoicePipelineOrchestrator(makeConfig());
  });

  async function startSession() {
    return orchestrator.startSession(
      transport,
      {
        sendText: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {},
        }),
        abort: vi.fn(),
      },
      {
        streamingSTT: createMockSTT(sttSession),
        streamingTTS: createMockTTS(ttsSession),
        endpointDetector: endpoint,
        bargeinHandler: createMockBargeinHandler(),
      },
    );
  }

  /** pushToTTS should fail if called before startSession. */
  it('should throw if no active TTS session exists', async () => {
    // Do NOT call startSession -- _ttsSession is null
    await expect(orchestrator.pushToTTS('hello')).rejects.toThrow('No active TTS session');
  });

  it('should call pushTokens and flush for a plain string', async () => {
    await startSession();
    await orchestrator.pushToTTS('Hello world');
    expect(ttsSession.pushTokens).toHaveBeenCalledWith('Hello world');
    expect(ttsSession.flush).toHaveBeenCalled();
  });

  /** Each chunk from the async iterable should be pushed individually. */
  it('should call pushTokens for each chunk of an async iterable', async () => {
    await startSession();

    async function* tokens() {
      yield 'Hello';
      yield ' ';
      yield 'world';
    }

    await orchestrator.pushToTTS(tokens());

    expect(ttsSession.pushTokens).toHaveBeenCalledTimes(3);
    expect(ttsSession.pushTokens).toHaveBeenNthCalledWith(1, 'Hello');
    expect(ttsSession.pushTokens).toHaveBeenNthCalledWith(2, ' ');
    expect(ttsSession.pushTokens).toHaveBeenNthCalledWith(3, 'world');
    expect(ttsSession.flush).toHaveBeenCalledTimes(1);
  });

  it('should call flush exactly once after iterating all tokens', async () => {
    await startSession();

    async function* tokens() {
      yield 'token1';
      yield 'token2';
    }

    await orchestrator.pushToTTS(tokens());
    expect(ttsSession.flush).toHaveBeenCalledTimes(1);
  });

  /** An empty iterable should still call flush to signal end-of-utterance. */
  it('should flush even with an empty async iterable (no tokens emitted)', async () => {
    await startSession();

    async function* empty() {
      // yields nothing
    }

    await orchestrator.pushToTTS(empty());
    expect(ttsSession.pushTokens).not.toHaveBeenCalled();
    expect(ttsSession.flush).toHaveBeenCalledTimes(1);
  });

  it('should throw after the session has been stopped', async () => {
    await startSession();
    await orchestrator.stopSession('test');
    await expect(orchestrator.pushToTTS('hello')).rejects.toThrow('No active TTS session');
  });
});
