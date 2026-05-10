import { describe, expect, it, vi } from 'vitest';
import { AgencyMemoryManager } from '../AgencyMemoryManager.js';
import type { IVectorStoreManager } from '../../../core/vector-store/IVectorStoreManager.js';

describe('AgencyMemoryManager', () => {
  it('aggregates stats using contributorRoleId metadata', async () => {
    const provider = {
      getStats: vi.fn().mockResolvedValue({ documentCount: 3, vectorCount: 7 }),
      listDocuments: vi.fn().mockResolvedValue({
        documents: [
          { metadata: { contributorRoleId: 'researcher', category: 'finding' } },
          { metadata: { contributorRoleId: 'researcher', category: 'summary' } },
          { metadata: { contributorRoleId: 'lead', category: 'decision' } },
        ],
      }),
    };

    const vectorStoreManager = {
      getDefaultProvider: vi.fn().mockReturnValue(provider),
    } as unknown as IVectorStoreManager;

    const manager = new AgencyMemoryManager(vectorStoreManager);
    const stats = await manager.getStats('agency-1');

    expect(stats).toEqual({
      totalDocuments: 3,
      totalChunks: 7,
      documentsByRole: {
        researcher: 2,
        lead: 1,
      },
      documentsByCategory: {
        finding: 1,
        summary: 1,
        decision: 1,
      },
    });
  });
});
