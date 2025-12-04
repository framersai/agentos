/**
 * @file AgencyMemoryManager.spec.ts
 * @description Unit tests for AgencyMemoryManager - agency shared memory operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AgencyMemoryManager } from '../../src/core/agency/AgencyMemoryManager';
import type { AgencySession, AgencyMemoryConfig } from '../../src/core/agency/AgencyTypes';
import type { IVectorStoreManager } from '../../src/rag/VectorStoreManager';

// ============================================================================
// Mock Setup
// ============================================================================

const createMockProvider = () => ({
  collectionExists: vi.fn().mockResolvedValue(false),
  createCollection: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue({ succeeded: 1, failed: 0 }),
  query: vi.fn().mockResolvedValue({
    results: [
      {
        id: 'doc-1_chunk_0',
        content: 'Test content from researcher',
        score: 0.95,
        metadata: {
          contributorGmiId: 'gmi-1',
          contributorRoleId: 'researcher',
          category: 'finding',
        },
      },
    ],
  }),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  getStats: vi.fn().mockResolvedValue({ documentCount: 5, vectorCount: 15 }),
});

const createMockVectorStoreManager = (mockProvider: ReturnType<typeof createMockProvider>) =>
  ({
    getDefaultProvider: vi.fn().mockResolvedValue(mockProvider),
  }) as unknown as IVectorStoreManager;

const createMockSession = (overrides?: Partial<AgencySession>): AgencySession => ({
  agencyId: 'agency-test-123',
  workflowId: 'workflow-456',
  conversationId: 'conv-789',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  seats: {},
  memoryConfig: {
    enabled: true,
  },
  ...overrides,
});

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// ============================================================================
// Tests
// ============================================================================

describe('AgencyMemoryManager', () => {
  let mockProvider: ReturnType<typeof createMockProvider>;
  let mockVsm: IVectorStoreManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let manager: AgencyMemoryManager;

  beforeEach(() => {
    mockProvider = createMockProvider();
    mockVsm = createMockVectorStoreManager(mockProvider);
    mockLogger = createMockLogger();
    manager = new AgencyMemoryManager(mockVsm, mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initializeAgencyMemory', () => {
    it('creates collection when memory is enabled', async () => {
      const session = createMockSession();

      const result = await manager.initializeAgencyMemory(session);

      expect(result.success).toBe(true);
      expect(mockProvider.createCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'agency-shared-agency-test-123',
        }),
      );
      expect(manager.isInitialized(session.agencyId)).toBe(true);
    });

    it('skips initialization when memory is disabled', async () => {
      const session = createMockSession({
        memoryConfig: { enabled: false },
      });

      const result = await manager.initializeAgencyMemory(session);

      expect(result.success).toBe(true);
      expect(result.metadata?.reason).toBe('Agency memory not enabled');
      expect(mockProvider.createCollection).not.toHaveBeenCalled();
    });

    it('skips if already initialized', async () => {
      const session = createMockSession();

      // Initialize twice
      await manager.initializeAgencyMemory(session);
      const result = await manager.initializeAgencyMemory(session);

      expect(result.success).toBe(true);
      expect(result.metadata?.alreadyInitialized).toBe(true);
      // Should only be called once
      expect(mockProvider.createCollection).toHaveBeenCalledTimes(1);
    });

    it('handles initialization errors gracefully', async () => {
      mockProvider.createCollection.mockRejectedValue(new Error('DB connection failed'));
      const session = createMockSession();

      const result = await manager.initializeAgencyMemory(session);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
    });
  });

  // ==========================================================================
  // Ingestion Tests
  // ==========================================================================

  describe('ingestToSharedMemory', () => {
    it('ingests document with proper metadata', async () => {
      const agencyId = 'agency-test-123';
      const config: AgencyMemoryConfig = { enabled: true };

      const result = await manager.ingestToSharedMemory(
        agencyId,
        {
          content: 'Important research finding',
          contributorGmiId: 'gmi-1',
          contributorRoleId: 'researcher',
          category: 'finding',
        },
        config,
      );

      expect(result.success).toBe(true);
      expect(result.documentsAffected).toBe(1);
      expect(mockProvider.upsert).toHaveBeenCalledWith(
        'agency-shared-agency-test-123',
        expect.objectContaining({
          documents: expect.arrayContaining([
            expect.objectContaining({
              content: 'Important research finding',
              metadata: expect.objectContaining({
                agencyId,
                contributorGmiId: 'gmi-1',
                contributorRoleId: 'researcher',
                category: 'finding',
              }),
            }),
          ]),
        }),
      );
    });

    it('rejects write from unauthorized role', async () => {
      const agencyId = 'agency-test-123';
      const config: AgencyMemoryConfig = {
        enabled: true,
        writeRoles: ['researcher', 'lead'], // Only these roles can write
      };

      const result = await manager.ingestToSharedMemory(
        agencyId,
        {
          content: 'Unauthorized content',
          contributorGmiId: 'gmi-2',
          contributorRoleId: 'assistant', // Not in writeRoles
        },
        config,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not authorized');
      expect(mockProvider.upsert).not.toHaveBeenCalled();
    });

    it('fails when memory is disabled', async () => {
      const result = await manager.ingestToSharedMemory(
        'agency-123',
        {
          content: 'Test',
          contributorGmiId: 'gmi-1',
          contributorRoleId: 'researcher',
        },
        { enabled: false },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agency memory not enabled');
    });
  });

  // ==========================================================================
  // Query Tests
  // ==========================================================================

  describe('querySharedMemory', () => {
    it('queries and transforms results correctly', async () => {
      const agencyId = 'agency-test-123';
      const config: AgencyMemoryConfig = { enabled: true };

      const result = await manager.querySharedMemory(
        agencyId,
        {
          query: 'What did the researcher find?',
          requestingGmiId: 'gmi-2',
          requestingRoleId: 'analyst',
        },
        config,
      );

      expect(result.success).toBe(true);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toMatchObject({
        content: 'Test content from researcher',
        score: 0.95,
        contributorRoleId: 'researcher',
        category: 'finding',
      });
    });

    it('filters by roles when specified', async () => {
      const agencyId = 'agency-test-123';

      await manager.querySharedMemory(
        agencyId,
        {
          query: 'Test query',
          requestingGmiId: 'gmi-2',
          requestingRoleId: 'analyst',
          fromRoles: ['researcher', 'lead'],
        },
        { enabled: true },
      );

      expect(mockProvider.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          filter: expect.objectContaining({
            contributorRoleId: { $in: ['researcher', 'lead'] },
          }),
        }),
      );
    });

    it('rejects read from unauthorized role', async () => {
      const config: AgencyMemoryConfig = {
        enabled: true,
        readRoles: ['analyst', 'lead'],
      };

      const result = await manager.querySharedMemory(
        'agency-123',
        {
          query: 'Secret query',
          requestingGmiId: 'gmi-3',
          requestingRoleId: 'observer', // Not in readRoles
        },
        config,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not authorized');
    });

    it('applies threshold filtering', async () => {
      mockProvider.query.mockResolvedValue({
        results: [
          { id: 'doc-1', content: 'High match', score: 0.9, metadata: {} },
          { id: 'doc-2', content: 'Low match', score: 0.3, metadata: {} },
        ],
      });

      const result = await manager.querySharedMemory(
        'agency-123',
        {
          query: 'Test',
          requestingGmiId: 'gmi-1',
          requestingRoleId: 'analyst',
          threshold: 0.5,
        },
        { enabled: true },
      );

      expect(result.success).toBe(true);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].score).toBe(0.9);
    });
  });

  // ==========================================================================
  // Cleanup Tests
  // ==========================================================================

  describe('cleanupAgencyMemory', () => {
    it('deletes collection and clears state', async () => {
      const session = createMockSession();

      // Initialize first
      await manager.initializeAgencyMemory(session);
      expect(manager.isInitialized(session.agencyId)).toBe(true);

      // Cleanup
      const result = await manager.cleanupAgencyMemory(session.agencyId);

      expect(result.success).toBe(true);
      expect(mockProvider.deleteCollection).toHaveBeenCalledWith('agency-shared-agency-test-123');
      expect(manager.isInitialized(session.agencyId)).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('handles null VectorStoreManager gracefully', async () => {
      const managerNoVsm = new AgencyMemoryManager(null, mockLogger);
      const session = createMockSession();

      const initResult = await managerNoVsm.initializeAgencyMemory(session);
      expect(initResult.success).toBe(false);
      expect(initResult.error).toBe('VectorStoreManager not available');

      const ingestResult = await managerNoVsm.ingestToSharedMemory(
        'agency-123',
        {
          content: 'Test',
          contributorGmiId: 'gmi-1',
          contributorRoleId: 'researcher',
        },
        { enabled: true },
      );
      expect(ingestResult.success).toBe(false);

      const queryResult = await managerNoVsm.querySharedMemory(
        'agency-123',
        {
          query: 'Test',
          requestingGmiId: 'gmi-1',
          requestingRoleId: 'analyst',
        },
        { enabled: true },
      );
      expect(queryResult.success).toBe(false);
    });

    it('uses default config when none provided', async () => {
      const agencyId = 'agency-test-123';

      // Query without explicit config - should use default (disabled)
      const result = await manager.querySharedMemory(agencyId, {
        query: 'Test',
        requestingGmiId: 'gmi-1',
        requestingRoleId: 'analyst',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agency memory not enabled');
    });
  });
});

