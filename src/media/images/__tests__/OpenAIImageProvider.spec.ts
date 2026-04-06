import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIImageProvider } from '../providers/OpenAIImageProvider.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOpenAIResponse(data = [{ url: 'https://oai.test/img.png' }]) {
  return {
    ok: true,
    json: async () => ({ created: 1234567890, data }),
    text: async () => '',
    headers: new Headers(),
  };
}

describe('OpenAIImageProvider', () => {
  let provider: OpenAIImageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new OpenAIImageProvider();
    await provider.initialize({ apiKey: 'sk-test' });
  });

  describe('generateImage', () => {
    it('sends prompt to OpenAI images API', async () => {
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      const result = await provider.generateImage({ prompt: 'a cat' });

      expect(result.images).toHaveLength(1);
      expect(result.providerId).toBe('openai');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/images/generations');
    });

    it('returns image URL from response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOpenAIResponse([{ url: 'https://oai.test/cat.png' }])
      );

      const result = await provider.generateImage({ prompt: 'a cat' });

      expect(result.images[0].url).toBe('https://oai.test/cat.png');
    });

    it('logs debug warning when referenceImageUrl is set', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      await provider.generateImage({
        prompt: 'test',
        referenceImageUrl: 'https://ref.test/face.png',
      });

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('referenceImageUrl is not natively supported')
      );
      debugSpy.mockRestore();
    });

    it('still generates successfully when referenceImageUrl is set', async () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      const result = await provider.generateImage({
        prompt: 'test',
        referenceImageUrl: 'https://ref.test/face.png',
      });

      expect(result.images).toHaveLength(1);
    });

    it('throws when not initialized', async () => {
      const uninit = new OpenAIImageProvider();
      await expect(uninit.generateImage({ prompt: 'test' })).rejects.toThrow();
    });

    it('throws on 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
        headers: new Headers(),
      });

      await expect(provider.generateImage({ prompt: 'test' })).rejects.toThrow();
    });

    it('throws on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
        headers: new Headers(),
      });

      await expect(provider.generateImage({ prompt: 'test' })).rejects.toThrow();
    });

    it('passes size parameter to API', async () => {
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse());

      await provider.generateImage({ prompt: 'test', size: '1024x1024' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.size).toBe('1024x1024');
    });
  });
});
