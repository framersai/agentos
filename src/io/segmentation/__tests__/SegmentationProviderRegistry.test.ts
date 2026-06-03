import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveSegmentationProvider,
  registerSegmentationProvider,
  resetSegmentationProviders,
} from '../SegmentationProviderRegistry.js';
import type { ISegmentationProvider } from '../types.js';

const fake: ISegmentationProvider = {
  providerId: 'fake',
  isInitialized: true,
  defaultModelId: 'fake/model',
  async initialize() {},
  supportedModes() { return ['box']; },
  async segment() {
    return { masks: [], width: 0, height: 0, providerId: 'fake', modelId: 'fake/model', promptMode: 'box', durationMs: 0 };
  },
};

describe('SegmentationProviderRegistry', () => {
  beforeEach(() => resetSegmentationProviders());
  afterEach(() => { delete process.env.REPLICATE_API_TOKEN; resetSegmentationProviders(); });

  it('returns a registered instance without touching env', async () => {
    registerSegmentationProvider('fake', fake);
    expect(await resolveSegmentationProvider('fake')).toBe(fake);
  });

  it('throws for an unknown provider id', async () => {
    await expect(resolveSegmentationProvider('nope')).rejects.toThrow(/Unknown segmentation provider/);
  });

  it('throws when replicate is requested without REPLICATE_API_TOKEN', async () => {
    delete process.env.REPLICATE_API_TOKEN;
    await expect(resolveSegmentationProvider('replicate')).rejects.toThrow(/REPLICATE_API_TOKEN/);
  });

  it('builds and caches a replicate provider when the token is present', async () => {
    process.env.REPLICATE_API_TOKEN = 'tok';
    const a = await resolveSegmentationProvider('replicate');
    const b = await resolveSegmentationProvider('replicate');
    expect(a.providerId).toBe('replicate');
    expect(a).toBe(b);
  });
});
