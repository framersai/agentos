/**
 * @fileoverview Tests for SkillExporter.
 *
 * Covers:
 * 1. Composable tool → valid SKILL.md with frontmatter + body
 * 2. Sandbox tool → SKILL.md with redaction notice (no code leak)
 * 3. CAPABILITY.yaml contains correct schema fields
 * 4. writeSkillFile creates file on disk (uses tmp dir)
 * 5. exportToolAsSkillPack creates both SKILL.md and CAPABILITY.yaml
 * 6. Parameter table generation from inputSchema
 * 7. Provenance section captures usage stats
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';

import type { EmergentTool } from '../types.js';
import {
  exportToolAsSkill,
  buildCapabilityYaml,
  writeSkillFile,
  exportToolAsSkillPack,
} from '../SkillExporter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Temporary directories created during tests, cleaned up in afterEach. */
const tmpDirs: string[] = [];

/** Creates a unique temporary directory for test file output. */
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-export-'));
  tmpDirs.push(dir);
  return dir;
}

/** Builds a composable EmergentTool fixture. */
function makeComposableTool(overrides: Partial<EmergentTool> = {}): EmergentTool {
  return {
    id: 'emergent:compose-1',
    name: 'fetch_and_summarize',
    description: 'Fetches a URL and summarizes the content using an LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch.' },
        maxLength: { type: 'number', description: 'Maximum summary length in words.' },
      },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
      },
    },
    implementation: {
      mode: 'compose',
      steps: [
        {
          name: 'fetch',
          tool: 'web_fetch',
          inputMapping: { url: '$input.url' },
        },
        {
          name: 'summarize',
          tool: 'llm_summarize',
          inputMapping: { text: '$prev.content', maxLength: '$input.maxLength' },
          condition: '$prev.content.length > 0',
        },
      ],
    },
    tier: 'agent',
    createdBy: 'seed_alpha',
    createdAt: '2026-03-25T12:00:00.000Z',
    judgeVerdicts: [],
    usageStats: {
      totalUses: 10,
      successCount: 9,
      failureCount: 1,
      avgExecutionTimeMs: 450,
      confidenceScore: 0.88,
      lastUsedAt: '2026-03-26T08:00:00.000Z',
    },
    source: 'forged by agent seed_alpha during session sess_42',
    ...overrides,
  };
}

/** Builds a sandboxed EmergentTool fixture. */
function makeSandboxTool(overrides: Partial<EmergentTool> = {}): EmergentTool {
  return {
    id: 'emergent:sandbox-1',
    name: 'hash_input',
    description: 'Computes a SHA-256 hash of the input string.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'String to hash.' },
      },
      required: ['value'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string' },
      },
    },
    implementation: {
      mode: 'sandbox',
      code: 'async function run(input) { /* secret code */ return { hash: "abc" }; }',
      allowlist: ['crypto'],
    },
    tier: 'session',
    createdBy: 'seed_beta',
    createdAt: '2026-03-25T14:00:00.000Z',
    judgeVerdicts: [],
    usageStats: {
      totalUses: 3,
      successCount: 3,
      failureCount: 0,
      avgExecutionTimeMs: 12,
      confidenceScore: 0.95,
      lastUsedAt: '2026-03-25T15:00:00.000Z',
    },
    source: 'forged by agent seed_beta during session sess_77',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  // Remove all temp directories created during the test
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors — CI may have already cleaned up
    }
  }
  tmpDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SkillExporter', () => {
  // -------------------------------------------------------------------------
  // 1. Composable tool → valid SKILL.md
  // -------------------------------------------------------------------------
  it('exports a composable tool as valid SKILL.md with frontmatter and body', () => {
    const md = exportToolAsSkill(makeComposableTool());

    // Frontmatter must be delimited by ---
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('name: fetch_and_summarize');
    // YAML lib may emit version as unquoted `1.0.0` — match either format
    expect(md).toMatch(/version:\s+["']?1\.0\.0["']?/);
    expect(md).toContain('author: emergent-engine');

    // Body sections
    expect(md).toContain('# Fetch And Summarize');
    expect(md).toContain('## Purpose');
    expect(md).toContain('Fetches a URL and summarizes the content');
    expect(md).toContain('## Usage');
    expect(md).toContain('`web_fetch`');
    expect(md).toContain('`llm_summarize`');
    expect(md).toContain('## Parameters');
    expect(md).toContain('| url | string | Yes |');
    expect(md).toContain('| maxLength | number | No |');
    expect(md).toContain('## Pipeline Steps');
    expect(md).toContain('**fetch**');
    expect(md).toContain('**summarize**');
    expect(md).toContain('## Provenance');
    expect(md).toContain('Success rate:');
  });

  // -------------------------------------------------------------------------
  // 2. Sandbox tool → SKILL.md with redaction notice
  // -------------------------------------------------------------------------
  it('exports a sandbox tool with code redaction notice', () => {
    const md = exportToolAsSkill(makeSandboxTool());

    // Should NOT contain the actual sandbox source code
    expect(md).not.toContain('secret code');
    expect(md).not.toContain('async function run');

    // Should contain the redaction notice
    expect(md).toContain('Sandbox source code is redacted');
    expect(md).toContain('`crypto`');

    // Should still have proper frontmatter
    expect(md).toContain('name: hash_input');
    expect(md).toContain('mode: sandbox');
  });

  // -------------------------------------------------------------------------
  // 3. CAPABILITY.yaml contains correct schema
  // -------------------------------------------------------------------------
  it('builds CAPABILITY.yaml with correct schema fields', () => {
    const tool = makeComposableTool();
    const yamlStr = buildCapabilityYaml(tool);
    const parsed = YAML.parse(yamlStr) as Record<string, unknown>;

    expect(parsed.id).toBe('tool:fetch_and_summarize');
    expect(parsed.kind).toBe('tool');
    expect(parsed.name).toBe('fetch_and_summarize');
    expect(parsed.displayName).toBe('Fetch And Summarize');
    expect(parsed.description).toBe(tool.description);
    expect(parsed.category).toBe('emergent');
    expect(parsed.tags).toContain('generated');
    expect(parsed.tags).toContain('compose');

    // Schema fields
    const inputSchema = parsed.inputSchema as Record<string, unknown>;
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.properties).toBeDefined();

    // Required tools extracted from compose steps
    const requiredTools = parsed.requiredTools as string[];
    expect(requiredTools).toContain('web_fetch');
    expect(requiredTools).toContain('llm_summarize');

    // Skill companion pointer
    expect(parsed.skillContent).toBe('./SKILL.md');
  });

  // -------------------------------------------------------------------------
  // 4. writeSkillFile creates file on disk
  // -------------------------------------------------------------------------
  it('writes SKILL.md to disk in the correct directory', async () => {
    const tmpDir = makeTmpDir();
    const tool = makeComposableTool();

    const skillPath = await writeSkillFile(tool, tmpDir);

    // Verify path
    expect(skillPath).toBe(path.join(tmpDir, 'fetch_and_summarize', 'SKILL.md'));

    // Verify file exists and has content
    const content = fs.readFileSync(skillPath, 'utf-8');
    expect(content).toContain('# Fetch And Summarize');
    expect(content).toContain('---');
  });

  // -------------------------------------------------------------------------
  // 5. exportToolAsSkillPack creates both files
  // -------------------------------------------------------------------------
  it('exports a full skill pack (SKILL.md + CAPABILITY.yaml)', async () => {
    const tmpDir = makeTmpDir();
    const tool = makeComposableTool();

    const { skillPath, capabilityPath } = await exportToolAsSkillPack(tool, tmpDir);

    // Both files should exist
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(capabilityPath)).toBe(true);

    // Verify SKILL.md
    const skillContent = fs.readFileSync(skillPath, 'utf-8');
    expect(skillContent).toContain('# Fetch And Summarize');

    // Verify CAPABILITY.yaml
    const capContent = fs.readFileSync(capabilityPath, 'utf-8');
    const parsed = YAML.parse(capContent) as Record<string, unknown>;
    expect(parsed.kind).toBe('tool');
    expect(parsed.name).toBe('fetch_and_summarize');
  });

  // -------------------------------------------------------------------------
  // 6. Parameter table is correct
  // -------------------------------------------------------------------------
  it('generates correct parameter table from inputSchema', () => {
    const md = exportToolAsSkill(makeComposableTool());

    // Table header
    expect(md).toContain('| Parameter | Type | Required | Description |');
    expect(md).toContain('|-----------|------|----------|-------------|');

    // Required parameter
    expect(md).toContain('| url | string | Yes | The URL to fetch. |');

    // Optional parameter
    expect(md).toContain('| maxLength | number | No | Maximum summary length in words. |');
  });

  // -------------------------------------------------------------------------
  // 7. Provenance section captures usage stats
  // -------------------------------------------------------------------------
  it('includes provenance with usage statistics', () => {
    const tool = makeComposableTool();
    const md = exportToolAsSkill(tool);

    expect(md).toContain('**Source:** forged by agent seed_alpha during session sess_42');
    expect(md).toContain('**Tier:** agent');
    expect(md).toContain('**Total uses:** 10');
    expect(md).toContain('**Success rate:** 90.0%');
    expect(md).toContain('**Confidence:** 0.88');
  });
});
