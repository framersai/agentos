import { describe, it, expect } from 'vitest';
import { AudioRingBuffer } from '../AudioRingBuffer.js';
import type { AudioFrame } from '../types.js';

function mkFrame(samples: number, ts: number, sampleRate = 16000): AudioFrame {
  return { samples: new Float32Array(samples), sampleRate, timestamp: ts };
}

describe('AudioRingBuffer', () => {
  it('retains frames under capacity', () => {
    const buf = new AudioRingBuffer({ capacityMs: 1000, sampleRate: 16000 });
    buf.push(mkFrame(320, 0)); // 20ms
    buf.push(mkFrame(320, 20)); // 40ms total
    const frames = buf.snapshot();
    expect(frames).toHaveLength(2);
    expect(buf.durationMs()).toBeCloseTo(40, 0);
  });

  it('evicts oldest frames past capacity', () => {
    const buf = new AudioRingBuffer({ capacityMs: 100, sampleRate: 16000 });
    for (let i = 0; i < 10; i++) buf.push(mkFrame(320, i * 20));
    const frames = buf.snapshot();
    expect(frames.length).toBeLessThanOrEqual(6);
    expect(buf.durationMs()).toBeLessThanOrEqual(120);
    expect(frames[frames.length - 1].timestamp).toBe(9 * 20);
  });

  it('clear() drops all frames', () => {
    const buf = new AudioRingBuffer({ capacityMs: 1000, sampleRate: 16000 });
    buf.push(mkFrame(320, 0));
    buf.clear();
    expect(buf.snapshot()).toHaveLength(0);
    expect(buf.durationMs()).toBe(0);
  });

  it('handles a single frame gracefully', () => {
    const buf = new AudioRingBuffer({ capacityMs: 100, sampleRate: 16000 });
    buf.push(mkFrame(320, 0));
    expect(buf.snapshot()).toHaveLength(1);
    expect(buf.durationMs()).toBeCloseTo(20, 0);
  });

  it('preserves the most recent frame when capacity is tiny', () => {
    const buf = new AudioRingBuffer({ capacityMs: 1, sampleRate: 16000 });
    for (let i = 0; i < 5; i++) buf.push(mkFrame(320, i * 20));
    const frames = buf.snapshot();
    // Always keep at least the most recent frame.
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[frames.length - 1].timestamp).toBe(80);
  });
});
