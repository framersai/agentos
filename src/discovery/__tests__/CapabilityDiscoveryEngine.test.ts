import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityDiscoveryEngine } from '../CapabilityDiscoveryEngine.js';
import { InMemoryVectorStore } from '../../rag/vector_stores/InMemoryVectorStore.js';

describe('CapabilityDiscoveryEngine disabled capability filtering', () => {
  let engine: CapabilityDiscoveryEngine;

  beforeEach(async () => {
    const embeddingManager = {
      generateEmbeddings: vi.fn().mockImplementation(async ({ texts }: { texts: string | string[] }) => {
        const values = Array.isArray(texts) ? texts : [texts];
        return {
          embeddings: values.map(embedText),
          modelId: 'test-embedding-model',
          providerId: 'test-provider',
          usage: {
            totalTokens: values.length,
          },
        };
      }),
    } as any;

    const vectorStore = new InMemoryVectorStore();
    await vectorStore.initialize({
      id: 'in-memory-discovery-test',
      type: 'in_memory',
      similarityMetric: 'cosine',
    } as any);

    engine = new CapabilityDiscoveryEngine(embeddingManager, vectorStore, {
      collectionName: 'capability-discovery-engine-test',
      tier1TopK: 5,
      tier2TopK: 2,
    });

    await engine.initialize({
      tools: [
        {
          id: 'tool:web-search',
          name: 'web-search',
          displayName: 'Web Search',
          description: 'Search the web for information.',
          category: 'information',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      skills: [
        {
          name: 'research-skill',
          description: 'Research workflow guidance for web-based tasks.',
          content: 'Use web search, compare multiple sources, and synthesize the findings.',
          category: 'research',
        },
      ],
      extensions: [],
      channels: [],
    });
  });

  it('excludes disabled skills from both retrieval tiers and Tier 0 prompt context', async () => {
    const result = await engine.discover('research on the web', {
      excludedCapabilityIds: ['research-skill'],
    });

    expect(result.tier0).not.toContain('research-skill');
    expect(result.tier1.some((item) => item.capability.name === 'research-skill')).toBe(false);
    expect(result.tier2.some((item) => item.capability.name === 'research-skill')).toBe(false);
    expect(engine.renderForPrompt(result)).not.toContain('research-skill');
    expect(engine.renderForPrompt(result)).toContain('web-search');
  });

  it('filters getTier0SummariesByKind using excluded capability ids', () => {
    const summaries = engine.getTier0SummariesByKind(['research-skill']);

    expect(summaries.skills).not.toContain('research-skill');
    expect(summaries.tools).toContain('web-search');
  });
});

function embedText(text: string): number[] {
  const normalized = text.toLowerCase();
  return [
    normalized.includes('research') ? 1 : 0.2,
    normalized.includes('web') || normalized.includes('search') ? 1 : 0.2,
  ];
}
