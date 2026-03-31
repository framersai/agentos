import { describe, it, expect, vi } from 'vitest';
import { RerankerService } from '../RerankerService';
import type { IRerankerProvider, RerankerInput, RerankerOutput, RerankerRequestConfig } from '../IRerankerService';

/** Create a mock reranker provider that multiplies scores by a factor. */
function mockProvider(id: string, factor: number): IRerankerProvider {
  return {
    providerId: id,
    isAvailable: vi.fn().mockResolvedValue(true),
    rerank: vi.fn().mockImplementation(async (input: RerankerInput, config: RerankerRequestConfig): Promise<RerankerOutput> => {
      const topN = config.topN ?? input.documents.length;
      const results = input.documents
        .map(d => ({
          id: d.id,
          content: d.content,
          relevanceScore: (d.originalScore ?? 0.5) * factor,
          originalScore: d.originalScore,
          metadata: d.metadata,
        }))
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, topN);
      return { results };
    }),
  };
}

describe('RerankerService.rerankChain()', () => {
  it('runs multiple stages sequentially, narrowing results', async () => {
    const service = new RerankerService({
      config: { providers: [{ providerId: 'stage1' }, { providerId: 'stage2' }] },
    });
    service.registerProvider(mockProvider('stage1', 1.0));
    service.registerProvider(mockProvider('stage2', 0.9));

    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `Content ${i}`,
      relevanceScore: (10 - i) / 10,
      heading: '',
      sourcePath: '',
      metadata: {},
    }));

    const result = await service.rerankChain('test query', chunks, [
      { provider: 'stage1', topK: 5 },
      { provider: 'stage2', topK: 3 },
    ]);

    expect(result.length).toBe(3);
    expect(result[0].metadata?._rerankerChainStages).toBe('stage1,stage2');
  });

  it('skips unavailable providers and continues', async () => {
    const unavailable: IRerankerProvider = {
      providerId: 'offline',
      isAvailable: vi.fn().mockResolvedValue(false),
      rerank: vi.fn(),
    };

    const service = new RerankerService({
      config: { providers: [{ providerId: 'offline' }, { providerId: 'online' }] },
    });
    service.registerProvider(unavailable);
    service.registerProvider(mockProvider('online', 1.0));

    const chunks = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`, content: `C ${i}`, relevanceScore: 0.5, heading: '', sourcePath: '', metadata: {},
    }));

    const result = await service.rerankChain('test', chunks, [
      { provider: 'offline', topK: 3 },
      { provider: 'online', topK: 2 },
    ]);

    expect(result.length).toBe(2);
    expect(unavailable.rerank).not.toHaveBeenCalled();
    expect(result[0].metadata?._rerankerChainStages).toBe('online');
  });

  it('skips unregistered providers', async () => {
    const service = new RerankerService({
      config: { providers: [{ providerId: 'real' }] },
    });
    service.registerProvider(mockProvider('real', 1.0));

    const chunks = [{ id: 'c1', content: 'test', relevanceScore: 0.5, heading: '', sourcePath: '', metadata: {} }];

    const result = await service.rerankChain('test', chunks, [
      { provider: 'nonexistent', topK: 5 },
      { provider: 'real', topK: 1 },
    ]);

    expect(result.length).toBe(1);
    expect(result[0].metadata?._rerankerChainStages).toBe('real');
  });

  it('returns input unchanged when chain is empty', async () => {
    const service = new RerankerService({ config: { providers: [] } });
    const chunks = [{ id: 'c1', content: 'test', relevanceScore: 0.5, heading: '', sourcePath: '', metadata: {} }];

    const result = await service.rerankChain('test', chunks, []);
    expect(result).toEqual(chunks);
  });

  it('handles stage failure gracefully', async () => {
    const failing: IRerankerProvider = {
      providerId: 'failing',
      isAvailable: vi.fn().mockResolvedValue(true),
      rerank: vi.fn().mockRejectedValue(new Error('API down')),
    };

    const service = new RerankerService({
      config: { providers: [{ providerId: 'failing' }, { providerId: 'ok' }] },
    });
    service.registerProvider(failing);
    service.registerProvider(mockProvider('ok', 1.0));

    const chunks = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`, content: `C ${i}`, relevanceScore: 0.5, heading: '', sourcePath: '', metadata: {},
    }));

    const result = await service.rerankChain('test', chunks, [
      { provider: 'failing', topK: 3 },
      { provider: 'ok', topK: 2 },
    ]);

    expect(result.length).toBe(2);
    expect(result[0].metadata?._rerankerChainStages).toBe('ok');
  });
});
