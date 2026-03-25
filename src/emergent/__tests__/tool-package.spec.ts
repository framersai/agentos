import { describe, expect, it } from 'vitest';

import type { EmergentTool } from '../types.js';
import {
  EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION,
  buildEmergentToolPackage,
  serializeEmergentToolPackage,
  parseEmergentToolPackage,
  materializeEmergentToolFromPackage,
} from '../ToolPackage.js';

function makeTool(overrides: Partial<EmergentTool> = {}): EmergentTool {
  return {
    id: 'emergent:test-1',
    name: 'sample_tool',
    description: 'Sample tool',
    inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { result: { type: 'number' } } },
    implementation: {
      mode: 'compose',
      steps: [
        {
          name: 'run',
          tool: 'math_add',
          inputMapping: { value: '$input.value' },
        },
      ],
    },
    tier: 'agent',
    createdBy: 'seed_a',
    createdAt: '2026-03-25T00:00:00.000Z',
    judgeVerdicts: [],
    usageStats: {
      totalUses: 4,
      successCount: 4,
      failureCount: 0,
      avgExecutionTimeMs: 21,
      confidenceScore: 0.9,
      lastUsedAt: '2026-03-25T01:00:00.000Z',
    },
    source: 'forged by agent seed_a during session sess_a',
    ...overrides,
  };
}

describe('Emergent tool package helpers', () => {
  it('builds a portable compose package', () => {
    const manifest = buildEmergentToolPackage(makeTool());

    expect(manifest.schemaVersion).toBe(EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION);
    expect(manifest.portability.portable).toBe(true);
    expect(manifest.tool.implementation.mode).toBe('compose');
  });

  it('marks redacted sandbox packages as non-portable', () => {
    const manifest = buildEmergentToolPackage(
      makeTool({
        implementation: {
          mode: 'sandbox',
          code: '',
          allowlist: ['fetch'],
        },
      }),
    );

    expect(manifest.tool.implementation.mode).toBe('sandbox');
    expect(manifest.portability.portable).toBe(false);
    expect(manifest.portability.warnings[0]).toMatch(/redacted at rest/i);
  });

  it('serializes and parses YAML packages', () => {
    const manifest = buildEmergentToolPackage(makeTool());
    const yaml = serializeEmergentToolPackage(manifest, 'yaml');
    const reparsed = parseEmergentToolPackage(yaml);

    expect(yaml).toContain(EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION);
    expect(reparsed.tool.name).toBe('sample_tool');
  });

  it('materializes an imported tool with reset usage stats by default', () => {
    const manifest = buildEmergentToolPackage(makeTool());
    const imported = materializeEmergentToolFromPackage(manifest, {
      createdBy: 'seed_b',
    });

    expect(imported.createdBy).toBe('seed_b');
    expect(imported.tier).toBe('agent');
    expect(imported.usageStats.totalUses).toBe(0);
    expect(imported.name).toBe('sample_tool');
  });

  it('rejects import of sandbox packages without source code', () => {
    const manifest = buildEmergentToolPackage(
      makeTool({
        implementation: {
          mode: 'sandbox',
          code: '',
          allowlist: ['fetch'],
        },
      }),
    );

    expect(() =>
      materializeEmergentToolFromPackage(manifest, { createdBy: 'seed_b' }),
    ).toThrow(/cannot be imported/i);
  });
});
