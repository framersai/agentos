import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateSFX } from '../generateSFX.js';

// Mock the audio provider factory so we never hit real APIs
vi.mock('../../core/audio/index.js', () => {
  const mockProvider = {
    providerId: 'elevenlabs-sfx',
    isInitialized: true,
    defaultModelId: 'eleven-sfx-v1',
    initialize: vi.fn().mockResolvedValue(undefined),
    generateMusic: vi.fn().mockResolvedValue({
      created: Math.floor(Date.now() / 1000),
      modelId: 'eleven-sfx-v1',
      providerId: 'elevenlabs-sfx',
      audio: [{ url: 'https://api.elevenlabs.io/music.mp3', mimeType: 'audio/mpeg' }],
      usage: { totalAudioClips: 1 },
    }),
    generateSFX: vi.fn().mockResolvedValue({
      created: Math.floor(Date.now() / 1000),
      modelId: 'eleven-sfx-v1',
      providerId: 'elevenlabs-sfx',
      audio: [
        {
          url: 'https://api.elevenlabs.io/sfx/abc123.mp3',
          mimeType: 'audio/mpeg',
          durationSec: 3,
        },
      ],
      usage: { totalAudioClips: 1, totalCostUSD: 0.01 },
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

describe('generateSFX', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('generates an SFX clip with explicit provider and API key', async () => {
    const result = await generateSFX({
      prompt: 'Thunder crack followed by heavy rain on a tin roof',
      provider: 'elevenlabs-sfx',
      apiKey: 'test-elevenlabs-key',
      durationSec: 5,
    });

    expect(result.provider).toBe('elevenlabs-sfx');
    expect(result.model).toBe('eleven-sfx-v1');
    expect(result.audio).toHaveLength(1);
    expect(result.audio[0].url).toContain('elevenlabs.io');
    expect(result.usage).toEqual({ totalAudioClips: 1, totalCostUSD: 0.01 });
  });

  it('auto-detects provider from ELEVENLABS_API_KEY env var', async () => {
    process.env.ELEVENLABS_API_KEY = 'env-elevenlabs-key';

    const result = await generateSFX({
      prompt: 'Glass shattering on marble floor',
    });

    expect(result.provider).toBe('elevenlabs-sfx');
    expect(result.audio).toHaveLength(1);
  });

  it('respects providerPreferences to reorder the chain', async () => {
    process.env.ELEVENLABS_API_KEY = 'env-elevenlabs-key';

    const result = await generateSFX({
      prompt: 'Door creaking open slowly',
      providerPreferences: {
        preferred: ['elevenlabs-sfx'],
        blocked: ['replicate-audio'],
      },
    });

    expect(result.provider).toBe('elevenlabs-sfx');
    expect(result.audio).toHaveLength(1);
  });

  it('throws when no provider is configured', async () => {
    // Ensure no SFX-related env vars are set
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.STABILITY_API_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.FAL_API_KEY;

    // Mock hasAudioProviderFactory to return false for all
    const mod = await import('../../core/audio/index.js') as any;
    mod.hasAudioProviderFactory.mockReturnValue(false);

    await expect(
      generateSFX({ prompt: 'This should fail' }),
    ).rejects.toThrow(/No SFX provider configured/);
  });
});
