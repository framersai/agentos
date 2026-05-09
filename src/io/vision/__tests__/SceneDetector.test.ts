import { describe, expect, it, vi } from 'vitest';

import { SceneDetector } from '../SceneDetector.js';
import type { Frame, SceneBoundary } from '../types.js';

function makeFrame(index: number, timestampSec: number, value: number): Frame {
  return {
    buffer: Buffer.alloc(4 * 4 * 3, value),
    timestampSec,
    index,
  };
}

async function collectBoundaries(
  detector: SceneDetector,
  frames: Frame[],
): Promise<SceneBoundary[]> {
  async function* stream(): AsyncGenerator<Frame> {
    for (const frame of frames) {
      yield frame;
    }
  }

  const boundaries: SceneBoundary[] = [];
  for await (const boundary of detector.detectScenes(stream())) {
    boundaries.push(boundary);
  }
  return boundaries;
}

describe('SceneDetector', () => {
  it('uses the configured SSIM method during streaming detection', async () => {
    const detector = new SceneDetector({
      methods: ['ssim'],
      gradualThreshold: 0.2,
      hardCutThreshold: 0.5,
      minSceneDurationSec: 0,
    });

    const ssimSpy = vi.spyOn(detector, 'ssimDiff').mockResolvedValue(0.8);
    const histogramSpy = vi.spyOn(detector, 'histogramDiff');

    const boundaries = await collectBoundaries(detector, [
      makeFrame(0, 0, 10),
      makeFrame(1, 1, 20),
    ]);

    expect(ssimSpy).toHaveBeenCalledTimes(1);
    expect(histogramSpy).not.toHaveBeenCalled();
    expect(boundaries[0].cutType).toBe('hard-cut');
    expect(boundaries[0].diffScore).toBe(0.8);
  });

  it('combines multiple methods by taking the strongest diff signal', async () => {
    const detector = new SceneDetector({
      methods: ['histogram', 'ssim'],
      gradualThreshold: 0.3,
      hardCutThreshold: 0.7,
      minSceneDurationSec: 0,
    });

    vi.spyOn(detector, 'histogramDiff').mockReturnValue(0.1);
    vi.spyOn(detector, 'ssimDiff').mockResolvedValue(0.9);

    const boundaries = await collectBoundaries(detector, [
      makeFrame(0, 0, 10),
      makeFrame(1, 1, 20),
    ]);

    expect(boundaries[0].cutType).toBe('hard-cut');
    expect(boundaries[0].diffScore).toBe(0.9);
  });
});
