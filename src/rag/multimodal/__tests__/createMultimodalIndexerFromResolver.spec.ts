/**
 * @module rag/multimodal/__tests__/createMultimodalIndexerFromResolver.spec
 *
 * Unit tests for {@link createMultimodalIndexerFromResolver}.
 *
 * Verifies that the factory function correctly resolves STT and vision
 * providers from the speech resolver and vision pipeline, then assembles
 * a working MultimodalIndexer.
 *
 * ## What is tested
 *
 * - STT provider is resolved and adapted from the speech resolver
 * - VisionPipeline is wrapped in PipelineVisionProvider
 * - Direct visionProvider passthrough when no pipeline is set
 * - VisionPipeline takes precedence over visionProvider when both set
 * - STT resolution failure is silently caught (no throw at construction)
 * - Missing resolver results in no STT provider
 * - Missing both vision options results in no vision provider
 * - Indexer correctly receives all adapted providers
 * - Config is forwarded to the indexer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMultimodalIndexerFromResolver } from '../createMultimodalIndexerFromResolver.js';
import { MultimodalIndexer } from '../MultimodalIndexer.js';
import type { IVisionProvider, ISpeechToTextProvider } from '../types.js';
import type { SpeechToTextProvider, SpeechTranscriptionResult } from '../../../speech/types.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock embedding manager with deterministic embeddings. */
function createMockEmbeddingManager() {
  return {
    generateEmbeddings: vi.fn(async () => ({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      modelId: 'test-model',
      providerId: 'test-provider',
      usage: { inputTokens: 10, totalTokens: 10, costUSD: 0 },
    })),
    getEmbeddingDimension: vi.fn(async () => 4),
    getEmbeddingModelInfo: vi.fn(async () => undefined),
    initialize: vi.fn(async () => {}),
    checkHealth: vi.fn(async () => ({ isHealthy: true })),
    shutdown: vi.fn(async () => {}),
  };
}

/** Create a mock vector store. */
function createMockVectorStore() {
  return {
    initialize: vi.fn(async () => {}),
    upsert: vi.fn(async (_collection: string, docs: unknown[]) => ({
      upsertedCount: (docs as unknown[]).length,
    })),
    query: vi.fn(async () => ({ documents: [] })),
    delete: vi.fn(async () => ({ deletedCount: 0 })),
    checkHealth: vi.fn(async () => ({ isHealthy: true })),
    shutdown: vi.fn(async () => {}),
  };
}

/** Create a mock SpeechToTextProvider. */
function createMockSpeechToTextProvider(): SpeechToTextProvider {
  return {
    id: 'mock-whisper',
    displayName: 'Mock Whisper',
    supportsStreaming: false,
    transcribe: vi.fn(async (): Promise<SpeechTranscriptionResult> => ({
      text: 'Resolved STT transcript.',
      language: 'en',
      cost: 0.001,
    })),
    getProviderName: vi.fn(() => 'mock-whisper'),
  };
}

/** Create a mock SpeechProviderResolver. */
function createMockResolver(sttProvider?: SpeechToTextProvider, shouldThrow = false) {
  return {
    resolveSTT: vi.fn(() => {
      if (shouldThrow) throw new Error('No configured STT provider matches requirements');
      return sttProvider ?? createMockSpeechToTextProvider();
    }),
    resolveTTS: vi.fn(),
    resolveVAD: vi.fn(),
    resolveWakeWord: vi.fn(),
    listProviders: vi.fn(() => []),
    register: vi.fn(),
    refresh: vi.fn(async () => {}),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

/** Create a mock VisionPipeline. */
function createMockVisionPipeline() {
  return {
    process: vi.fn(async () => ({
      text: 'A description from the vision pipeline.',
      confidence: 0.9,
      category: 'photograph' as const,
      tiers: ['cloud-vision' as const],
      tierResults: [],
      durationMs: 500,
    })),
    dispose: vi.fn(),
  };
}

/** Create a mock IVisionProvider. */
function createMockVisionProvider(): IVisionProvider {
  return {
    describeImage: vi.fn(async () => 'Direct vision provider description.'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMultimodalIndexerFromResolver', () => {
  let embeddingManager: ReturnType<typeof createMockEmbeddingManager>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;

  beforeEach(() => {
    embeddingManager = createMockEmbeddingManager();
    vectorStore = createMockVectorStore();
  });

  // -------------------------------------------------------------------------
  // Basic construction
  // -------------------------------------------------------------------------

  it('should return a MultimodalIndexer instance', () => {
    const indexer = createMultimodalIndexerFromResolver({
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    expect(indexer).toBeInstanceOf(MultimodalIndexer);
  });

  // -------------------------------------------------------------------------
  // STT resolution
  // -------------------------------------------------------------------------

  it('should resolve STT from the speech resolver and adapt it', async () => {
    const sttProvider = createMockSpeechToTextProvider();
    const resolver = createMockResolver(sttProvider);

    const indexer = createMultimodalIndexerFromResolver({
      resolver: resolver as any,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    // The resolver's resolveSTT should have been called
    expect(resolver.resolveSTT).toHaveBeenCalledTimes(1);

    // Audio indexing should work (provider is adapted and wired)
    const result = await indexer.indexAudio({
      audio: Buffer.from('audio data'),
      language: 'en',
    });

    expect(result.transcript).toBe('Resolved STT transcript.');
    expect(sttProvider.transcribe).toHaveBeenCalledTimes(1);
  });

  it('should silently catch STT resolution failure', () => {
    const resolver = createMockResolver(undefined, true);

    // Should NOT throw at construction time
    const indexer = createMultimodalIndexerFromResolver({
      resolver: resolver as any,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    expect(indexer).toBeInstanceOf(MultimodalIndexer);
  });

  it('should throw at call time when STT resolution failed and indexAudio is called', async () => {
    const resolver = createMockResolver(undefined, true);

    const indexer = createMultimodalIndexerFromResolver({
      resolver: resolver as any,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    await expect(
      indexer.indexAudio({ audio: Buffer.from('audio') }),
    ).rejects.toThrow(/no STT provider/i);
  });

  it('should have no STT when resolver is omitted', async () => {
    const indexer = createMultimodalIndexerFromResolver({
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    await expect(
      indexer.indexAudio({ audio: Buffer.from('audio') }),
    ).rejects.toThrow(/no STT provider/i);
  });

  // -------------------------------------------------------------------------
  // Vision resolution
  // -------------------------------------------------------------------------

  it('should wrap VisionPipeline in PipelineVisionProvider', async () => {
    const pipeline = createMockVisionPipeline();

    const indexer = createMultimodalIndexerFromResolver({
      visionPipeline: pipeline as any,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    const result = await indexer.indexImage({
      image: 'https://example.com/photo.jpg',
    });

    expect(result.description).toBe('A description from the vision pipeline.');
    expect(pipeline.process).toHaveBeenCalledTimes(1);
  });

  it('should use direct visionProvider when no pipeline is set', async () => {
    const visionProvider = createMockVisionProvider();

    const indexer = createMultimodalIndexerFromResolver({
      visionProvider,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    const result = await indexer.indexImage({
      image: 'https://example.com/photo.jpg',
    });

    expect(result.description).toBe('Direct vision provider description.');
  });

  it('should prefer visionPipeline over visionProvider when both are set', async () => {
    const pipeline = createMockVisionPipeline();
    const visionProvider = createMockVisionProvider();

    const indexer = createMultimodalIndexerFromResolver({
      visionPipeline: pipeline as any,
      visionProvider,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    const result = await indexer.indexImage({
      image: 'https://example.com/photo.jpg',
    });

    // Pipeline should win
    expect(result.description).toBe('A description from the vision pipeline.');
    expect(pipeline.process).toHaveBeenCalled();
    expect(visionProvider.describeImage).not.toHaveBeenCalled();
  });

  it('should throw at call time when no vision is configured and indexImage is called', async () => {
    const indexer = createMultimodalIndexerFromResolver({
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    await expect(
      indexer.indexImage({ image: 'https://example.com/photo.jpg' }),
    ).rejects.toThrow(/no vision provider/i);
  });

  // -------------------------------------------------------------------------
  // Config forwarding
  // -------------------------------------------------------------------------

  it('should forward config to the indexer', async () => {
    const indexer = createMultimodalIndexerFromResolver({
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
      visionProvider: createMockVisionProvider(),
      config: { defaultCollection: 'custom-collection' },
    });

    await indexer.indexImage({ image: 'https://example.com/img.jpg' });

    // Verify the custom collection was used for upsert
    expect(vectorStore.upsert.mock.calls[0][0]).toBe('custom-collection');
  });

  // -------------------------------------------------------------------------
  // Full integration: both STT and vision
  // -------------------------------------------------------------------------

  it('should wire both STT and vision when resolver and pipeline are provided', async () => {
    const sttProvider = createMockSpeechToTextProvider();
    const resolver = createMockResolver(sttProvider);
    const pipeline = createMockVisionPipeline();

    const indexer = createMultimodalIndexerFromResolver({
      resolver: resolver as any,
      visionPipeline: pipeline as any,
      embeddingManager: embeddingManager as any,
      vectorStore: vectorStore as any,
    });

    // Both image and audio indexing should work
    const imgResult = await indexer.indexImage({ image: 'https://example.com/photo.jpg' });
    expect(imgResult.description).toBe('A description from the vision pipeline.');

    const audioResult = await indexer.indexAudio({
      audio: Buffer.from('audio'),
      language: 'en',
    });
    expect(audioResult.transcript).toBe('Resolved STT transcript.');
  });
});
