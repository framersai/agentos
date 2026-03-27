/**
 * @module core/video/__tests__/SceneDetector.test
 *
 * Unit tests for the {@link SceneDetector} class.
 *
 * Tests use synthetic 4x4 RGB frames with known solid colours to verify
 * scene boundary detection, histogram computation, and configuration
 * behaviour without requiring actual video data or image processing
 * libraries.
 *
 * ## Test categories
 *
 * 1. **Hard cut detection** — large colour difference triggers scene change
 * 2. **Identical frames** — no scene change when frames are the same
 * 3. **Streaming detection** — multiple scene boundaries from async frame stream
 * 4. **Histogram identity** — histogramDiff returns 0 for identical buffers
 * 5. **Histogram divergence** — histogramDiff returns high score for opposite colours
 * 6. **Min scene duration** — rapid changes suppressed by minSceneDurationSec
 */

import { describe, it, expect } from 'vitest';
import { SceneDetector } from '../../vision/SceneDetector.js';
import type { Frame } from '../../vision/types.js';

// ---------------------------------------------------------------------------
// Test helper — create a 4x4 solid-colour RGB frame
// ---------------------------------------------------------------------------

/**
 * Create a 4x4 pixel RGB frame filled with a single colour.
 *
 * The buffer contains 48 bytes (4 * 4 * 3 = 48) of raw RGB data
 * where every pixel has the specified (r, g, b) values.
 *
 * @param r - Red channel value (0-255).
 * @param g - Green channel value (0-255).
 * @param b - Blue channel value (0-255).
 * @param timestampSec - Timestamp of this frame in seconds.
 * @param index - 0-based frame index.
 * @returns A Frame object with the specified colour and metadata.
 */
function makeFrame(r: number, g: number, b: number, timestampSec: number, index: number): Frame {
  // 4x4 pixels, 3 bytes per pixel = 48 bytes
  const buf = Buffer.alloc(4 * 4 * 3);
  for (let i = 0; i < 16; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return { buffer: buf, timestampSec, index };
}

/**
 * Helper to convert an array of frames into an async iterable.
 */
async function* toAsyncIterable(frames: Frame[]): AsyncGenerator<Frame> {
  for (const frame of frames) {
    yield frame;
  }
}

/**
 * Helper to collect all values from an async generator into an array.
 */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneDetector', () => {
  // -----------------------------------------------------------------------
  // Test 1: detects hard cut between very different frames
  // -----------------------------------------------------------------------

  it('detects hard cut between very different frames (red vs blue)', () => {
    const detector = new SceneDetector({ hardCutThreshold: 0.3 });

    const redFrame = makeFrame(255, 0, 0, 0, 0);
    const blueFrame = makeFrame(0, 0, 255, 1, 1);

    const result = detector.hasSceneChanged(redFrame.buffer, blueFrame.buffer);

    expect(result.changed).toBe(true);
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.type).toBe('hard-cut');
  });

  // -----------------------------------------------------------------------
  // Test 2: no change between identical frames
  // -----------------------------------------------------------------------

  it('no change between identical frames', () => {
    const detector = new SceneDetector();

    const frame = makeFrame(128, 128, 128, 0, 0);

    const result = detector.hasSceneChanged(frame.buffer, frame.buffer);

    expect(result.changed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.type).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Test 3: detects scenes from async frame stream
  // -----------------------------------------------------------------------

  it('detects scenes from async frame stream (3 colour groups -> 2+ scene boundaries)', async () => {
    const detector = new SceneDetector({
      hardCutThreshold: 0.3,
      gradualThreshold: 0.15,
      minSceneDurationSec: 0.5,
    });

    // Create a sequence: 3 red frames, 3 green frames, 3 blue frames
    // Each frame is 1 second apart, so scene boundaries should be detected
    // at the colour transitions (frame 3 and frame 6).
    const frames: Frame[] = [
      // Scene 0: red
      makeFrame(255, 0, 0, 0, 0),
      makeFrame(255, 0, 0, 1, 1),
      makeFrame(255, 0, 0, 2, 2),
      // Scene 1: green
      makeFrame(0, 255, 0, 3, 3),
      makeFrame(0, 255, 0, 4, 4),
      makeFrame(0, 255, 0, 5, 5),
      // Scene 2: blue
      makeFrame(0, 0, 255, 6, 6),
      makeFrame(0, 0, 255, 7, 7),
      makeFrame(0, 0, 255, 8, 8),
    ];

    const boundaries = await collect(detector.detectScenes(toAsyncIterable(frames)));

    // Should have at least 3 boundaries:
    // scene 0 (red), scene 1 (green), scene 2 (blue) + final boundary
    expect(boundaries.length).toBeGreaterThanOrEqual(3);

    // First boundary should be the red scene
    expect(boundaries[0].startFrame).toBe(0);
    expect(boundaries[0].startTimeSec).toBe(0);

    // Verify we detected the colour transitions
    const hardCuts = boundaries.filter((b) => b.cutType === 'hard-cut');
    expect(hardCuts.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Test 4: histogramDiff returns 0 for identical buffers
  // -----------------------------------------------------------------------

  it('histogramDiff returns 0 for identical buffers', () => {
    const detector = new SceneDetector();

    const frame = makeFrame(100, 150, 200, 0, 0);

    const diff = detector.histogramDiff(frame.buffer, frame.buffer);

    expect(diff).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 5: histogramDiff returns high score for opposite colours
  // -----------------------------------------------------------------------

  it('histogramDiff returns high score for opposite colours', () => {
    const detector = new SceneDetector();

    const blackFrame = makeFrame(0, 0, 0, 0, 0);
    const whiteFrame = makeFrame(255, 255, 255, 1, 1);

    const diff = detector.histogramDiff(blackFrame.buffer, whiteFrame.buffer);

    // Black (all pixels at bin 0) vs white (all pixels at bin 255) should
    // produce a very high chi-squared distance since the histograms are
    // completely disjoint across all channels.
    expect(diff).toBeGreaterThan(0.5);
  });

  // -----------------------------------------------------------------------
  // Test 6: respects minSceneDurationSec
  // -----------------------------------------------------------------------

  it('respects minSceneDurationSec (rapid 1s changes suppressed with 5s min)', async () => {
    const detector = new SceneDetector({
      hardCutThreshold: 0.3,
      gradualThreshold: 0.15,
      minSceneDurationSec: 5.0, // Require at least 5 seconds between scenes
    });

    // Create rapid colour changes every 1 second — all should be suppressed
    // because they don't meet the 5-second minimum scene duration.
    const frames: Frame[] = [
      makeFrame(255, 0, 0, 0, 0),   // red
      makeFrame(0, 255, 0, 1, 1),   // green (1s later — too soon)
      makeFrame(0, 0, 255, 2, 2),   // blue  (2s later — too soon)
      makeFrame(255, 255, 0, 3, 3), // yellow (3s later — too soon)
      makeFrame(0, 255, 255, 4, 4), // cyan  (4s later — too soon)
    ];

    const boundaries = await collect(detector.detectScenes(toAsyncIterable(frames)));

    // With 5s minSceneDurationSec and frames spanning only 0-4s,
    // no intermediate scene changes should be detected.
    // We should only get the final boundary (closing the single scene).
    expect(boundaries.length).toBe(1);
    expect(boundaries[0].startFrame).toBe(0);
    expect(boundaries[0].endFrame).toBe(4);
  });
});
