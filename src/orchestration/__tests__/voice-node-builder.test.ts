/**
 * @file voice-node-builder.test.ts
 * @description Unit tests for the voiceNode() DSL builder and VoiceNodeBuilder.
 *
 * Covers:
 * 1. build() returns a GraphNode with type 'voice'.
 * 2. VoiceNodeConfig fields are forwarded to executorConfig.voiceConfig.
 * 3. on() maps exit reasons to target node ids in edges.
 * 4. on() accepts an object with an id property as the target.
 * 5. Mandatory GraphNode fields (executionMode, effectClass, checkpoint) are set correctly.
 */

import { describe, it, expect } from 'vitest';
import { voiceNode, VoiceNodeBuilder } from '../builders/VoiceNodeBuilder.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('voiceNode builder', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────
  it('builds a GraphNode with type voice', () => {
    const node = voiceNode('listen', { mode: 'conversation' }).build();
    expect(node.id).toBe('listen');
    expect(node.type).toBe('voice');
    expect(node.executorConfig.type).toBe('voice');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it('sets VoiceNodeConfig', () => {
    const node = voiceNode('listen', { mode: 'conversation', stt: 'deepgram', maxTurns: 5 }).build();
    expect((node.executorConfig as any).voiceConfig.stt).toBe('deepgram');
    expect((node.executorConfig as any).voiceConfig.maxTurns).toBe(5);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it('maps exit reasons to edges', () => {
    const node = voiceNode('listen', { mode: 'conversation' })
      .on('completed', 'summarize')
      .on('interrupted', 'listen')
      .on('hangup', 'end')
      .build();
    expect((node as any).edges).toEqual({
      completed: 'summarize',
      interrupted: 'listen',
      hangup: 'end',
    });
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it('accepts object with id as target', () => {
    const node = voiceNode('listen', { mode: 'conversation' })
      .on('completed', { id: 'next-node' })
      .build();
    expect((node as any).edges.completed).toBe('next-node');
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it('sets correct mandatory GraphNode fields', () => {
    const node = voiceNode('v', { mode: 'listen-only' }).build();
    expect(node.executionMode).toBe('react_bounded');
    expect(node.effectClass).toBe('external');
    expect(node.checkpoint).toBe('before');
  });
});
