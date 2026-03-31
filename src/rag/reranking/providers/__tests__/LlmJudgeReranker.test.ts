import { describe, it, expect, vi } from 'vitest';
import { LlmJudgeReranker } from '../LlmJudgeReranker.js';
import type { RerankerInput, RerankerRequestConfig } from '../../IRerankerService.js';

function makeInput(n: number): RerankerInput {
  return {
    query: 'best programming languages',
    documents: Array.from({ length: n }, (_, i) => ({
      id: `doc-${i}`,
      content: `Document ${i} about programming language ${['Rust', 'Python', 'Go', 'Java', 'TypeScript', 'C++', 'Kotlin', 'Swift', 'Ruby', 'Elixir'][i % 10]}`,
    })),
  };
}

const defaultConfig: RerankerRequestConfig = {
  providerId: 'llm-judge',
  modelId: 'gpt-4o-mini',
  topN: 5,
};

describe('LlmJudgeReranker', () => {
  it('returns providerId "llm-judge"', () => {
    const reranker = new LlmJudgeReranker({ llmCallFn: vi.fn() });
    expect(reranker.providerId).toBe('llm-judge');
  });

  it('is available when llmCallFn is provided', async () => {
    const reranker = new LlmJudgeReranker({ llmCallFn: vi.fn() });
    expect(await reranker.isAvailable()).toBe(true);
  });

  it('scores documents via batch pointwise then listwise', async () => {
    const llmCallFn = vi.fn()
      .mockResolvedValueOnce('[8, 3, 7, 2, 9, 4, 6, 1, 5, 10]')
      .mockResolvedValueOnce('["doc-9", "doc-4", "doc-0", "doc-2", "doc-6"]');

    const reranker = new LlmJudgeReranker({ llmCallFn, pointwiseTopK: 5 });

    const result = await reranker.rerank(makeInput(10), defaultConfig);
    expect(result.results.length).toBe(5);
    expect(result.results[0].id).toBe('doc-9');
    expect(result.results[0].relevanceScore).toBeGreaterThan(result.results[1].relevanceScore);
    expect(llmCallFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to pointwise scores when listwise fails', async () => {
    const llmCallFn = vi.fn()
      .mockResolvedValueOnce('[8, 3, 7, 2, 9]')
      .mockRejectedValueOnce(new Error('LLM timeout'));

    const reranker = new LlmJudgeReranker({ llmCallFn, pointwiseTopK: 3 });

    const result = await reranker.rerank(makeInput(5), { ...defaultConfig, topN: 3 });
    expect(result.results.length).toBe(3);
    expect(result.results[0].id).toBe('doc-4');
  });

  it('handles batch errors gracefully', async () => {
    const llmCallFn = vi.fn()
      .mockRejectedValueOnce(new Error('batch 1 failed'))
      .mockResolvedValueOnce('[5, 8, 3, 7, 2, 9, 4, 6, 1, 10]')
      .mockResolvedValueOnce('["doc-19", "doc-15", "doc-11"]');

    const reranker = new LlmJudgeReranker({ llmCallFn, pointwiseTopK: 3 });

    const result = await reranker.rerank(makeInput(20), { ...defaultConfig, topN: 3 });
    expect(result.results.length).toBe(3);
  });
});
