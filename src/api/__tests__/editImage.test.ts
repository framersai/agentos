/**
 * @file editImage.test.ts
 * Tests for the high-level editImage API covering img2img, inpainting,
 * unsupported-provider errors, and strength parameter forwarding.
 *
 * All tests mock `globalThis.fetch` — no real API calls are made.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editImage } from '../editImage.js';
import { ImageEditNotSupportedError } from '../../core/images/ImageOperationError.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal 1x1 PNG as a Buffer (used as the "source image" input). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A minimal 1x1 white PNG used as a mask. */
const TINY_MASK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('editImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performs img2img with the OpenAI provider', async () => {
    // The OpenAI edits endpoint returns the same response shape as generations.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 100,
          data: [{ b64_json: 'ZWRpdGVk', revised_prompt: 'revised' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await editImage({
      model: 'openai:gpt-image-1',
      image: TINY_PNG,
      prompt: 'Add sunglasses to the cat.',
      apiKey: 'test-key',
    });

    // Verify the correct endpoint was called.
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toContain('/images/edits');

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-image-1');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      mimeType: 'image/png',
      base64: 'ZWRpdGVk',
    });
  });

  it('performs inpainting with a mask via OpenAI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 200,
          data: [{ b64_json: 'aW5wYWludGVk' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await editImage({
      model: 'openai:gpt-image-1',
      image: TINY_PNG,
      mask: TINY_MASK,
      prompt: 'Replace the sky with northern lights.',
      mode: 'inpaint',
      apiKey: 'test-key',
    });

    // Verify the form data contained a mask.
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0];
    const formData = requestInit?.body as FormData;
    expect(formData.get('mask')).toBeTruthy();

    expect(result.images).toHaveLength(1);
    expect(result.images[0].base64).toBe('aW5wYWludGVk');
  });

  it('throws ImageEditNotSupportedError for providers without editImage', async () => {
    // OpenRouter does not implement editImage, so the high-level API should
    // detect the missing method and throw a typed error.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(
      editImage({
        model: 'openrouter:some-model',
        image: TINY_PNG,
        prompt: 'Make it blue.',
        apiKey: 'test-key',
      }),
    ).rejects.toThrow(ImageEditNotSupportedError);
  });

  it('forwards the strength parameter to the Stability provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          image: 'c3RyZW5ndGg=',
          seed: 42,
          finish_reason: 'SUCCESS',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await editImage({
      model: 'stability:sd3-medium',
      image: TINY_PNG,
      prompt: 'Turn it into a watercolor painting.',
      strength: 0.3,
      apiKey: 'stab-key',
    });

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toContain('/v2beta/stable-image/generate/sd3');

    const formData = requestInit?.body as FormData;
    // Stability receives strength as a form field.
    expect(formData.get('strength')).toBe('0.3');
  });

  it('accepts a base64 data URL as image input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 300,
          data: [{ b64_json: 'ZGF0YXVybA==' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // The editImage function should accept a data URL and convert it to a Buffer.
    const dataUrl = `data:image/png;base64,${TINY_PNG.toString('base64')}`;
    const result = await editImage({
      model: 'openai:gpt-image-1',
      image: dataUrl,
      prompt: 'Crop the borders.',
      apiKey: 'test-key',
    });

    expect(result.images).toHaveLength(1);
  });

  it('performs img2img with the Stable Diffusion local provider', async () => {
    // The SD local provider calls /sdapi/v1/sd-models for init and /sdapi/v1/img2img for editing.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;

      if (urlStr.includes('/sdapi/v1/sd-models')) {
        return new Response(
          JSON.stringify([{ model_name: 'sd-v1-5', title: 'sd-v1-5', filename: 'sd.safetensors' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('/sdapi/v1/img2img')) {
        return new Response(
          JSON.stringify({ images: ['aW1nMmltZw=='], parameters: {}, info: '{}' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const result = await editImage({
      model: 'stable-diffusion-local:sd-v1-5',
      image: TINY_PNG,
      prompt: 'Make it a pencil sketch.',
      strength: 0.8,
      baseUrl: 'http://localhost:7860',
    });

    expect(result.provider).toBe('stable-diffusion-local');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].base64).toBe('aW1nMmltZw==');

    // Verify img2img endpoint was called.
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const img2imgCall = calls.find((c) => String(c[0]).includes('/sdapi/v1/img2img'));
    expect(img2imgCall).toBeDefined();

    const body = JSON.parse(String((img2imgCall![1] as RequestInit).body));
    expect(body.denoising_strength).toBe(0.8);
    expect(body.init_images).toHaveLength(1);
  });
});
