import { describe, it, expect } from 'vitest';
import {
  type HealthyProvider,
  type ProviderCapabilities,
  type HealthCheckResult,
  defaultCapabilities,
  supportsLanguage,
} from '../HealthyProvider.js';

describe('HealthyProvider trait shape', () => {
  it('accepts a minimal implementer', async () => {
    const mock: HealthyProvider = {
      providerId: 'mock',
      priority: 10,
      capabilities: {
        languages: ['en'],
        streaming: true,
        maxConcurrent: 1,
        costTier: 'cheap',
        latencyClass: 'realtime',
      },
      async healthCheck() {
        return { ok: true, latencyMs: 42 };
      },
    };
    const result: HealthCheckResult = await mock.healthCheck();
    expect(result.ok).toBe(true);
    expect(mock.priority).toBe(10);
  });

  it('defaultCapabilities fills missing fields', () => {
    const caps: ProviderCapabilities = defaultCapabilities({
      languages: ['en', 'es'],
    });
    expect(caps.languages).toEqual(['en', 'es']);
    expect(caps.streaming).toBe(true);
    expect(caps.costTier).toBe('standard');
    expect(caps.latencyClass).toBe('realtime');
    expect(caps.maxConcurrent).toBe(Infinity);
  });

  it('supportsLanguage matches wildcard and exact', () => {
    const any: ProviderCapabilities = defaultCapabilities({ languages: ['*'] });
    expect(supportsLanguage(any, 'en')).toBe(true);
    expect(supportsLanguage(any, 'zh')).toBe(true);

    const enOnly: ProviderCapabilities = defaultCapabilities({
      languages: ['en', 'en-US'],
    });
    expect(supportsLanguage(enOnly, 'en')).toBe(true);
    expect(supportsLanguage(enOnly, 'en-US')).toBe(true);
    expect(supportsLanguage(enOnly, 'es')).toBe(false);
  });

  it('supportsLanguage handles regional variants', () => {
    const caps: ProviderCapabilities = defaultCapabilities({
      languages: ['en'],
    });
    expect(supportsLanguage(caps, 'en-GB')).toBe(true);
    expect(supportsLanguage(caps, 'en-US')).toBe(true);
    expect(supportsLanguage(caps, 'fr')).toBe(false);
  });
});
