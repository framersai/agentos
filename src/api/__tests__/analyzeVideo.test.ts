import { afterEach, describe, expect, it, vi } from 'vitest';

import { analyzeVideo } from '../analyzeVideo.js';

// Mock observability to avoid OTel dependencies
vi.mock('../observability.js', () => ({
  attachUsageAttributes: vi.fn(),
  toTurnMetricUsage: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../core/observability/otel.js', () => ({
  withAgentOSSpan: vi.fn((_name: string, fn: (span: null) => unknown) => fn(null)),
  recordAgentOSTurnMetrics: vi.fn(),
}));

vi.mock('../usageLedger.js', () => ({
  recordAgentOSUsage: vi.fn().mockResolvedValue(undefined),
}));

describe('analyzeVideo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('analyses a video from URL with a prompt', async () => {
    const result = await analyzeVideo({
      videoUrl: 'https://example.com/demo.mp4',
      prompt: 'What products are shown?',
    });

    expect(result.description).toContain('What products are shown?');
    expect(result.provider).toBe('agentos-video-analyzer');
  });

  it('analyses a video from a buffer', async () => {
    const buffer = Buffer.from('fake-video-data');

    const result = await analyzeVideo({
      videoBuffer: buffer,
    });

    expect(result.description).toBe('Video analysis completed.');
    expect(result.provider).toBe('agentos-video-analyzer');
  });

  it('throws when neither videoUrl nor videoBuffer is provided', async () => {
    await expect(
      analyzeVideo({} as any),
    ).rejects.toThrow(/Either videoUrl or videoBuffer is required/);
  });

  it('passes the model option through to the result', async () => {
    const result = await analyzeVideo({
      videoUrl: 'https://example.com/clip.mp4',
      model: 'gpt-4o',
      prompt: 'Describe this video',
    });

    expect(result.model).toBe('gpt-4o');
  });
});
