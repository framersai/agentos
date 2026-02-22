/**
 * @file CapabilityManifestScanner.spec.ts
 * @description Unit tests for the CapabilityManifestScanner class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:fs');
vi.mock('node:os');

// Import AFTER mocking
import { CapabilityManifestScanner } from '../../src/discovery/CapabilityManifestScanner.js';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const mockedFs = vi.mocked(fs);
const mockedOs = vi.mocked(os);

const YAML_FULL = `
id: custom:my-tool
kind: tool
name: my-tool
displayName: My Custom Tool
description: Does something useful
category: information
tags: [search, api]
requiredSecrets: [MY_API_KEY]
requiredTools: [curl]
hasSideEffects: true
`.trim();

const YAML_MINIMAL = `
kind: tool
name: minimal-tool
description: A minimal tool
`.trim();

const YAML_MISSING_FIELDS = `
kind: tool
name: incomplete
`.trim();

const YAML_WITH_SKILL_REF = `
kind: skill
name: my-skill
description: A custom skill
skillContent: ./SKILL.md
`.trim();

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe('CapabilityManifestScanner', () => {
  let scanner: CapabilityManifestScanner;
  const originalEnv = process.env;

  beforeEach(() => {
    scanner = new CapabilityManifestScanner();
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    mockedOs.homedir.mockReturnValue('/home/testuser');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // getDefaultDirs
  // =========================================================================

  describe('getDefaultDirs', () => {
    it('includes ~/.wunderland/capabilities/', () => {
      const dirs = scanner.getDefaultDirs();
      expect(dirs).toContain(
        path.join('/home/testuser', '.wunderland', 'capabilities'),
      );
    });

    it('includes ./.wunderland/capabilities/', () => {
      const dirs = scanner.getDefaultDirs();
      expect(dirs).toContain(
        path.join(process.cwd(), '.wunderland', 'capabilities'),
      );
    });

    it('includes $WUNDERLAND_CAPABILITY_DIRS when set', () => {
      process.env.WUNDERLAND_CAPABILITY_DIRS = '/custom/dir1:/custom/dir2';
      const dirs = scanner.getDefaultDirs();
      expect(dirs).toContain('/custom/dir1');
      expect(dirs).toContain('/custom/dir2');
    });

    it('does not include env dirs when WUNDERLAND_CAPABILITY_DIRS is not set', () => {
      delete process.env.WUNDERLAND_CAPABILITY_DIRS;
      const dirs = scanner.getDefaultDirs();
      // Should only have 2 directories (home + cwd)
      expect(dirs).toHaveLength(2);
    });
  });

  // =========================================================================
  // scan
  // =========================================================================

  describe('scan', () => {
    it('returns empty for non-existent directories', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await scanner.scan(['/nonexistent']);
      expect(result).toEqual([]);
    });

    it('scans directory with a CAPABILITY.yaml entry', async () => {
      // Setup: /caps/my-tool/CAPABILITY.yaml exists
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s === '/caps') return true;
        if (s === '/caps/my-tool/CAPABILITY.yaml') return true;
        if (s === '/caps/my-tool/CAPABILITY.yml') return false;
        if (s === '/caps/my-tool/SKILL.md') return false;
        if (s === '/caps/my-tool/schema.json') return false;
        return false;
      });

      mockedFs.readdirSync.mockReturnValue([
        { name: 'my-tool', isDirectory: () => true, isFile: () => false } as unknown as fs.Dirent,
      ] as fs.Dirent[]);

      mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        if (p.toString().endsWith('CAPABILITY.yaml')) return YAML_FULL;
        return '';
      });

      const result = await scanner.scan(['/caps']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('custom:my-tool');
      expect(result[0].kind).toBe('tool');
      expect(result[0].name).toBe('my-tool');
      expect(result[0].displayName).toBe('My Custom Tool');
      expect(result[0].description).toBe('Does something useful');
      expect(result[0].category).toBe('information');
      expect(result[0].tags).toEqual(['search', 'api']);
      expect(result[0].requiredSecrets).toEqual(['MY_API_KEY']);
      expect(result[0].requiredTools).toEqual(['curl']);
    });
  });

  // =========================================================================
  // parseManifest
  // =========================================================================

  describe('parseManifest', () => {
    it('correctly parses a CAPABILITY.yaml with all fields', async () => {
      mockedFs.readFileSync.mockReturnValue(YAML_FULL);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await scanner.parseManifest('/caps/my-tool/CAPABILITY.yaml', '/caps/my-tool');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('custom:my-tool');
      expect(result!.kind).toBe('tool');
      expect(result!.name).toBe('my-tool');
      expect(result!.displayName).toBe('My Custom Tool');
      expect(result!.description).toBe('Does something useful');
      expect(result!.category).toBe('information');
      expect(result!.tags).toEqual(['search', 'api']);
      expect(result!.requiredSecrets).toEqual(['MY_API_KEY']);
      expect(result!.requiredTools).toEqual(['curl']);
      expect(result!.hasSideEffects).toBe(true);
      expect(result!.sourceRef).toEqual({
        type: 'manifest',
        manifestPath: '/caps/my-tool/CAPABILITY.yaml',
        entryId: 'custom:my-tool',
      });
    });

    it('returns null for missing required fields', async () => {
      mockedFs.readFileSync.mockReturnValue(YAML_MISSING_FIELDS);
      mockedFs.existsSync.mockReturnValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await scanner.parseManifest('/caps/bad/CAPABILITY.yaml', '/caps/bad');

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('generates id from kind:name when id not provided', async () => {
      mockedFs.readFileSync.mockReturnValue(YAML_MINIMAL);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await scanner.parseManifest('/caps/min/CAPABILITY.yaml', '/caps/min');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('tool:minimal-tool');
    });

    it('defaults category to custom when not provided', async () => {
      mockedFs.readFileSync.mockReturnValue(YAML_MINIMAL);
      mockedFs.existsSync.mockReturnValue(false);

      const result = await scanner.parseManifest('/caps/min/CAPABILITY.yaml', '/caps/min');

      expect(result!.category).toBe('custom');
    });

    it('loads optional SKILL.md content from skillContent reference', async () => {
      mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith('CAPABILITY.yaml')) return YAML_WITH_SKILL_REF;
        if (s.endsWith('SKILL.md')) return '# My Skill\nInstructions here.';
        return '';
      });

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.endsWith('SKILL.md')) return true;
        if (s.endsWith('schema.json')) return false;
        return false;
      });

      const result = await scanner.parseManifest('/caps/my-skill/CAPABILITY.yaml', '/caps/my-skill');

      expect(result).not.toBeNull();
      expect(result!.fullContent).toBe('# My Skill\nInstructions here.');
    });

    it('loads default SKILL.md when skillContent not specified', async () => {
      mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith('CAPABILITY.yaml')) return YAML_MINIMAL;
        if (s.endsWith('SKILL.md')) return '# Default Skill';
        return '';
      });

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.endsWith('SKILL.md')) return true;
        if (s.endsWith('schema.json')) return false;
        return false;
      });

      const result = await scanner.parseManifest('/caps/min/CAPABILITY.yaml', '/caps/min');

      expect(result).not.toBeNull();
      expect(result!.fullContent).toBe('# Default Skill');
    });

    it('loads optional schema.json', async () => {
      const schemaJson = JSON.stringify({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
      });

      mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = p.toString();
        if (s.endsWith('CAPABILITY.yaml')) return YAML_MINIMAL;
        if (s.endsWith('schema.json')) return schemaJson;
        return '';
      });

      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const s = p.toString();
        if (s.endsWith('SKILL.md')) return false;
        if (s.endsWith('schema.json')) return true;
        return false;
      });

      const result = await scanner.parseManifest('/caps/min/CAPABILITY.yaml', '/caps/min');

      expect(result).not.toBeNull();
      expect(result!.fullSchema).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
      });
    });
  });
});
