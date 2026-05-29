/**
 * @file voice-graph-companion-ivr.test.ts
 * @description Tests for the speak-only delivery path (VoiceNodeExecutor) and
 * the injected-pipeline path (VoiceTransportAdapter) added to make the voice
 * graph runtime usable for real conversational IVR flows (e.g. wilds companion
 * voice). Both use plain EventEmitter mocks — no real audio/STT/TTS.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceNodeExecutor } from '../runtime/VoiceNodeExecutor.js';
import { VoiceTransportAdapter } from '../runtime/VoiceTransportAdapter.js';
import { voiceNode } from '../builders/VoiceNodeBuilder.js';

describe('Voice graph — companion IVR additions', () => {
  it('speak-only node delivers speakText via the adapter and routes completed', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const session = new EventEmitter();
    const transport: any = new EventEmitter();
    transport._voiceSession = session;
    const state: any = {
      scratch: {
        voiceTransport: transport,
        voiceAdapter: { deliverNodeOutput: deliver },
      },
    };

    const node = voiceNode('greet', { mode: 'speak-only', speakText: 'Hey, good to hear you.' })
      .on('completed', 'conversation')
      .build();

    const executor = new VoiceNodeExecutor(vi.fn());
    const result = await executor.execute(node, state);

    expect(deliver).toHaveBeenCalledWith('greet', 'Hey, good to hear you.');
    expect(result.success).toBe(true);
    expect((result.output as any).exitReason).toBe('completed');
    expect(result.routeTarget).toBe('conversation');
  });

  it('speak-only node with no adapter still completes (no throw)', async () => {
    const transport: any = new EventEmitter();
    transport._voiceSession = new EventEmitter();
    const state: any = { scratch: { voiceTransport: transport } };
    const node = voiceNode('farewell', { mode: 'speak-only', speakText: 'Talk soon.' })
      .on('completed', 'end')
      .build();

    const result = await new VoiceNodeExecutor(vi.fn()).execute(node, state);
    expect(result.success).toBe(true);
    expect(result.routeTarget).toBe('end');
  });

  it('VoiceTransportAdapter uses an injected pipeline + session (no bare build, no dynamic import)', async () => {
    const pushToTTS = vi.fn().mockResolvedValue(undefined);
    const injectedPipeline = { pushToTTS, waitForUserTurn: vi.fn() };
    const session = new EventEmitter();
    const transport: any = new EventEmitter();

    const adapter = new VoiceTransportAdapter({}, transport, vi.fn(), {
      pipeline: injectedPipeline,
      session,
    });

    const state: any = { scratch: {} };
    await adapter.init(state);

    expect(state.scratch.voiceTransport).toBe(transport);
    expect(state.scratch.voiceAdapter).toBe(adapter);
    expect(transport._voiceSession).toBe(session);

    await adapter.deliverNodeOutput('greet', 'hi');
    expect(pushToTTS).toHaveBeenCalledWith('hi');
  });
});
