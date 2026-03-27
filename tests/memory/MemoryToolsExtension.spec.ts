import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { ToolExecutor } from '../../src/core/tools/ToolExecutor.js';
import type { ITool } from '../../src/core/tools/ITool.js';
import { EXTENSION_KIND_TOOL, ExtensionManager } from '../../src/extensions/index.js';
import { Memory, createMemoryToolsPack } from '../../src/memory/index.js';

const cleanupPaths: string[] = [];
const openMemories: Memory[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agentos-memory-tools-'));
  cleanupPaths.push(dir);
  return dir;
}

async function createMemory(overrides?: Record<string, unknown>): Promise<Memory> {
  const dir = await createTempDir();
  const dbPath = path.join(dir, 'brain.sqlite');
  const memory = await Memory.create({
    store: 'sqlite',
    path: dbPath,
    graph: false,
    selfImprove: true,
    decay: true,
    ...overrides,
  });
  openMemories.push(memory);
  return memory;
}

afterEach(async () => {
  for (const memory of openMemories) {
    try {
      await memory.close();
    } catch {
      // already closed
    }
  }
  openMemories.length = 0;

  for (const target of cleanupPaths) {
    await rm(target, { recursive: true, force: true });
  }
  cleanupPaths.length = 0;
});

describe('Memory tools extension pack', () => {
  it('loads memory tools through ExtensionManager and exposes them to ToolExecutor at runtime', async () => {
    const memory = await createMemory({ selfImprove: true });
    const extensionManager = new ExtensionManager();
    const toolRegistry = extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);
    const executor = new ToolExecutor(undefined, undefined, toolRegistry);

    expect(executor.getTool('memory_add')).toBeUndefined();

    await extensionManager.loadPackFromFactory(
      createMemoryToolsPack(memory),
      'memory-tools',
    );

    expect(executor.getTool('memory_add')).toBeDefined();
    expect(executor.getTool('memory_search')).toBeDefined();
    expect(executor.getTool('memory_reflect')).toBeDefined();

    const addResult = await executor.executeTool({
      toolCallRequest: {
        id: 'call-1',
        name: 'memory_add',
        arguments: {
          content: 'The user prefers keyboard shortcuts.',
          type: 'semantic',
          scope: 'user',
          tags: ['preferences'],
        },
      },
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext: { userId: 'user-1' },
    });

    expect(addResult.success).toBe(true);

    const searchResult = await executor.executeTool({
      toolCallRequest: {
        id: 'call-2',
        name: 'memory_search',
        arguments: {
          query: 'keyboard shortcuts',
          scope: 'user',
          limit: 5,
        },
      },
      gmiId: 'gmi-1',
      personaId: 'persona-1',
      personaCapabilities: [],
      userContext: { userId: 'user-1' },
    });

    expect(searchResult.success).toBe(true);
    expect(searchResult.output).toMatchObject({
      results: [
        expect.objectContaining({
          content: 'The user prefers keyboard shortcuts.',
          scope: 'user',
        }),
      ],
    });

    const recall = await memory.recall('keyboard shortcuts');
    expect(recall).toHaveLength(1);
    expect(recall[0]?.trace.content).toContain('keyboard shortcuts');
  });

  it('can omit memory_reflect when requested by pack options', async () => {
    const memory = await createMemory({ selfImprove: true });
    const extensionManager = new ExtensionManager();

    await extensionManager.loadPackFromFactory(
      createMemoryToolsPack(memory, { includeReflect: false }),
      'memory-tools-no-reflect',
    );

    const toolRegistry = extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);

    expect(toolRegistry.getActive('memory_add')).toBeDefined();
    expect(toolRegistry.getActive('memory_search')).toBeDefined();
    expect(toolRegistry.getActive('memory_reflect')).toBeUndefined();
  });
});
