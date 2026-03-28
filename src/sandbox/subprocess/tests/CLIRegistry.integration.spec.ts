/**
 * @fileoverview Integration test: CLIRegistry scan results -> CapabilityDescriptor shape
 * @module agentos/sandbox/subprocess/tests/CLIRegistry.integration
 *
 * Validates the integration CONTRACT between CLIRegistry scan results and
 * the CapabilityDescriptor interface used by the Capability Discovery Engine.
 *
 * Even though the actual wiring (CLIRegistry -> CapabilityDiscoveryEngine)
 * doesn't exist yet, this test proves the data shapes are compatible:
 * - CLIScanResult fields map cleanly to CapabilityDescriptor fields
 * - Installed CLIs produce descriptors with metadata.installed: true
 * - Uninstalled CLIs produce descriptors with metadata.installed: false
 * - The resulting descriptors have the correct shape (id, name, description, kind, category)
 *
 * execa is mocked to avoid actual PATH scanning. The conversion function
 * is defined inline since the real adapter doesn't exist yet — this test
 * defines the expected contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mock execa before any imports that use it                          */
/* ------------------------------------------------------------------ */

const { execaMock } = vi.hoisted(() => {
  const execaMock = vi.fn();
  return { execaMock };
});

vi.mock('execa', () => ({
  execa: execaMock,
}));

import { CLIRegistry } from '../CLIRegistry';
import type { CLIDescriptor, CLIScanResult } from '../types';
import type {
  CapabilityDescriptor,
  CapabilityKind,
  CapabilitySourceRef,
} from '../../../discovery/types';

/* ------------------------------------------------------------------ */
/*  Conversion function: CLIScanResult -> CapabilityDescriptor         */
/* ------------------------------------------------------------------ */

/**
 * Convert a CLIScanResult to a CapabilityDescriptor.
 *
 * This is the bridge function that would live in the real integration layer.
 * Defined here to validate the contract between the two systems.
 *
 * Mapping:
 *   CLIScanResult.binaryName    -> CapabilityDescriptor.name
 *   CLIScanResult.displayName   -> CapabilityDescriptor.displayName
 *   CLIScanResult.description   -> CapabilityDescriptor.description
 *   CLIScanResult.category      -> CapabilityDescriptor.category
 *   CLIScanResult.installed     -> CapabilityDescriptor.available
 *   CLIScanResult.binaryPath    -> stored in metadata for reference
 *   CLIScanResult.version       -> stored in metadata for reference
 */
function cliScanResultToDescriptor(result: CLIScanResult): CapabilityDescriptor & {
  metadata: { installed: boolean; binaryPath?: string; version?: string };
} {
  return {
    id: `cli:${result.binaryName}`,
    kind: 'tool' as CapabilityKind,
    name: result.binaryName,
    displayName: result.displayName,
    description: result.description,
    category: result.category,
    tags: ['cli', result.category],
    requiredSecrets: [],
    requiredTools: [result.binaryName],
    available: result.installed,
    hasSideEffects: true,
    sourceRef: {
      type: 'tool' as const,
      toolName: result.binaryName,
    },
    metadata: {
      installed: result.installed,
      binaryPath: result.binaryPath,
      version: result.version,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

const TEST_CLIS: CLIDescriptor[] = [
  {
    binaryName: 'git',
    displayName: 'Git',
    description: 'Distributed version control system',
    category: 'devtools',
    installGuidance: 'https://git-scm.com/',
  },
  {
    binaryName: 'docker',
    displayName: 'Docker',
    description: 'Container platform for building and running applications',
    category: 'devtools',
    installGuidance: 'https://docs.docker.com/get-docker/',
  },
  {
    binaryName: 'claude',
    displayName: 'Claude CLI',
    description: 'Anthropic Claude command-line interface',
    category: 'llm',
    installGuidance: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    binaryName: 'nonexistent-tool',
    displayName: 'Nonexistent Tool',
    description: 'A CLI tool that is not installed',
    category: 'testing',
    installGuidance: 'This tool does not exist',
  },
];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('CLIRegistry -> CapabilityDescriptor integration', () => {
  let registry: CLIRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new CLIRegistry(false);
    registry.registerAll(TEST_CLIS);
  });

  // ---------------------------------------------------------------------
  // 1. Scan installed CLIs via CLIRegistry
  // ---------------------------------------------------------------------
  describe('scan and convert', () => {
    it('should scan all registered CLIs and produce scan results', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'git') {
          return Promise.resolve({ stdout: '/usr/bin/git\n' });
        }
        if (cmd === 'git') {
          return Promise.resolve({ stdout: 'git version 2.43.0\n' });
        }
        if (cmd === 'which' && args[0] === 'docker') {
          return Promise.resolve({ stdout: '/usr/local/bin/docker\n' });
        }
        if (cmd === 'docker') {
          return Promise.resolve({ stdout: 'Docker version 24.0.7\n' });
        }
        if (cmd === 'which' && args[0] === 'claude') {
          return Promise.resolve({ stdout: '/usr/local/bin/claude\n' });
        }
        if (cmd === 'claude') {
          return Promise.resolve({ stdout: 'claude 1.0.5\n' });
        }
        // nonexistent-tool not found
        return Promise.reject(new Error('not found'));
      });

      const scanResults = await registry.scan();
      expect(scanResults).toHaveLength(4);

      const descriptors = scanResults.map(cliScanResultToDescriptor);
      expect(descriptors).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------
  // 2. Convert scan results to CapabilityDescriptors with kind: 'tool'
  // ---------------------------------------------------------------------
  describe('descriptor shape (kind: tool)', () => {
    it('should produce descriptors with kind set to tool', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'git') {
          return Promise.resolve({ stdout: '/usr/bin/git\n' });
        }
        if (cmd === 'git') {
          return Promise.resolve({ stdout: 'git version 2.43.0\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.kind).toBe('tool');
    });

    it('should prefix id with "cli:" namespace', async () => {
      execaMock.mockResolvedValueOnce({ stdout: '/usr/bin/git\n' });
      execaMock.mockResolvedValueOnce({ stdout: 'git version 2.43.0\n' });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.id).toBe('cli:git');
    });
  });

  // ---------------------------------------------------------------------
  // 3. Verify descriptors have correct shape (id, name, description, kind, category)
  // ---------------------------------------------------------------------
  describe('CapabilityDescriptor shape compliance', () => {
    it('should have all required CapabilityDescriptor fields', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'docker') {
          return Promise.resolve({ stdout: '/usr/local/bin/docker\n' });
        }
        if (cmd === 'docker') {
          return Promise.resolve({ stdout: 'Docker version 24.0.7\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('docker');
      const descriptor = cliScanResultToDescriptor(result);

      // Required fields from CapabilityDescriptor interface
      expect(descriptor).toHaveProperty('id');
      expect(descriptor).toHaveProperty('kind');
      expect(descriptor).toHaveProperty('name');
      expect(descriptor).toHaveProperty('displayName');
      expect(descriptor).toHaveProperty('description');
      expect(descriptor).toHaveProperty('category');
      expect(descriptor).toHaveProperty('tags');
      expect(descriptor).toHaveProperty('requiredSecrets');
      expect(descriptor).toHaveProperty('requiredTools');
      expect(descriptor).toHaveProperty('available');
      expect(descriptor).toHaveProperty('sourceRef');

      // Type checks
      expect(typeof descriptor.id).toBe('string');
      expect(typeof descriptor.name).toBe('string');
      expect(typeof descriptor.displayName).toBe('string');
      expect(typeof descriptor.description).toBe('string');
      expect(typeof descriptor.category).toBe('string');
      expect(typeof descriptor.available).toBe('boolean');
      expect(Array.isArray(descriptor.tags)).toBe(true);
      expect(Array.isArray(descriptor.requiredSecrets)).toBe(true);
      expect(Array.isArray(descriptor.requiredTools)).toBe(true);
    });

    it('should map CLIScanResult fields to correct CapabilityDescriptor fields', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'claude') {
          return Promise.resolve({ stdout: '/usr/local/bin/claude\n' });
        }
        if (cmd === 'claude') {
          return Promise.resolve({ stdout: 'claude 1.0.5\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('claude');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.id).toBe('cli:claude');
      expect(descriptor.name).toBe('claude');
      expect(descriptor.displayName).toBe('Claude CLI');
      expect(descriptor.description).toBe('Anthropic Claude command-line interface');
      expect(descriptor.category).toBe('llm');
      expect(descriptor.available).toBe(true);
    });

    it('should include hasSideEffects: true for CLI tools', async () => {
      execaMock.mockResolvedValueOnce({ stdout: '/usr/bin/git\n' });
      execaMock.mockResolvedValueOnce({ stdout: 'git version 2.43.0\n' });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.hasSideEffects).toBe(true);
    });

    it('should set sourceRef.type to "tool" with toolName matching binaryName', async () => {
      execaMock.mockResolvedValueOnce({ stdout: '/usr/bin/git\n' });
      execaMock.mockResolvedValueOnce({ stdout: 'git version 2.43.0\n' });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.sourceRef).toEqual({
        type: 'tool',
        toolName: 'git',
      });
    });

    it('should include binary name in requiredTools', async () => {
      execaMock.mockResolvedValueOnce({ stdout: '/usr/local/bin/docker\n' });
      execaMock.mockResolvedValueOnce({ stdout: 'Docker version 24.0.7\n' });

      const result = await registry.check('docker');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.requiredTools).toContain('docker');
    });

    it('should include category in tags array', async () => {
      execaMock.mockResolvedValueOnce({ stdout: '/usr/local/bin/claude\n' });
      execaMock.mockResolvedValueOnce({ stdout: 'claude 1.0.5\n' });

      const result = await registry.check('claude');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.tags).toContain('cli');
      expect(descriptor.tags).toContain('llm');
    });
  });

  // ---------------------------------------------------------------------
  // 4. Installed CLIs produce descriptors with metadata.installed: true
  // ---------------------------------------------------------------------
  describe('installed CLI metadata', () => {
    it('should set available=true and metadata.installed=true for installed CLIs', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'git') {
          return Promise.resolve({ stdout: '/usr/bin/git\n' });
        }
        if (cmd === 'git') {
          return Promise.resolve({ stdout: 'git version 2.43.0\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.available).toBe(true);
      expect(descriptor.metadata.installed).toBe(true);
      expect(descriptor.metadata.binaryPath).toBe('/usr/bin/git');
      expect(descriptor.metadata.version).toBe('2.43.0');
    });

    it('should preserve version and path in metadata', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'docker') {
          return Promise.resolve({ stdout: '/usr/local/bin/docker\n' });
        }
        if (cmd === 'docker') {
          return Promise.resolve({ stdout: 'Docker version 24.0.7\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('docker');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.metadata.version).toBe('24.0.7');
      expect(descriptor.metadata.binaryPath).toBe('/usr/local/bin/docker');
    });
  });

  // ---------------------------------------------------------------------
  // 5. Uninstalled CLIs produce descriptors with metadata.installed: false
  // ---------------------------------------------------------------------
  describe('uninstalled CLI metadata', () => {
    it('should set available=false and metadata.installed=false for uninstalled CLIs', async () => {
      execaMock.mockRejectedValue(new Error('not found'));

      const result = await registry.check('nonexistent-tool');
      const descriptor = cliScanResultToDescriptor(result);

      expect(descriptor.available).toBe(false);
      expect(descriptor.metadata.installed).toBe(false);
      expect(descriptor.metadata.binaryPath).toBeUndefined();
      expect(descriptor.metadata.version).toBeUndefined();
    });

    it('should still have valid CapabilityDescriptor shape when not installed', async () => {
      execaMock.mockRejectedValue(new Error('not found'));

      const result = await registry.check('nonexistent-tool');
      const descriptor = cliScanResultToDescriptor(result);

      // All required fields should still be present
      expect(descriptor.id).toBe('cli:nonexistent-tool');
      expect(descriptor.kind).toBe('tool');
      expect(descriptor.name).toBe('nonexistent-tool');
      expect(descriptor.displayName).toBe('Nonexistent Tool');
      expect(descriptor.description).toBeTruthy();
      expect(descriptor.category).toBe('testing');
      expect(descriptor.sourceRef).toEqual({
        type: 'tool',
        toolName: 'nonexistent-tool',
      });
    });
  });

  // ---------------------------------------------------------------------
  // Batch conversion: full scan -> descriptors
  // ---------------------------------------------------------------------
  describe('batch scan to descriptors', () => {
    it('should convert a mixed scan (installed + uninstalled) to descriptors', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        // git: installed
        if (cmd === 'which' && args[0] === 'git') {
          return Promise.resolve({ stdout: '/usr/bin/git\n' });
        }
        if (cmd === 'git') {
          return Promise.resolve({ stdout: 'git version 2.43.0\n' });
        }
        // docker: installed
        if (cmd === 'which' && args[0] === 'docker') {
          return Promise.resolve({ stdout: '/usr/local/bin/docker\n' });
        }
        if (cmd === 'docker') {
          return Promise.resolve({ stdout: 'Docker version 24.0.7\n' });
        }
        // claude + nonexistent-tool: not found
        return Promise.reject(new Error('not found'));
      });

      const scanResults = await registry.scan();
      const descriptors = scanResults.map(cliScanResultToDescriptor);

      // Verify mixed results
      const installed = descriptors.filter(d => d.metadata.installed);
      const notInstalled = descriptors.filter(d => !d.metadata.installed);

      expect(installed.length).toBe(2);
      expect(notInstalled.length).toBe(2);

      // All descriptors have unique IDs
      const ids = descriptors.map(d => d.id);
      expect(new Set(ids).size).toBe(ids.length);

      // All have consistent available <-> metadata.installed
      for (const d of descriptors) {
        expect(d.available).toBe(d.metadata.installed);
      }
    });

    it('should produce descriptors compatible with CapabilityIndexSources.tools shape', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'git') {
          return Promise.resolve({ stdout: '/usr/bin/git\n' });
        }
        if (cmd === 'git') {
          return Promise.resolve({ stdout: 'git version 2.43.0\n' });
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await registry.check('git');
      const descriptor = cliScanResultToDescriptor(result);

      // The descriptor should be usable as a CapabilityIndexSources.tools entry
      // after extracting the relevant fields. Verify the overlap:
      const toolSourceEntry = {
        id: descriptor.id,
        name: descriptor.name,
        displayName: descriptor.displayName,
        description: descriptor.description,
        category: descriptor.category,
        inputSchema: {},  // CLIs don't have JSON Schema, but field must exist
        hasSideEffects: descriptor.hasSideEffects,
      };

      expect(toolSourceEntry.id).toBeTruthy();
      expect(toolSourceEntry.name).toBeTruthy();
      expect(toolSourceEntry.displayName).toBeTruthy();
      expect(toolSourceEntry.description).toBeTruthy();
      expect(toolSourceEntry.category).toBeTruthy();
      expect(typeof toolSourceEntry.inputSchema).toBe('object');
    });
  });

  // ---------------------------------------------------------------------
  // Category preservation
  // ---------------------------------------------------------------------
  describe('category preservation', () => {
    it('should preserve CLI category in CapabilityDescriptor', async () => {
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which') return Promise.resolve({ stdout: `/usr/bin/${args[0]}\n` });
        return Promise.resolve({ stdout: '1.0.0\n' });
      });

      const scanResults = await registry.scan();
      const descriptors = scanResults.map(cliScanResultToDescriptor);

      const gitDescriptor = descriptors.find(d => d.name === 'git');
      const claudeDescriptor = descriptors.find(d => d.name === 'claude');

      expect(gitDescriptor?.category).toBe('devtools');
      expect(claudeDescriptor?.category).toBe('llm');
    });
  });
});
