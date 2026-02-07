import { describe, it, expect } from 'vitest';

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { ExtensionManager } from '../ExtensionManager';
import { EXTENSION_KIND_TOOL } from '../types';
import { createSchemaOnDemandPack } from './schema-on-demand-pack';

describe('createSchemaOnDemandPack', () => {
  it('enables an extension pack from a local module and exposes new tool schemas next iteration', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-schema-on-demand-'));
    const modulePath = path.join(tmpDir, 'test-pack.mjs');

    await fs.writeFile(
      modulePath,
      [
        'export function createExtensionPack() {',
        '  const tool = {',
        "    id: 'hello-tool-v1',",
        "    name: 'hello_tool',",
        "    displayName: 'Hello Tool',",
        "    description: 'A tiny test tool',",
        '    inputSchema: { type: \"object\", properties: {}, additionalProperties: false },',
        '    hasSideEffects: false,',
        '    async execute() { return { success: true, output: { ok: true } }; },',
        '  };',
        '  return {',
        "    name: '@test/schema-on-demand-pack',",
        "    version: '0.0.0',",
        '    descriptors: [',
        "      { id: tool.name, kind: 'tool', payload: tool },",
        '    ],',
        '  };',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const manager = new ExtensionManager({});
    await manager.loadPackFromFactory(
      createSchemaOnDemandPack({ extensionManager: manager, options: { allowModules: true } }),
      'schema-on-demand-test',
    );

    const enableTool = manager.getRegistry<any>(EXTENSION_KIND_TOOL).getActive('extensions_enable')?.payload as any;
    expect(enableTool).toBeTruthy();

    const first = await enableTool.execute({ extension: modulePath, source: 'module' }, {} as any);
    expect(first.success).toBe(true);
    expect(first.output?.loaded).toBe(true);
    expect(first.output?.toolsAdded).toContain('hello_tool');

    const hello = manager.getRegistry<any>(EXTENSION_KIND_TOOL).getActive('hello_tool')?.payload as any;
    expect(hello).toBeTruthy();

    const second = await enableTool.execute({ extension: modulePath, source: 'module' }, {} as any);
    expect(second.success).toBe(true);
    expect(second.output?.loaded).toBe(false);
    expect(second.output?.skipped).toBe(true);
    expect(second.output?.reason).toBe('already_loaded');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

