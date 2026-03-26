/**
 * @file voice-node-builder.test.ts
 * @description Unit tests for the `voiceNode()` DSL builder and {@link VoiceNodeBuilder}.
 *
 * Covers:
 *
 * 1. `build()` returns a `GraphNode` with `type: 'voice'`.
 * 2. `VoiceNodeConfig` fields are forwarded to `executorConfig.voiceConfig`.
 * 3. `on()` maps exit reasons to target node ids in `edges`.
 * 4. `on()` accepts an object with an `id` property as the target.
 * 5. Mandatory `GraphNode` fields (`executionMode`, `effectClass`, `checkpoint`)
 *    are set correctly for voice nodes.
 */

import { describe, it, expect } from 'vitest';
import { voiceNode, VoiceNodeBuilder } from '../builders/VoiceNodeBuilder.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('voiceNode builder', () => {
  it('builds a GraphNode with type voice', () => {
    const node = voiceNode('listen', { mode: 'conversation' }).build();
    expect(node.id).toBe('listen');
    expect(node.type).toBe('voice');
    // executorConfig.type must match node.type for executor dispatch.
    expect(node.executorConfig.type).toBe('voice');
  });

  it('sets VoiceNodeConfig', () => {
    const node = voiceNode('listen', { mode: 'conversation', stt: 'deepgram', maxTurns: 5 }).build();
    // Config fields pass through to voiceConfig for the VoiceNodeExecutor.
    expect((node.executorConfig as any).voiceConfig.stt).toBe('deepgram');
    expect((node.executorConfig as any).voiceConfig.maxTurns).toBe(5);
  });

  it('maps exit reasons to edges', () => {
    const node = voiceNode('listen', { mode: 'conversation' })
      .on('completed', 'summarize')
      .on('interrupted', 'listen')
      .on('hangup', 'end')
      .build();
    // Each on() call populates a key in the edges map.
    expect((node as any).edges).toEqual({
      completed: 'summarize',
      interrupted: 'listen',
      hangup: 'end',
    });
  });

  it('accepts object with id as target', () => {
    // This enables referencing other builder instances directly:
    //   .on('completed', otherBuilder)
    const node = voiceNode('listen', { mode: 'conversation' })
      .on('completed', { id: 'next-node' })
      .build();
    expect((node as any).edges.completed).toBe('next-node');
  });

  it('sets correct mandatory GraphNode fields', () => {
    const node = voiceNode('v', { mode: 'listen-only' }).build();
    // Voice nodes are multi-turn loops (react_bounded), touch the real
    // world (external), and checkpoint before execution (before).
    expect(node.executionMode).toBe('react_bounded');
    expect(node.effectClass).toBe('external');
    expect(node.checkpoint).toBe('before');
  });
});
