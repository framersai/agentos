import { describe, it, expect, vi } from 'vitest';
import type { IBatchTTS, BatchTTSResult } from '../types.js';
import { BatchTTSFallback } from '../providers/BatchTTSFallback.js';

function mockProvider(id: string, result?: BatchTTSResult, error?: Error): IBatchTTS {
  return {
    providerId: id,
    synthesize: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue(result),
  };
}

const okResult: BatchTTSResult = {
  audio: Buffer.from('audio'),
  format: 'mp3',
  durationMs: 1000,
  provider: 'provider-a',
};

describe('BatchTTSFallback', () => {
  it('returns result from first provider on success', async () => {
    const a = mockProvider('a', okResult);
    const b = mockProvider('b', { ...okResult, provider: 'b' });
    const fallback = new BatchTTSFallback([a, b]);

    const result = await fallback.synthesize('Hello');

    expect(result.provider).toBe('provider-a');
    expect(a.synthesize).toHaveBeenCalledOnce();
    expect(b.synthesize).not.toHaveBeenCalled();
  });

  it('falls back to second provider when first fails', async () => {
    const a = mockProvider('a', undefined, new Error('API down'));
    const b = mockProvider('b', { ...okResult, provider: 'provider-b' });
    const fallback = new BatchTTSFallback([a, b]);

    const result = await fallback.synthesize('Hello');

    expect(result.provider).toBe('provider-b');
    expect(a.synthesize).toHaveBeenCalledOnce();
    expect(b.synthesize).toHaveBeenCalledOnce();
  });

  it('throws aggregate error when all providers fail', async () => {
    const a = mockProvider('a', undefined, new Error('Fail A'));
    const b = mockProvider('b', undefined, new Error('Fail B'));
    const fallback = new BatchTTSFallback([a, b]);

    await expect(fallback.synthesize('Hello')).rejects.toThrow('All TTS providers failed');
  });

  it('throws when no providers given', async () => {
    const fallback = new BatchTTSFallback([]);
    await expect(fallback.synthesize('Hello')).rejects.toThrow('No TTS providers configured');
  });

  it('passes config through to providers', async () => {
    const a = mockProvider('a', okResult);
    const fallback = new BatchTTSFallback([a]);

    await fallback.synthesize('Hi', { voice: 'echo', speed: 2.0 });

    expect(a.synthesize).toHaveBeenCalledWith('Hi', { voice: 'echo', speed: 2.0 });
  });
});
