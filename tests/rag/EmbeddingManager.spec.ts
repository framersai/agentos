/**
 * @file EmbeddingManager.spec.ts
 * @description Unit tests for the EmbeddingManager class.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingManager } from '../../src/rag/EmbeddingManager';
import type { AIModelProviderManager } from '../../src/core/llm/providers/AIModelProviderManager';
import type { EmbeddingManagerConfig } from '../../src/config/EmbeddingManagerConfiguration';

// Mock provider manager
const createMockProviderManager = (embeddings: number[][] = [[0.1, 0.2, 0.3]]): AIModelProviderManager => {
  const mockProvider = {
    generateEmbeddings: vi.fn().mockResolvedValue({
      embeddings,
      model: 'test-embedding-model',
      usage: { promptTokens: 10, totalTokens: 10 },
    }),
  };
  return {
    getProvider: vi.fn().mockReturnValue(mockProvider),
    getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
  } as unknown as AIModelProviderManager;
};

describe('EmbeddingManager', () => {
  let manager: EmbeddingManager;
  let mockProviderManager: AIModelProviderManager;

  const defaultConfig: EmbeddingManagerConfig = {
    embeddingModels: [
      {
        modelId: 'test-embedding-model',
        providerId: 'openai',
        dimension: 1536,
        maxInputTokens: 8192,
      },
    ],
    defaultModelId: 'test-embedding-model',
  };

  beforeEach(async () => {
    mockProviderManager = createMockProviderManager();
    manager = new EmbeddingManager();
    await manager.initialize(defaultConfig, mockProviderManager);
  });

  describe('initialization', () => {
    it('should initialize successfully with valid config', async () => {
      const newManager = new EmbeddingManager();
      await newManager.initialize(defaultConfig, mockProviderManager);
      expect(newManager).toBeDefined();
    });

    it('should throw error if initialized twice without shutdown', async () => {
      const newManager = new EmbeddingManager();
      await newManager.initialize(defaultConfig, mockProviderManager);
      // Second initialization should work (reinitialize)
      await newManager.initialize(defaultConfig, mockProviderManager);
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for a single text', async () => {
      const result = await manager.generateEmbeddings({
        texts: 'Hello world',
      });

      expect(result.embeddings).toBeDefined();
      expect(result.embeddings.length).toBe(1);
      expect(result.modelId).toBe('test-embedding-model');
    });

    it('should generate embeddings for multiple texts', async () => {
      mockProviderManager = createMockProviderManager([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ]);
      manager = new EmbeddingManager();
      await manager.initialize(defaultConfig, mockProviderManager);

      const result = await manager.generateEmbeddings({
        texts: ['Text 1', 'Text 2', 'Text 3'],
      });

      expect(result.embeddings).toBeDefined();
      expect(result.embeddings.length).toBe(3);
    });

    it('should use specified model if provided', async () => {
      const result = await manager.generateEmbeddings({
        texts: 'Test text',
        modelId: 'test-embedding-model',
      });

      expect(result.modelId).toBe('test-embedding-model');
    });

    it('should handle empty text array', async () => {
      mockProviderManager = createMockProviderManager([]);
      manager = new EmbeddingManager();
      await manager.initialize(defaultConfig, mockProviderManager);

      const result = await manager.generateEmbeddings({
        texts: [],
      });

      expect(result.embeddings).toHaveLength(0);
    });
  });

  describe('getEmbeddingModelInfo', () => {
    it('should return model info for existing model', async () => {
      const info = await manager.getEmbeddingModelInfo('test-embedding-model');
      expect(info).toBeDefined();
      expect(info?.modelId).toBe('test-embedding-model');
      expect(info?.dimension).toBe(1536);
    });

    it('should return default model info if no modelId provided', async () => {
      const info = await manager.getEmbeddingModelInfo();
      expect(info).toBeDefined();
      expect(info?.modelId).toBe('test-embedding-model');
    });

    it('should return undefined for non-existent model', async () => {
      const info = await manager.getEmbeddingModelInfo('non-existent-model');
      expect(info).toBeUndefined();
    });
  });

  describe('getEmbeddingDimension', () => {
    it('should return dimension for existing model', async () => {
      const dimension = await manager.getEmbeddingDimension('test-embedding-model');
      expect(dimension).toBe(1536);
    });

    it('should return default dimension if no modelId provided', async () => {
      const dimension = await manager.getEmbeddingDimension();
      expect(dimension).toBe(1536);
    });
  });

  describe('checkHealth', () => {
    it('should return healthy status when initialized', async () => {
      const health = await manager.checkHealth();
      expect(health.isHealthy).toBe(true);
    });

    it('should return unhealthy status when not initialized', async () => {
      const newManager = new EmbeddingManager();
      const health = await newManager.checkHealth();
      expect(health.isHealthy).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await manager.shutdown?.();
      const health = await manager.checkHealth();
      expect(health.isHealthy).toBe(false);
    });
  });
});


