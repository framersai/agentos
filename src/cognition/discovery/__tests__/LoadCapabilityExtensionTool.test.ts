import { describe, expect, it, vi } from 'vitest';

import { createLoadCapabilityExtensionTool } from '../LoadCapabilityExtensionTool.js';

describe('createLoadCapabilityExtensionTool', () => {
  it('loads a runtime extension and returns the registered tool names', async () => {
    const loadExtensionAtRuntime = vi.fn(async () => ['omdb_search', 'omdb_details']);
    const tool = createLoadCapabilityExtensionTool({
      loadExtensionAtRuntime,
    } as any);

    const result = await tool.execute(
      { extensionId: 'omdb' },
      {} as any,
    );

    expect(loadExtensionAtRuntime).toHaveBeenCalledWith('omdb');
    expect(result).toEqual({
      success: true,
      output: {
        extensionId: 'omdb',
        registeredTools: ['omdb_search', 'omdb_details'],
      },
    });
  });

  it('returns a failure when runtime loading is unavailable', async () => {
    const tool = createLoadCapabilityExtensionTool({} as any);

    const result = await tool.execute(
      { extensionId: 'omdb' },
      {} as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('returns a failure when no tools were registered', async () => {
    const tool = createLoadCapabilityExtensionTool({
      loadExtensionAtRuntime: vi.fn(async () => []),
    } as any);

    const result = await tool.execute(
      { extensionId: 'missing-extension' },
      {} as any,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be loaded');
  });
});
