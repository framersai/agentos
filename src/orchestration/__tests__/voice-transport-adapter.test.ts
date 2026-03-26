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

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceTransportAdapter } from '../runtime/VoiceTransportAdapter.js';

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

  it('getNodeInput resolves on turn_complete event', async () => {
    const { adapter, transport } = setup();
    await adapter.init({ scratch: {} } as any);
    // Start waiting for input BEFORE emitting the event (simulates async I/O).
    const inputPromise = adapter.getNodeInput('greet');
    transport.emit('turn_complete', { transcript: 'Hello there', reason: 'punctuation' });
    const result = await inputPromise;
    expect(result).toBe('Hello there');
  });

  it('getNodeInput emits voice_turn_complete event', async () => {
    const { adapter, transport, events } = setup();
    await adapter.init({ scratch: {} } as any);
    const inputPromise = adapter.getNodeInput('greet');
    transport.emit('turn_complete', { transcript: 'Hi', reason: 'silence' });
    await inputPromise;
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
