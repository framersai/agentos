import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMusic } from '../generateMusic.js';

// Mock the audio provider factory so we never hit real APIs
vi.mock('../../core/audio/index.js', () => {
  const mockProvider = {
    providerId: 'suno',
    isInitialized: true,
    defaultModelId: 'suno-v3.5',
    initialize: vi.fn().mockResolvedValue(undefined),
    generateMusic: vi.fn().mockResolvedValue({
      created: Math.floor(Date.now() / 1000),
      modelId: 'suno-v3.5',
      providerId: 'suno',
      audio: [
        {
          url: 'https://cdn.suno.ai/abc123.mp3',
          mimeType: 'audio/mpeg',
          durationSec: 60,
        },
      ],
      usage: { totalAudioClips: 1, totalCostUSD: 0.05 },
    }),
    generateSFX: vi.fn().mockResolvedValue({
      created: Math.floor(Date.now() / 1000),
      modelId: 'suno-v3.5',
      providerId: 'suno',
      audio: [{ url: 'https://cdn.suno.ai/sfx.mp3', mimeType: 'audio/mpeg' }],
      usage: { totalAudioClips: 1 },
    }),
    supports: vi.fn().mockReturnValue(true),
  };

  return {
    createAudioProvider: vi.fn().mockReturnValue(mockProvider),
    hasAudioProviderFactory: vi.fn().mockReturnValue(true),
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

describe('generateMusic', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('generates music with explicit provider and API key', async () => {
    const result = await generateMusic({
      prompt: 'Upbeat lo-fi hip hop beat with vinyl crackle and mellow piano',
      provider: 'suno',
      apiKey: 'test-suno-key',
      durationSec: 60,
    });

    expect(result.provider).toBe('suno');
    expect(result.model).toBe('suno-v3.5');
    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toContain('suno.ai');
    expect(result.usage).toEqual({ totalAudioClips: 1, totalCostUSD: 0.05 });
  });

  it('auto-detects provider from SUNO_API_KEY env var', async () => {
    process.env.SUNO_API_KEY = 'env-suno-key';

    const result = await generateMusic({
      prompt: 'Ambient piano loop',
    });

    expect(result.provider).toBe('suno');
    expect(result.audio).toHaveLength(1);
  });

  it('respects providerPreferences to reorder the chain', async () => {
    process.env.SUNO_API_KEY = 'env-suno-key';

    const result = await generateMusic({
      prompt: 'Electronic dance music',
      providerPreferences: {
        preferred: ['suno'],
        blocked: ['udio'],
      },
    });

    expect(result.provider).toBe('suno');
    expect(result.audio).toHaveLength(1);
  });

  it('throws when no provider is configured', async () => {
    // Ensure no audio-related env vars are set
    delete process.env.SUNO_API_KEY;
    delete process.env.UDIO_API_KEY;
    delete process.env.STABILITY_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.FAL_API_KEY;

    // Mock hasAudioProviderFactory to return false for all
    const mod = await import('../../core/audio/index.js') as any;
    mod.hasAudioProviderFactory.mockReturnValue(false);

    await expect(
      generateMusic({ prompt: 'This should fail' }),
    ).rejects.toThrow(/No music provider configured/);
  });
});
