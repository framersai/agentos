/**
 * @file voice-transport-adapter.test.ts
 * @description Unit tests for {@link VoiceTransportAdapter}.
 *
 * Covers the full lifecycle contract:
 *
 * 1. `init()` injects `voiceTransport` into `state.scratch`.
 * 2. `init()` emits a `voice_session` started event.
 * 3. `getNodeInput()` resolves when the transport emits `turn_complete`.
 * 4. `getNodeInput()` emits a `voice_turn_complete` event with the correct `nodeId`.
 * 5. `deliverNodeOutput()` emits a `voice_audio` outbound event.
 * 6. `getNodeInput()` throws when called before `init()`.
 * 7. `dispose()` emits a `voice_session` ended event.
 *
 * All tests use a plain `EventEmitter` as the transport mock.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceTransportAdapter } from '../runtime/VoiceTransportAdapter.js';

// ---------------------------------------------------------------------------
// Pipeline mock — module-scoped, applies to all tests.
// The pipeline is lazily imported by init(), so all adapters that call init()
// will get a pipeline instance with mocked waitForUserTurn / pushToTTS.
// ---------------------------------------------------------------------------

let lastPipelineMock: any = null;

vi.mock('../../voice-pipeline/VoicePipelineOrchestrator.js', () => {
  return {
    VoicePipelineOrchestrator: vi.fn().mockImplementation(() => {
      lastPipelineMock = {
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        pushToTTS: vi.fn().mockResolvedValue(undefined),
        waitForUserTurn: vi.fn().mockResolvedValue({
          transcript: 'mocked turn',
          confidence: 0.95,
          durationMs: 2000,
          reason: 'punctuation',
        }),
        get state() { return 'listening'; },
      };
      return lastPipelineMock;
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh adapter + mock transport + event collector for each test.
 *
 * @returns Object with `transport` (mock EventEmitter), `events` (collected
 *          GraphEvents), and `adapter` (the VoiceTransportAdapter under test).
 */
function setup() {
  const transport = new EventEmitter();
  const events: any[] = [];
  const adapter = new VoiceTransportAdapter(
    { stt: 'deepgram', tts: 'openai' },
    transport,
    (e) => events.push(e),
  );
  return { transport, events, adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceTransportAdapter', () => {
  it('init injects voiceTransport into state.scratch', async () => {
    const { adapter, transport } = setup();
    const state: any = { scratch: {} };
    await adapter.init(state);
    // After init(), the transport reference must be accessible in scratch
    // so that VoiceNodeExecutor can find it.
    expect(state.scratch.voiceTransport).toBe(transport);
  });

  it('init emits voice_session started', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    expect(events[0]).toEqual(
      expect.objectContaining({ type: 'voice_session', action: 'started' }),
    );
  });

  it('getNodeInput resolves with transcript from pipeline', async () => {
    const { adapter } = setup();
    await adapter.init({ scratch: {} } as any);
    // With the pipeline mock, getNodeInput delegates to waitForUserTurn()
    // which returns { transcript: 'mocked turn' }.
    const result = await adapter.getNodeInput('greet');
    expect(result).toBe('mocked turn');
  });

  it('getNodeInput emits voice_turn_complete event', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.getNodeInput('greet');
    // Filter to turn_complete events and verify the nodeId tag.
    const turnEvents = events.filter((e) => e.type === 'voice_turn_complete');
    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0].nodeId).toBe('greet');
  });

  it('deliverNodeOutput emits voice_audio event', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.deliverNodeOutput('respond', 'Hello back!');
    const audioEvents = events.filter((e) => e.type === 'voice_audio');
    expect(audioEvents).toHaveLength(1);
    expect(audioEvents[0].direction).toBe('outbound');
  });

  it('throws if not initialized', async () => {
    const { adapter } = setup();
    // Calling getNodeInput before init() must throw to prevent silent failures.
    await expect(adapter.getNodeInput('x')).rejects.toThrow('not initialized');
  });

  it('dispose emits voice_session ended', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.dispose();
    const endEvents = events.filter(
      (e) => e.type === 'voice_session' && e.action === 'ended',
    );
    expect(endEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pipeline wiring tests (uses module-scoped mock from above)
// ---------------------------------------------------------------------------

describe('VoiceTransportAdapter pipeline wiring', () => {
  it('deliverNodeOutput calls pipeline.pushToTTS with string', async () => {
    lastPipelineMock = null;
    const { adapter } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.deliverNodeOutput('greet', 'Hello caller!');
    expect(lastPipelineMock).not.toBeNull();
    expect(lastPipelineMock.pushToTTS).toHaveBeenCalledWith('Hello caller!');
  });

  it('getNodeInput delegates to pipeline.waitForUserTurn', async () => {
    lastPipelineMock = null;
    const { adapter } = setup();
    await adapter.init({ scratch: {} } as any);
    const input = await adapter.getNodeInput('listen');
    expect(input).toBe('mocked turn');
  });

  it('dispose calls pipeline.stopSession', async () => {
    lastPipelineMock = null;
    const { adapter } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.dispose();
    expect(lastPipelineMock).not.toBeNull();
    expect(lastPipelineMock.stopSession).toHaveBeenCalled();
  });
});
