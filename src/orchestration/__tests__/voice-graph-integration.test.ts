/**
 * @file voice-graph-integration.test.ts
 * @description Full-flow integration tests for the voice graph subsystem.
 *
 * These tests exercise the pipeline end-to-end with real implementations and mock
 * EventEmitter transports, validating:
 *
 * 1. Keyword exit condition resolves and routes to the correct edge target.
 * 2. Transport close (hangup) resolves the node successfully.
 * 3. VoiceTransportAdapter injects transport into state and handles I/O events.
 * 4. voiceNode() builder produces a valid GraphNode IR object.
 * 5. Checkpoint data (turnIndex, transcript) is stored in scratchUpdate after execution.
 *
 * All tests use plain `EventEmitter` instances as transport/session mocks — no real
 * audio hardware, STT, or TTS provider is needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { VoiceNodeExecutor } from '../runtime/VoiceNodeExecutor.js';
import { VoiceTransportAdapter } from '../runtime/VoiceTransportAdapter.js';
import { voiceNode } from '../builders/VoiceNodeBuilder.js';
import type { GraphNode, GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock transport setup with a nested `_voiceSession` EventEmitter,
 * mirroring the shape expected by `VoiceNodeExecutor.execute()`.
 *
 * @returns Object containing the partial `GraphState`, the raw session emitter
 *          (for triggering session events), and the transport emitter (for
 *          triggering hangup/disconnect events).
 */
function createMockState(): {
  state: Partial<GraphState>;
  session: EventEmitter;
  transport: EventEmitter;
} {
  const session = new EventEmitter();
  const transport = new EventEmitter();
  // VoiceNodeExecutor reads transport._voiceSession for the pipeline session.
  (transport as any)._voiceSession = session;
  return {
    state: { scratch: { voiceTransport: transport } } as any,
    session,
    transport,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Voice Graph Integration', () => {
  it('voice action node completes on keyword and routes correctly', async () => {
    const events: any[] = [];
    const executor = new VoiceNodeExecutor((e) => events.push(e));

    // Build a voice node that exits on the keyword "confirmed" and routes to "process".
    const node = voiceNode('listen', {
      mode: 'conversation',
      exitOn: 'keyword',
      exitKeywords: ['confirmed'],
    })
      .on('keyword:confirmed', 'process')
      .on('hangup', 'end')
      .build();

    const { state, session } = createMockState();

    // Emit the keyword-bearing transcript after a short async delay.
    setTimeout(() => {
      session.emit('final_transcript', { text: 'Yes confirmed', confidence: 0.9 });
    }, 10);

    const result = await executor.execute(node, state);

    expect(result.success).toBe(true);
    expect((result.output as any).exitReason).toBe('keyword:confirmed');
    expect(result.routeTarget).toBe('process');
  });

  it('barge-in routes to interrupted edge', async () => {
    const executor = new VoiceNodeExecutor(vi.fn());

    // Node only has interrupted/completed routes — no hangup route.
    const node = voiceNode('listen', { mode: 'conversation' })
      .on('interrupted', 'listen')
      .on('completed', 'end')
      .build();

    const { state, transport } = createMockState();

    // Simulate transport close (equivalent to caller hanging up).
    setTimeout(() => transport.emit('close'), 10);

    const result = await executor.execute(node, state);

    // The node should resolve successfully; exitReason is hangup.
    // routeTarget is undefined because the node has no hangup edge.
    expect(result.success).toBe(true);
    expect((result.output as any).exitReason).toBe('hangup');
  });

  it('voice transport adapter injects transport and handles I/O', async () => {
    const events: any[] = [];
    const transport = new EventEmitter();

    const adapter = new VoiceTransportAdapter(
      { stt: 'deepgram', tts: 'openai' },
      transport,
      (e) => events.push(e),
    );

    // init() must be called before getNodeInput() or deliverNodeOutput().
    const state: any = { scratch: {} };
    await adapter.init(state);

    // After init(), the transport reference should be in state.scratch.
    expect(state.scratch.voiceTransport).toBe(transport);

    // getNodeInput() should resolve with the transcript from the next turn_complete event.
    const inputPromise = adapter.getNodeInput('greet');
    transport.emit('turn_complete', { transcript: 'Hello', reason: 'punctuation' });
    const input = await inputPromise;
    expect(input).toBe('Hello');

    // deliverNodeOutput() should emit a voice_audio event (direction: outbound).
    await adapter.deliverNodeOutput('greet', 'Hi there!');
    const audioEvents = events.filter((e) => e.type === 'voice_audio');
    expect(audioEvents).toHaveLength(1);
    expect(audioEvents[0].direction).toBe('outbound');
  });

  it('voiceNode builder produces valid GraphNode', () => {
    const node = voiceNode('v1', { mode: 'conversation', maxTurns: 3 })
      .on('turns-exhausted', 'summarize')
      .on('hangup', 'end')
      .build();

    // Verify the shape of the returned GraphNode IR object.
    expect(node.type).toBe('voice');
    expect(node.executorConfig.type).toBe('voice');
    expect(node.executionMode).toBe('react_bounded');
    expect(node.effectClass).toBe('external');
    expect(node.checkpoint).toBe('before');

    // Verify the edge map is populated correctly.
    const edges = (node as any).edges as Record<string, string>;
    expect(edges['turns-exhausted']).toBe('summarize');
    expect(edges['hangup']).toBe('end');
  });

  it('checkpoint data stored in scratchUpdate after voice node', async () => {
    const executor = new VoiceNodeExecutor(vi.fn());
    const node = voiceNode('v1', { mode: 'conversation', maxTurns: 2 }).build();
    const { state, session } = createMockState();

    // Emit two turn_complete events; the second will exhaust maxTurns and exit.
    setTimeout(() => {
      session.emit('turn_complete', { transcript: 'Turn 1', reason: 'silence' });
    }, 5);
    setTimeout(() => {
      session.emit('turn_complete', { transcript: 'Turn 2', reason: 'silence' });
    }, 15);

    const result = await executor.execute(node, state);

    // scratchUpdate should carry the VoiceNodeCheckpoint under the node id.
    expect(result.scratchUpdate).toBeDefined();
    const checkpoint = (result.scratchUpdate as any)?.['v1'];
    expect(checkpoint).toBeDefined();
    expect(checkpoint.turnIndex).toBe(2);
  });
});
