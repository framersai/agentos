import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { ExtensionManager, EXTENSION_KIND_TOOL } from '../dist/index.js';
import { createSchemaOnDemandPack } from '../dist/extensions/packs/schema-on-demand-pack.js';

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-schema-on-demand-example-'));
  const modulePath = path.join(tmpDir, 'hello-pack.mjs');

  await fs.writeFile(
    modulePath,
    [
      'export function createExtensionPack() {',
      '  const tool = {',
      "    id: 'hello-tool-v1',",
      "    name: 'hello_tool',",
      "    description: 'A tiny test tool',",
      '    inputSchema: { type: "object", properties: {}, additionalProperties: false },',
      '    hasSideEffects: false,',
      '    async execute() { return { success: true, output: { ok: true } }; },',
      '  };',
      '  return {',
      "    name: '@example/hello-pack',",
      "    version: '0.0.0',",
      '    descriptors: [{ id: tool.name, kind: "tool", payload: tool }],',
      '  };',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const manager = new ExtensionManager({});
  await manager.loadPackFromFactory(
    createSchemaOnDemandPack({ extensionManager: manager, options: { allowModules: true } }),
    'schema-on-demand',
  );

  const toolRegistry = manager.getRegistry(EXTENSION_KIND_TOOL);
  console.log('Tools before:', toolRegistry.listActive().map((d) => d.id).sort());

  const enableTool = toolRegistry.getActive('extensions_enable')?.payload;
  if (!enableTool) throw new Error('extensions_enable tool missing');

  const result = await enableTool.execute({ extension: modulePath, source: 'module' }, {});
  console.log('extensions_enable result:', result);
  console.log('Tools after:', toolRegistry.listActive().map((d) => d.id).sort());

  await fs.rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

