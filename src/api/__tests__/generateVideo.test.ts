import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateVideo } from '../generateVideo.js';

// Mock the video provider factory so we never hit real APIs
vi.mock('../../core/video/index.js', () => {
  const mockProvider = {
    providerId: 'runway',
    isInitialized: true,
    defaultModelId: 'gen3a_turbo',
    initialize: vi.fn().mockResolvedValue(undefined),
    generateVideo: vi.fn().mockResolvedValue({
      created: Date.now(),
      modelId: 'gen3a_turbo',
      providerId: 'runway',
      videos: [
        {
          url: 'https://runway.example.com/video.mp4',
          durationSec: 5,
          mimeType: 'video/mp4',
        },
      ],
      usage: { totalVideos: 1, totalCostUSD: 0.25 },
    }),
    imageToVideo: vi.fn().mockResolvedValue({
      created: Date.now(),
      modelId: 'gen3a_turbo',
      providerId: 'runway',
      videos: [
        {
          url: 'https://runway.example.com/i2v.mp4',
          durationSec: 4,
          mimeType: 'video/mp4',
        },
      ],
      usage: { totalVideos: 1, totalCostUSD: 0.30 },
    }),
    supports: vi.fn().mockReturnValue(true),
  };

  return {
    createVideoProvider: vi.fn().mockReturnValue(mockProvider),
    hasVideoProviderFactory: vi.fn().mockReturnValue(true),
    __mockProvider: mockProvider,
  };
});

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

describe('generateVideo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('generates a text-to-video with explicit provider and API key', async () => {
    const result = await generateVideo({
      prompt: 'A drone flying over a misty forest at sunrise',
      provider: 'runway',
      apiKey: 'test-runway-key',
      durationSec: 5,
    });

    expect(result.provider).toBe('runway');
    expect(result.model).toBe('gen3a_turbo');
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].url).toContain('runway.example.com');
    expect(result.usage).toEqual({ totalVideos: 1, totalCostUSD: 0.25 });
  });

  it('generates an image-to-video when opts.image is provided', async () => {
    const imageBuffer = Buffer.from('fake-image-data');

    const result = await generateVideo({
      prompt: 'Camera slowly zooms out',
      image: imageBuffer,
      provider: 'runway',
      apiKey: 'test-runway-key',
    });

    expect(result.provider).toBe('runway');
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].url).toContain('i2v.mp4');
    expect(result.usage?.totalCostUSD).toBe(0.30);

    // Verify imageToVideo was called, not generateVideo
    const { __mockProvider } = await import('../../core/video/index.js') as any;
    expect(__mockProvider.imageToVideo).toHaveBeenCalled();
  });

  it('auto-detects provider from RUNWAY_API_KEY env var', async () => {
    process.env.RUNWAY_API_KEY = 'env-runway-key';

    const result = await generateVideo({
      prompt: 'A sunset over the ocean',
    });

    expect(result.provider).toBe('runway');
    expect(result.videos).toHaveLength(1);
  });

  it('throws when no provider is configured', async () => {
    // Ensure no video-related env vars are set
    delete process.env.RUNWAY_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.FAL_API_KEY;

    // Mock hasVideoProviderFactory to return false for all since no keys
    const mod = await import('../../core/video/index.js') as any;
    mod.hasVideoProviderFactory.mockReturnValue(false);

    await expect(
      generateVideo({ prompt: 'This should fail' }),
    ).rejects.toThrow(/No video provider configured/);
  });
});
