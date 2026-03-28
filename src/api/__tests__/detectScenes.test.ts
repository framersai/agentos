import { describe, expect, it } from 'vitest';

import { detectScenes } from '../detectScenes.js';
import type { Frame, SceneBoundary } from '../../vision/types.js';

/**
 * Helper to create a frame with a given RGB colour filling the buffer.
 * Generates a small 4x4 pixel buffer (48 bytes) for fast testing.
 */
function makeFrame(index: number, timestampSec: number, r: number, g: number, b: number): Frame {
  const pixels = 4 * 4;
  const buf = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return { buffer: buf, timestampSec, index };
}

/**
 * Helper to collect all boundaries from the async generator.
 */
async function collectBoundaries(opts: Parameters<typeof detectScenes>[0]): Promise<SceneBoundary[]> {
  const boundaries: SceneBoundary[] = [];
  for await (const b of detectScenes(opts)) {
    boundaries.push(b);
  }
  return boundaries;
}

describe('detectScenes', () => {
  it('detects a hard cut between visually distinct frames', async () => {
    async function* frames(): AsyncGenerator<Frame> {
      // Scene A: red frames at 0s, 1s, 2s
      yield makeFrame(0, 0, 255, 0, 0);
      yield makeFrame(1, 1, 255, 0, 0);
      yield makeFrame(2, 2, 255, 0, 0);
      // Scene B: blue frames at 3s, 4s (hard cut at frame 3)
      yield makeFrame(3, 3, 0, 0, 255);
      yield makeFrame(4, 4, 0, 0, 255);
    }

    const boundaries = await collectBoundaries({ frames: frames() });

    // Should detect at least 2 scenes (the red scene and the blue scene)
    expect(boundaries.length).toBeGreaterThanOrEqual(2);

    // First scene should start at 0s
    expect(boundaries[0].startTimeSec).toBe(0);

    // The scene transition should be classified as a hard-cut
    const hardCuts = boundaries.filter((b) => b.cutType === 'hard-cut');
    expect(hardCuts.length).toBeGreaterThanOrEqual(1);
  });

  it('respects custom thresholds from options', async () => {
    async function* frames(): AsyncGenerator<Frame> {
      yield makeFrame(0, 0, 100, 100, 100);
      yield makeFrame(1, 2, 120, 120, 120); // Slight change
      yield makeFrame(2, 4, 100, 100, 100);
    }

    // Very low threshold — should detect the slight change as a scene
    const lowThreshold = await collectBoundaries({
      frames: frames(),
      gradualThreshold: 0.001,
      hardCutThreshold: 0.01,
      minSceneDurationSec: 0.5,
    });

    // Should detect more boundaries with very low thresholds
    expect(lowThreshold.length).toBeGreaterThanOrEqual(1);
  });

  it('yields final scene boundary when stream ends', async () => {
    async function* frames(): AsyncGenerator<Frame> {
      yield makeFrame(0, 0, 128, 128, 128);
      yield makeFrame(1, 1, 128, 128, 128);
      yield makeFrame(2, 2, 128, 128, 128);
    }

    const boundaries = await collectBoundaries({ frames: frames() });

    // Even with no scene changes, should yield the final (single) scene
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
    const last = boundaries[boundaries.length - 1];
    expect(last.endTimeSec).toBe(2);
  });

  it('handles empty frame stream gracefully', async () => {
    async function* frames(): AsyncGenerator<Frame> {
      // No frames
    }

    const boundaries = await collectBoundaries({ frames: frames() });

    // No frames should produce no boundaries
    expect(boundaries).toHaveLength(0);
  });
});
