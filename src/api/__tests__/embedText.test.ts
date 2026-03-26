/**
 * @file embedText.test.ts
 * Tests for the provider-agnostic text embedding API.
 *
 * Mocks `globalThis.fetch` and the provider resolution layer to exercise
 * OpenAI, OpenRouter, and Ollama embedding dispatches, batch handling,
 * dimensionality reduction, and error propagation without network calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModelOption } from '../model.js';

// We don't mock the entire model.js module here because embedText uses
// fetch directly rather than going through AIModelProviderManager.
// Instead, we mock resolveModelOption and resolveProvider selectively.

vi.mock('../model.js', () => ({
  resolveModelOption: vi.fn(() => ({
    providerId: 'openai',
    modelId: 'text-embedding-3-small',
  })),
  resolveProvider: vi.fn(
    (providerId: string, modelId: string, overrides?: { apiKey?: string; baseUrl?: string }) => ({
      providerId,
      modelId,
      apiKey: overrides?.apiKey ?? 'test-key',
      baseUrl: overrides?.baseUrl,
    }),
  ),
  createProviderManager: vi.fn(),
}));

import { embedText } from '../embedText.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a mock OpenAI embedding response for the given input texts.
 * Each "embedding" is a simple array of ascending floats for determinism.
 */
function mockOpenAIResponse(inputs: string[], dimensions = 4) {
  return {
    data: inputs.map((_, idx) => ({
      index: idx,
      embedding: Array.from({ length: dimensions }, (__, i) => idx + i * 0.01),
    })),
    model: 'text-embedding-3-small',
    usage: {
      prompt_tokens: inputs.join(' ').split(' ').length,
      total_tokens: inputs.join(' ').split(' ').length,
    },
  };
}

/**
 * Builds a mock Ollama embed response.
 */
function mockOllamaResponse(inputs: string[], dimensions = 4) {
  return {
    model: 'nomic-embed-text',
    embeddings: inputs.map((_, idx) =>
      Array.from({ length: dimensions }, (__, i) => idx + i * 0.1),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('embedText', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-apply mock after restoreAllMocks (which clears fetch spies)
    vi.mocked(resolveModelOption).mockReturnValue({
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns embedding vectors for a single input string', async () => {
    const mockResp = mockOpenAIResponse(['Hello world']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await embedText({
      model: 'openai:text-embedding-3-small',
      input: 'Hello world',
      apiKey: 'test-key',
    });

    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]).toHaveLength(4);
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.provider).toBe('openai');
    expect(result.usage.promptTokens).toBeGreaterThanOrEqual(1);
  });

  it('returns multiple embeddings for batch input', async () => {
    const inputs = ['Hello', 'World', 'Foo'];
    const mockResp = mockOpenAIResponse(inputs);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await embedText({
      model: 'openai:text-embedding-3-small',
      input: inputs,
      apiKey: 'test-key',
    });

    expect(result.embeddings).toHaveLength(3);
    // Each embedding should have the same dimensionality
    for (const emb of result.embeddings) {
      expect(emb).toHaveLength(4);
    }
  });

  it('passes the dimensions parameter to the API', async () => {
    const mockResp = mockOpenAIResponse(['test'], 256);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await embedText({
      model: 'openai:text-embedding-3-small',
      input: 'test',
      dimensions: 256,
      apiKey: 'test-key',
    });

    expect(result.embeddings[0]).toHaveLength(256);

    // Verify dimensions was sent in the request body
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(requestInit?.body));
    expect(body.dimensions).toBe(256);
  });

  it('omits dimensions from the request body when not specified', async () => {
    const mockResp = mockOpenAIResponse(['test']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await embedText({
      model: 'openai:text-embedding-3-small',
      input: 'test',
      apiKey: 'test-key',
    });

    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(requestInit?.body));
    expect(body.dimensions).toBeUndefined();
  });

  it('dispatches to Ollama /api/embed for ollama provider', async () => {
    vi.mocked(resolveModelOption).mockReturnValue({
      providerId: 'ollama',
      modelId: 'nomic-embed-text',
    });

    // Re-mock resolveProvider for ollama (no apiKey, has baseUrl)
    const { resolveProvider } = await import('../model.js');
    vi.mocked(resolveProvider).mockReturnValue({
      providerId: 'ollama',
      modelId: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    });

    const mockResp = mockOllamaResponse(['Hello']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await embedText({
      provider: 'ollama',
      model: 'nomic-embed-text',
      input: 'Hello',
      baseUrl: 'http://localhost:11434',
    });

    expect(result.embeddings).toHaveLength(1);
    expect(result.model).toBe('nomic-embed-text');
    expect(result.provider).toBe('ollama');

    // Verify it hit the Ollama endpoint, not the OpenAI one
    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toContain('/api/embed');
  });

  it('uses OpenRouter base URL for openrouter provider', async () => {
    vi.mocked(resolveModelOption).mockReturnValue({
      providerId: 'openrouter',
      modelId: 'openai/text-embedding-3-small',
    });

    const { resolveProvider } = await import('../model.js');
    vi.mocked(resolveProvider).mockReturnValue({
      providerId: 'openrouter',
      modelId: 'openai/text-embedding-3-small',
      apiKey: 'or-key',
    });

    const mockResp = mockOpenAIResponse(['test']);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await embedText({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-small',
      input: 'test',
      apiKey: 'or-key',
    });

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toContain('openrouter.ai');
    expect(String(url)).toContain('/embeddings');
  });

  it('throws on non-2xx HTTP status from the embedding API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error": {"message": "Invalid API key"}}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      embedText({
        model: 'openai:text-embedding-3-small',
        input: 'test',
        apiKey: 'bad-key',
      }),
    ).rejects.toThrow(/401/);
  });

  it('preserves input order when API returns indices out of order', async () => {
    const inputs = ['First', 'Second', 'Third'];
    // Return data with shuffled indices
    const mockResp = {
      data: [
        { index: 2, embedding: [3.0, 3.1, 3.2, 3.3] },
        { index: 0, embedding: [1.0, 1.1, 1.2, 1.3] },
        { index: 1, embedding: [2.0, 2.1, 2.2, 2.3] },
      ],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 3, total_tokens: 3 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await embedText({
      model: 'openai:text-embedding-3-small',
      input: inputs,
      apiKey: 'test-key',
    });

    // Embeddings should be sorted by index, matching input order
    expect(result.embeddings[0][0]).toBe(1.0); // index 0 → First
    expect(result.embeddings[1][0]).toBe(2.0); // index 1 → Second
    expect(result.embeddings[2][0]).toBe(3.0); // index 2 → Third
  });
});
