/**
 * @file voice-transport-adapter.test.ts
 * @description Unit tests for VoiceTransportAdapter.
 *
 * Covers:
 * 1. init() injects voiceTransport into state.scratch.
 * 2. init() emits a voice_session started event.
 * 3. getNodeInput() resolves when the transport emits turn_complete.
 * 4. getNodeInput() emits a voice_turn_complete event with the correct nodeId.
 * 5. deliverNodeOutput() emits a voice_audio outbound event.
 * 6. getNodeInput() throws when called before init().
 * 7. dispose() emits a voice_session ended event.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceTransportAdapter } from '../runtime/VoiceTransportAdapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh adapter + mock transport + event collector for each test.
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
  // ── Test 1 ──────────────────────────────────────────────────────────────
  it('init injects voiceTransport into state.scratch', async () => {
    const { adapter, transport } = setup();
    const state: any = { scratch: {} };
    await adapter.init(state);
    expect(state.scratch.voiceTransport).toBe(transport);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it('init emits voice_session started', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    expect(events[0]).toEqual(
      expect.objectContaining({ type: 'voice_session', action: 'started' }),
    );
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it('getNodeInput resolves on turn_complete event', async () => {
    const { adapter, transport } = setup();
    await adapter.init({ scratch: {} } as any);
    const inputPromise = adapter.getNodeInput('greet');
    transport.emit('turn_complete', { transcript: 'Hello there', reason: 'punctuation' });
    const result = await inputPromise;
    expect(result).toBe('Hello there');
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it('getNodeInput emits voice_turn_complete event', async () => {
    const { adapter, transport, events } = setup();
    await adapter.init({ scratch: {} } as any);
    const inputPromise = adapter.getNodeInput('greet');
    transport.emit('turn_complete', { transcript: 'Hi', reason: 'silence' });
    await inputPromise;
    const turnEvents = events.filter((e) => e.type === 'voice_turn_complete');
    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0].nodeId).toBe('greet');
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it('deliverNodeOutput emits voice_audio event', async () => {
    const { adapter, events } = setup();
    await adapter.init({ scratch: {} } as any);
    await adapter.deliverNodeOutput('respond', 'Hello back!');
    const audioEvents = events.filter((e) => e.type === 'voice_audio');
    expect(audioEvents).toHaveLength(1);
    expect(audioEvents[0].direction).toBe('outbound');
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it('throws if not initialized', async () => {
    const { adapter } = setup();
    await expect(adapter.getNodeInput('x')).rejects.toThrow('not initialized');
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
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
