/**
 * @fileoverview Tests for HydeRetriever — HyDE (Hypothetical Document Embedding) retriever.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HydeRetriever,
  resolveHydeConfig,
  DEFAULT_HYDE_CONFIG,
  type HydeLlmCaller,
  type HydeConfig,
} from '../HydeRetriever.js';
import type { IEmbeddingManager, EmbeddingResponse } from '../IEmbeddingManager.js';
import type { IVectorStore, QueryResult, QueryOptions } from '../IVectorStore.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockEmbeddingManager(embedding: number[] = [0.1, 0.2, 0.3]): IEmbeddingManager {
  return {
    initialize: vi.fn(),
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings: [embedding],
      modelId: 'test-model',
      providerId: 'test-provider',
      usage: { totalTokens: 10 },
    } satisfies EmbeddingResponse),
    getEmbeddingModelInfo: vi.fn(),
    getEmbeddingDimension: vi.fn().mockResolvedValue(3),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  };
}

function createMockVectorStore(results: QueryResult = { documents: [] }): IVectorStore {
  return {
    initialize: vi.fn(),
    upsert: vi.fn(),
    query: vi.fn().mockResolvedValue(results),
    delete: vi.fn(),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
    shutdown: vi.fn(),
  };
}

function createMockLlmCaller(response = 'This is a hypothetical answer'): HydeLlmCaller {
  return vi.fn().mockResolvedValue(response);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('resolveHydeConfig', () => {
  it('returns defaults when called with no arguments', () => {
    const config = resolveHydeConfig();
    expect(config).toEqual(DEFAULT_HYDE_CONFIG);
  });

  it('merges partial overrides with defaults', () => {
    const config = resolveHydeConfig({ enabled: true, initialThreshold: 0.9 });
    expect(config.enabled).toBe(true);
    expect(config.initialThreshold).toBe(0.9);
    expect(config.minThreshold).toBe(DEFAULT_HYDE_CONFIG.minThreshold);
    expect(config.adaptiveThreshold).toBe(DEFAULT_HYDE_CONFIG.adaptiveThreshold);
  });
});

describe('HydeRetriever', () => {
  let llmCaller: ReturnType<typeof createMockLlmCaller>;
  let embeddingManager: ReturnType<typeof createMockEmbeddingManager>;

  beforeEach(() => {
    llmCaller = createMockLlmCaller();
    embeddingManager = createMockEmbeddingManager();
  });

  // ── enabled getter ──────────────────────────────────────────────────

  describe('enabled getter', () => {
    it('returns false when config.enabled is false (default)', () => {
      const retriever = new HydeRetriever({
        llmCaller,
        embeddingManager,
      });
      expect(retriever.enabled).toBe(false);
    });

    it('returns true when config.enabled is true', () => {
      const retriever = new HydeRetriever({
        config: { enabled: true },
        llmCaller,
        embeddingManager,
      });
      expect(retriever.enabled).toBe(true);
    });
  });

  // ── generateHypothesis ──────────────────────────────────────────────

  describe('generateHypothesis', () => {
    it('calls LLM with system prompt and user query, returns trimmed result', async () => {
      const retriever = new HydeRetriever({
        config: { enabled: true },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.generateHypothesis('What is RAG?');

      expect(llmCaller).toHaveBeenCalledOnce();
      expect(llmCaller).toHaveBeenCalledWith(
        expect.stringContaining('knowledgeable assistant'),
        'What is RAG?',
      );
      expect(result.hypothesis).toBe('This is a hypothetical answer');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('trims whitespace from LLM response', async () => {
      const caller = createMockLlmCaller('  hypothesis with spaces  \n');
      const retriever = new HydeRetriever({
        config: { enabled: true },
        llmCaller: caller,
        embeddingManager,
      });

      const result = await retriever.generateHypothesis('query');
      expect(result.hypothesis).toBe('hypothesis with spaces');
    });
  });

  // ── retrieve ────────────────────────────────────────────────────────

  describe('retrieve', () => {
    it('returns on first hit when results found (no stepping)', async () => {
      const doc = {
        id: 'doc-1',
        embedding: [0.1],
        textContent: 'Some content',
        similarityScore: 0.8,
      };
      const vectorStore = createMockVectorStore({ documents: [doc] });

      const retriever = new HydeRetriever({
        config: { enabled: true, adaptiveThreshold: true },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieve({
        query: 'test query',
        vectorStore,
        collectionName: 'test-collection',
      });

      expect(result.queryResult.documents).toHaveLength(1);
      expect(result.queryResult.documents[0].id).toBe('doc-1');
      expect(result.thresholdSteps).toBe(0);
      expect(result.effectiveThreshold).toBe(0.7); // initialThreshold default
      // query should be called only once — no stepping
      expect(vectorStore.query).toHaveBeenCalledOnce();
    });

    it('steps down threshold when no results (adaptive thresholding)', async () => {
      const vectorStore = createMockVectorStore({ documents: [] });

      const retriever = new HydeRetriever({
        config: {
          enabled: true,
          adaptiveThreshold: true,
          initialThreshold: 0.7,
          minThreshold: 0.5,
          thresholdStep: 0.1,
        },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieve({
        query: 'obscure query',
        vectorStore,
        collectionName: 'test-collection',
      });

      // With initial=0.7, min=0.5, step=0.1 => tries 0.7, 0.6, 0.5 = 3 calls, 2 steps
      expect(vectorStore.query).toHaveBeenCalledTimes(3);
      expect(result.thresholdSteps).toBe(2);
      expect(result.queryResult.documents).toHaveLength(0);
      expect(result.effectiveThreshold).toBe(0.5);
    });

    it('does not step when adaptiveThreshold is false', async () => {
      const vectorStore = createMockVectorStore({ documents: [] });

      const retriever = new HydeRetriever({
        config: {
          enabled: true,
          adaptiveThreshold: false,
          initialThreshold: 0.7,
          minThreshold: 0.3,
          thresholdStep: 0.1,
        },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieve({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
      });

      // Should query exactly once and then break
      expect(vectorStore.query).toHaveBeenCalledOnce();
      expect(result.thresholdSteps).toBe(0);
    });

    it('uses pre-supplied hypothesis and skips LLM call', async () => {
      const doc = {
        id: 'doc-2',
        embedding: [0.2],
        textContent: 'Relevant content',
        similarityScore: 0.9,
      };
      const vectorStore = createMockVectorStore({ documents: [doc] });

      const retriever = new HydeRetriever({
        config: { enabled: true },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieve({
        query: 'test query',
        vectorStore,
        collectionName: 'test-collection',
        hypothesis: 'Pre-supplied hypothesis',
      });

      // LLM should NOT be called
      expect(llmCaller).not.toHaveBeenCalled();
      // But embedding should be called with the supplied hypothesis
      expect(embeddingManager.generateEmbeddings).toHaveBeenCalledWith({
        texts: ['Pre-supplied hypothesis'],
      });
      expect(result.hypothesis).toBe('Pre-supplied hypothesis');
      expect(result.hypothesisLatencyMs).toBe(0);
    });

    it('returns empty result when embedding generation fails', async () => {
      const emptyEmbedding = createMockEmbeddingManager();
      (emptyEmbedding.generateEmbeddings as ReturnType<typeof vi.fn>).mockResolvedValue({
        embeddings: [[]],
        modelId: 'test',
        providerId: 'test',
        usage: { totalTokens: 0 },
      });

      const vectorStore = createMockVectorStore();

      const retriever = new HydeRetriever({
        config: { enabled: true },
        llmCaller,
        embeddingManager: emptyEmbedding,
      });

      const result = await retriever.retrieve({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
      });

      expect(result.hypothesisEmbedding).toEqual([]);
      expect(result.queryResult.documents).toEqual([]);
      // vectorStore.query should NOT be called when embedding is empty
      expect(vectorStore.query).not.toHaveBeenCalled();
    });

    it('passes queryOptions through to vectorStore.query', async () => {
      const vectorStore = createMockVectorStore({ documents: [] });

      const retriever = new HydeRetriever({
        config: { enabled: true, adaptiveThreshold: false },
        llmCaller,
        embeddingManager,
      });

      await retriever.retrieve({
        query: 'test',
        vectorStore,
        collectionName: 'my-collection',
        queryOptions: { topK: 3 },
      });

      expect(vectorStore.query).toHaveBeenCalledWith(
        'my-collection',
        [0.1, 0.2, 0.3],
        expect.objectContaining({ topK: 3 }),
      );
    });

    it('steps down and stops when results found mid-way', async () => {
      const doc = {
        id: 'doc-mid',
        embedding: [0.5],
        textContent: 'Found at lower threshold',
        similarityScore: 0.55,
      };
      const vectorStore = createMockVectorStore();
      // First two calls return empty, third call returns a result
      (vectorStore.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ documents: [] })
        .mockResolvedValueOnce({ documents: [] })
        .mockResolvedValueOnce({ documents: [doc] });

      const retriever = new HydeRetriever({
        config: {
          enabled: true,
          adaptiveThreshold: true,
          initialThreshold: 0.7,
          minThreshold: 0.3,
          thresholdStep: 0.1,
        },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieve({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
      });

      expect(vectorStore.query).toHaveBeenCalledTimes(3);
      expect(result.thresholdSteps).toBe(2);
      expect(result.queryResult.documents).toHaveLength(1);
      expect(result.effectiveThreshold).toBe(0.5);
    });
  });

  // ── retrieveContext ─────────────────────────────────────────────────

  describe('retrieveContext', () => {
    it('formats retrieved chunks into a joined string', async () => {
      const docs = [
        { id: '1', embedding: [], textContent: 'Chunk A', similarityScore: 0.9 },
        { id: '2', embedding: [], textContent: 'Chunk B', similarityScore: 0.8 },
        { id: '3', embedding: [], textContent: '', similarityScore: 0.7 }, // empty — should be filtered
      ];
      const vectorStore = createMockVectorStore({ documents: docs });

      const retriever = new HydeRetriever({
        config: { enabled: true, adaptiveThreshold: false },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieveContext({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
      });

      expect(result.context).toBe('Chunk A\n\n---\n\nChunk B');
      expect(result.chunkCount).toBe(2); // empty chunk filtered out
      expect(result.hypothesis).toBe('This is a hypothetical answer');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('uses custom separator', async () => {
      const docs = [
        { id: '1', embedding: [], textContent: 'X', similarityScore: 0.9 },
        { id: '2', embedding: [], textContent: 'Y', similarityScore: 0.8 },
      ];
      const vectorStore = createMockVectorStore({ documents: docs });

      const retriever = new HydeRetriever({
        config: { enabled: true, adaptiveThreshold: false },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieveContext({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
        separator: ' | ',
      });

      expect(result.context).toBe('X | Y');
    });

    it('returns empty context when no documents found', async () => {
      const vectorStore = createMockVectorStore({ documents: [] });

      const retriever = new HydeRetriever({
        config: { enabled: true, adaptiveThreshold: false },
        llmCaller,
        embeddingManager,
      });

      const result = await retriever.retrieveContext({
        query: 'test',
        vectorStore,
        collectionName: 'test-collection',
      });

      expect(result.context).toBe('');
      expect(result.chunkCount).toBe(0);
    });
  });
});
