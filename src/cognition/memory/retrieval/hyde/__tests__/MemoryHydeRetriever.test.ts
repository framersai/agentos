import { describe, it, expect, vi } from 'vitest';
import { MemoryHydeRetriever } from '../MemoryHydeRetriever.js';

describe('MemoryHydeRetriever', () => {
  it('generates a hypothetical memory trace for a recall query', async () => {
    const llmInvoker = vi.fn().mockResolvedValue(
      'User mentioned they are a software engineer working on backend systems.'
    );

    const retriever = new MemoryHydeRetriever(llmInvoker);
    const result = await retriever.generateHypothesis('what does the user do for work?');

    expect(result.hypothesis).toBe(
      'User mentioned they are a software engineer working on backend systems.'
    );
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(llmInvoker).toHaveBeenCalledTimes(1);

    // System prompt should instruct to generate a stored memory, not answer the query
    const systemPrompt = llmInvoker.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('STORED MEMORY');
    expect(systemPrompt).toContain('Do NOT answer the query');
  });

  it('returns empty hypothesis when LLM fails', async () => {
    const llmInvoker = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const retriever = new MemoryHydeRetriever(llmInvoker);
    const result = await retriever.generateHypothesis('test query');

    expect(result.hypothesis).toBe('');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('trims whitespace from hypothesis', async () => {
    const llmInvoker = vi.fn().mockResolvedValue(
      '  User likes hiking and cooking.  \n'
    );

    const retriever = new MemoryHydeRetriever(llmInvoker);
    const result = await retriever.generateHypothesis('what does the user like?');

    expect(result.hypothesis).toBe('User likes hiking and cooking.');
  });

  it('passes the query in the user prompt', async () => {
    const llmInvoker = vi.fn().mockResolvedValue('hypothesis');
    const retriever = new MemoryHydeRetriever(llmInvoker);

    await retriever.generateHypothesis('tell me about their family');

    const userPrompt = llmInvoker.mock.calls[0][1] as string;
    expect(userPrompt).toContain('tell me about their family');
  });
});
