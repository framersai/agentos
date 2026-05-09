import { describe, expect, it, vi } from 'vitest';

vi.mock('@framers/agentos-extensions-registry', () => ({
  TOOL_CATALOG: [
    {
      name: 'omdb',
      createPack: () => ({}),
    },
  ],
}));

import { createDiscoverCapabilitiesTool } from '../DiscoverCapabilitiesTool.js';

describe('createDiscoverCapabilitiesTool', () => {
  it('returns loadable tool results with the owning extension id', async () => {
    const discoveryEngine = {
      isInitialized: () => true,
      listCapabilityIds: () => ['tool:omdb_search'],
      discover: vi.fn(async () => ({
        tier1: [
          {
            relevanceScore: 0.87,
            capability: {
              id: 'tool:omdb_search',
              name: 'omdb_search',
              displayName: 'OMDB Search',
              kind: 'tool',
              description: 'Search movies and TV shows',
              category: 'media',
              available: true,
              sourceRef: {
                type: 'extension',
                packageName: 'omdb',
                extensionId: 'omdb',
              },
            },
          },
        ],
      })),
    } as any;

    const tool = createDiscoverCapabilitiesTool(discoveryEngine, {
      getTool: vi.fn(async () => undefined),
    } as any);

    const result = await tool.execute({ query: 'movie ratings', kind: 'tool' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.output?.capabilities).toEqual([
      expect.objectContaining({
        id: 'tool:omdb_search',
        name: 'OMDB Search',
        loadable: true,
        extensionId: 'omdb',
      }),
    ]);
  });
});
