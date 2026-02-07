/**
 * @file ExtensionManager.spec.ts
 * @description Unit tests for the Extension Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionManager } from '../../src/extensions/ExtensionManager';
import type {
  ExtensionDescriptor,
  ExtensionLifecycleContext,
} from '../../src/extensions/types';
import type {
  ExtensionManifest,
  ExtensionPack,
  ExtensionPackManifestEntry,
} from '../../src/extensions/manifest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function createTestPack(name = 'test-pack', descriptors: ExtensionDescriptor[] = []): ExtensionPack {
  return {
    name,
    version: '1.0.0',
    descriptors: descriptors.length > 0 ? descriptors : [
      {
        id: 'test-tool',
        kind: 'tool',
        payload: {
          name: 'test-tool',
          displayName: 'Test Tool',
          description: 'A test tool',
          execute: vi.fn(),
        },
      },
    ],
  };
}

function createTestDescriptor(id: string, kind: string = 'tool'): ExtensionDescriptor {
  return {
    id,
    kind,
    payload: {
      name: id,
      description: `Test ${kind}`,
      execute: vi.fn(),
    },
  };
}

async function createTempExtensionModule(): Promise<{ dir: string; entry: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-ext-pack-'));
  const entry = path.join(dir, 'pack.mjs');
  const contents = `
    export function createExtensionPack() {
      return {
        name: 'temp-pack',
        version: '0.0.0',
        descriptors: [
          {
            id: 'temp-tool',
            kind: 'tool',
            payload: { name: 'temp-tool', description: 'temp', execute: async () => ({ success: true }) },
          },
        ],
      };
    }
    export default createExtensionPack;
  `;
  await fs.writeFile(entry, contents, 'utf8');
  return { dir, entry };
}

describe('ExtensionManager', () => {
  let manager: ExtensionManager;

  beforeEach(() => {
    manager = new ExtensionManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const mgr = new ExtensionManager();
      expect(mgr).toBeDefined();
    });

    it('should create with manifest', () => {
      const manifest: ExtensionManifest = {
        packs: [],
      };
      const mgr = new ExtensionManager({ manifest });
      expect(mgr).toBeDefined();
    });

    it('should store secrets', () => {
      const mgr = new ExtensionManager({
        secrets: {
          API_KEY: 'test-key',
          EMPTY_KEY: '',
        },
      });
      expect(mgr).toBeDefined();
    });
  });

  describe('loadManifest', () => {
    it('should load packs from manifest', async () => {
      const pack = createTestPack();
      const manifest: ExtensionManifest = {
        packs: [
          {
            factory: async () => pack,
            identifier: 'test-pack',
          },
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      const listener = vi.fn();
      mgr.on(listener);

      await mgr.loadManifest();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pack:loaded',
        })
      );
    });

    it('should skip disabled packs', async () => {
      const pack = createTestPack();
      const manifest: ExtensionManifest = {
        packs: [
          {
            factory: async () => pack,
            identifier: 'disabled-pack',
            enabled: false,
          },
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      const listener = vi.fn();
      mgr.on(listener);

      await mgr.loadManifest();

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle pack load errors', async () => {
      const manifest: ExtensionManifest = {
        packs: [
          {
            factory: async () => {
              throw new Error('Load failed');
            },
            identifier: 'failing-pack',
          },
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      const listener = vi.fn();
      mgr.on(listener);

      await mgr.loadManifest();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pack:failed',
        })
      );
    });

    it('should do nothing without manifest', async () => {
      const mgr = new ExtensionManager();
      await mgr.loadManifest(); // Should not throw
    });

    it('should skip null packs from resolvePack', async () => {
      const manifest: ExtensionManifest = {
        packs: [
          {
            // No factory, package, or module - will return null
            identifier: 'null-pack',
          } as ExtensionPackManifestEntry,
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      const listener = vi.fn();
      mgr.on(listener);

      await mgr.loadManifest();

      // Should not emit pack:loaded since pack was null
      expect(listener).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pack:loaded' })
      );
    });

    it('should resolve a pack from a module entry', async () => {
      const temp = await createTempExtensionModule();
      try {
        const manifest: ExtensionManifest = {
          packs: [{ module: temp.entry, identifier: 'temp-module-pack' } as ExtensionPackManifestEntry],
        };
        const mgr = new ExtensionManager({ manifest });
        await mgr.loadManifest();

        const toolRegistry = mgr.getRegistry<any>('tool');
        expect(toolRegistry.getActive('temp-tool')).toBeDefined();
      } finally {
        await fs.rm(temp.dir, { recursive: true, force: true });
      }
    });

    it('should resolve a pack from a package entry (file URL specifier)', async () => {
      const temp = await createTempExtensionModule();
      try {
        const manifest: ExtensionManifest = {
          packs: [{ package: pathToFileURL(temp.entry).href, identifier: 'temp-package-pack' } as ExtensionPackManifestEntry],
        };
        const mgr = new ExtensionManager({ manifest });
        await mgr.loadManifest();

        const toolRegistry = mgr.getRegistry<any>('tool');
        expect(toolRegistry.getActive('temp-tool')).toBeDefined();
      } finally {
        await fs.rm(temp.dir, { recursive: true, force: true });
      }
    });

    it('should apply overrides to skip a descriptor', async () => {
      const pack = createTestPack('override-pack', [createTestDescriptor('override-tool', 'tool')]);
      const manifest: ExtensionManifest = {
        packs: [{ factory: async () => pack, identifier: 'override-pack' }],
      };
      const mgr = new ExtensionManager({
        manifest,
        overrides: { tools: { 'override-tool': { enabled: false } } },
      });

      await mgr.loadManifest();
      const toolRegistry = mgr.getRegistry<any>('tool');
      expect(toolRegistry.getActive('override-tool')).toBeUndefined();
    });

    it('should hydrate required secrets from pack options.secrets', async () => {
      const pack: ExtensionPack = {
        name: 'secret-pack',
        version: '0.0.0',
        descriptors: [
          {
            id: 'secret-tool',
            kind: 'tool',
            payload: { name: 'secret-tool', description: 'secret', execute: vi.fn() },
            requiredSecrets: [{ id: 'giphy.apiKey' }],
          } as any,
        ],
      };

      const manifest: ExtensionManifest = {
        packs: [
          {
            factory: async () => pack,
            identifier: 'secret-pack',
            options: { secrets: { 'giphy.apiKey': 'test-key' } },
          },
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      await mgr.loadManifest();

      const toolRegistry = mgr.getRegistry<any>('tool');
      expect(toolRegistry.getActive('secret-tool')).toBeDefined();
    });

    it('should resolve required secrets from environment variables (secret catalog mapping)', async () => {
      const prev = process.env.GIPHY_API_KEY;
      process.env.GIPHY_API_KEY = 'env-key';

      try {
        const pack: ExtensionPack = {
          name: 'env-secret-pack',
          version: '0.0.0',
          descriptors: [
            {
              id: 'env-secret-tool',
              kind: 'tool',
              payload: { name: 'env-secret-tool', description: 'secret', execute: vi.fn() },
              requiredSecrets: [{ id: 'giphy.apiKey' }],
            } as any,
          ],
        };

        const manifest: ExtensionManifest = {
          packs: [{ factory: async () => pack, identifier: 'env-secret-pack' }],
        };

        const mgr = new ExtensionManager({ manifest });
        await mgr.loadManifest();

        const toolRegistry = mgr.getRegistry<any>('tool');
        expect(toolRegistry.getActive('env-secret-tool')).toBeDefined();
      } finally {
        if (prev === undefined) {
          delete process.env.GIPHY_API_KEY;
        } else {
          process.env.GIPHY_API_KEY = prev;
        }
      }
    });
  });

  describe('loadPackFromFactory', () => {
    it('should load pack from factory', async () => {
      const pack = createTestPack();
      const listener = vi.fn();
      manager.on(listener);

      await manager.loadPackFromFactory(pack, 'test-pack');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pack:loaded',
          source: expect.objectContaining({
            sourceName: 'test-pack',
          }),
        })
      );
    });

    it('should register all descriptors from pack', async () => {
      const pack = createTestPack('multi-descriptor', [
        createTestDescriptor('tool1', 'tool'),
        createTestDescriptor('guardrail1', 'guardrail'),
      ]);

      const listener = vi.fn();
      manager.on(listener);

      await manager.loadPackFromFactory(pack);

      const activatedEvents = listener.mock.calls.filter(
        (call) => call[0].type === 'descriptor:activated'
      );
      expect(activatedEvents.length).toBe(2);
    });

    it('should pass lifecycle context', async () => {
      const pack = createTestPack();
      const context: ExtensionLifecycleContext = {
        getSecret: vi.fn(),
      };

      await manager.loadPackFromFactory(pack, 'test-pack', {}, context);
      // Should not throw
    });
  });

  describe('getRegistry', () => {
    it('should return registry for kind', () => {
      const registry = manager.getRegistry('tool');
      expect(registry).toBeDefined();
      expect(registry.kind).toBe('tool');
    });

    it('should create registry if not exists', () => {
      const registry = manager.getRegistry('custom-kind');
      expect(registry).toBeDefined();
      expect(registry.kind).toBe('custom-kind');
    });

    it('should return same registry for same kind', () => {
      const registry1 = manager.getRegistry('tool');
      const registry2 = manager.getRegistry('tool');
      expect(registry1).toBe(registry2);
    });

    it('should have default registries', () => {
      const toolRegistry = manager.getRegistry('tool');
      const guardrailRegistry = manager.getRegistry('guardrail');
      const responseRegistry = manager.getRegistry('response-processor');
      const workflowRegistry = manager.getRegistry('workflow');

      expect(toolRegistry).toBeDefined();
      expect(guardrailRegistry).toBeDefined();
      expect(responseRegistry).toBeDefined();
      expect(workflowRegistry).toBeDefined();
    });
  });

  describe('event listeners', () => {
    it('should add event listener', () => {
      const listener = vi.fn();
      manager.on(listener);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove event listener', () => {
      const listener = vi.fn();
      manager.on(listener);
      manager.off(listener);
      // Listener removed
    });

    it('should emit descriptor events', async () => {
      const pack = createTestPack();
      const listener = vi.fn();
      manager.on(listener);

      await manager.loadPackFromFactory(pack);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
          kind: 'tool',
          descriptor: expect.objectContaining({
            id: 'test-tool',
          }),
        })
      );
    });
  });

  describe('secrets handling', () => {
    it('should skip descriptor with missing required secrets', async () => {
      const mgr = new ExtensionManager({
        secrets: {},
      });

      const pack: ExtensionPack = {
        name: 'secret-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'secret-tool',
            kind: 'tool',
            requiredSecrets: [{ id: 'API_KEY', description: 'API key' }],
            payload: { name: 'secret-tool', execute: vi.fn() },
          },
        ],
      };

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await mgr.loadPackFromFactory(pack);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping descriptor 'secret-tool'")
      );
      consoleSpy.mockRestore();
    });

    it('should load descriptor with optional missing secrets', async () => {
      const mgr = new ExtensionManager({
        secrets: {},
      });

      const pack: ExtensionPack = {
        name: 'optional-secret-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'optional-tool',
            kind: 'tool',
            requiredSecrets: [{ id: 'API_KEY', description: 'API key', optional: true }],
            payload: { name: 'optional-tool', execute: vi.fn() },
          },
        ],
      };

      const listener = vi.fn();
      mgr.on(listener);
      await mgr.loadPackFromFactory(pack);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
        })
      );
    });

    it('should load descriptor when secrets are available', async () => {
      const mgr = new ExtensionManager({
        secrets: {
          API_KEY: 'test-key',
        },
      });

      const pack: ExtensionPack = {
        name: 'secret-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'secret-tool',
            kind: 'tool',
            requiredSecrets: [{ id: 'API_KEY', description: 'API key' }],
            payload: { name: 'secret-tool', execute: vi.fn() },
          },
        ],
      };

      const listener = vi.fn();
      mgr.on(listener);
      await mgr.loadPackFromFactory(pack);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
        })
      );
    });
  });

  describe('descriptor registration', () => {
    it('should use descriptor source if provided', async () => {
      const pack: ExtensionPack = {
        name: 'source-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'sourced-tool',
            kind: 'tool',
            source: {
              sourceName: 'custom-source',
              sourceVersion: '2.0.0',
            },
            payload: { name: 'sourced-tool', execute: vi.fn() },
          },
        ],
      };

      const listener = vi.fn();
      manager.on(listener);
      await manager.loadPackFromFactory(pack);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
          descriptor: expect.objectContaining({
            source: expect.objectContaining({
              sourceName: 'custom-source',
            }),
          }),
        })
      );
    });

    it('should use descriptor priority if provided', async () => {
      const pack: ExtensionPack = {
        name: 'priority-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'priority-tool',
            kind: 'tool',
            priority: 100,
            payload: { name: 'priority-tool', execute: vi.fn() },
          },
        ],
      };

      const listener = vi.fn();
      manager.on(listener);
      await manager.loadPackFromFactory(pack);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
          descriptor: expect.objectContaining({
            priority: 100,
          }),
        })
      );
    });

    it('should use manifest entry priority as fallback', async () => {
      const pack: ExtensionPack = {
        name: 'manifest-priority-pack',
        version: '1.0.0',
        descriptors: [
          {
            id: 'manifest-priority-tool',
            kind: 'tool',
            payload: { name: 'manifest-priority-tool', execute: vi.fn() },
          },
        ],
      };

      const manifest: ExtensionManifest = {
        packs: [
          {
            factory: async () => pack,
            priority: 50,
          },
        ],
      };

      const mgr = new ExtensionManager({ manifest });
      const listener = vi.fn();
      mgr.on(listener);
      await mgr.loadManifest();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'descriptor:activated',
          descriptor: expect.objectContaining({
            priority: 50,
          }),
        })
      );
    });
  });
});
