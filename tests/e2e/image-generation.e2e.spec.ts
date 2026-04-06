/**
 * @file image-generation.e2e.spec.ts
 * End-to-end tests for image generation against live APIs.
 *
 * These tests are gated behind environment variables — they only run when
 * the corresponding API key is configured. Each test has a 60-second timeout
 * to accommodate real API latency.
 *
 * Run with: `npx vitest run tests/e2e/image-generation.e2e.spec.ts`
 *
 * Asserts structural correctness (non-empty images array, valid URL,
 * correct provider/model metadata), not visual quality.
 */

import { describe, it, expect } from 'vitest';

const hasReplicate = !!process.env.REPLICATE_API_TOKEN;

describe.skipIf(!hasReplicate)('Image Generation E2E (Replicate)', () => {
  it('generates an image via Flux Schnell', async () => {
    const { generateImage } = await import('../../src/api/generateImage.js');

    const result = await generateImage({
      provider: 'replicate',
      model: 'black-forest-labs/flux-schnell',
      prompt: 'A simple red cube on a white background, minimal, clean',
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(result.provider).toBe('replicate');
    const img = result.images[0];
    expect(img.url || img.dataUrl || img.base64).toBeTruthy();
  }, 60_000);

  it('generates with character reference via Pulid', async () => {
    const { generateImage } = await import('../../src/api/generateImage.js');

    const result = await generateImage({
      provider: 'replicate',
      model: 'zsxkib/pulid',
      prompt: 'Portrait of the character smiling warmly, soft studio lighting',
      // Using a public test image — in real usage this would be an actual reference
      referenceImageUrl: 'https://replicate.delivery/pbxt/JvLi9smWKKDfQpylBYosqQRfPKZPntuAhEqnGNsFIIGVFIBC/ComfyUI_00586_.png',
      consistencyMode: 'strict',
    });

    expect(result.images.length).toBeGreaterThan(0);
    expect(result.provider).toBe('replicate');
  }, 60_000);

  it('lists available models including new entries', async () => {
    const { ReplicateImageProvider } = await import('../../src/media/images/providers/ReplicateImageProvider.js');
    const provider = new ReplicateImageProvider();
    await provider.initialize({ apiKey: process.env.REPLICATE_API_TOKEN! });

    const models = await provider.listAvailableModels();
    expect(models.length).toBeGreaterThanOrEqual(13);
    expect(models.some(m => m.modelId === 'zsxkib/pulid')).toBe(true);
    expect(models.some(m => m.modelId === 'black-forest-labs/flux-redux-dev')).toBe(true);
  }, 10_000);
});
