import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => {
  const execaMock = vi.fn();
  return { execaMock };
});

vi.mock('execa', () => ({
  execa: execaMock,
}));

import { CLIRegistry, WELL_KNOWN_CLIS } from '../CLIRegistry';
import type { CLIDescriptor } from '../types';

describe('CLIRegistry', () => {
  let registry: CLIRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new CLIRegistry(false); // no defaults for isolated tests
  });

  describe('register / list / has / get', () => {
    const testCli: CLIDescriptor = {
      binaryName: 'test-tool',
      displayName: 'Test Tool',
      description: 'A test tool',
      category: 'devtools',
      installGuidance: 'npm install -g test-tool',
    };

    it('registers and lists descriptors', () => {
      registry.register(testCli);
      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0].binaryName).toBe('test-tool');
    });

    it('has() returns true for registered, false for unregistered', () => {
      registry.register(testCli);
      expect(registry.has('test-tool')).toBe(true);
      expect(registry.has('nope')).toBe(false);
    });

    it('get() returns descriptor or undefined', () => {
      registry.register(testCli);
      expect(registry.get('test-tool')?.displayName).toBe('Test Tool');
      expect(registry.get('nope')).toBeUndefined();
    });

    it('overwrites existing entry for same binaryName', () => {
      registry.register(testCli);
      registry.register({ ...testCli, description: 'Updated' });
      expect(registry.list()).toHaveLength(1);
      expect(registry.list()[0].description).toBe('Updated');
    });

    it('unregister removes a descriptor', () => {
      registry.register(testCli);
      expect(registry.unregister('test-tool')).toBe(true);
      expect(registry.list()).toHaveLength(0);
      expect(registry.unregister('nope')).toBe(false);
    });

    it('registerAll adds multiple descriptors', () => {
      registry.registerAll([
        testCli,
        { ...testCli, binaryName: 'other-tool', displayName: 'Other' },
      ]);
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('check()', () => {
    const gitCli: CLIDescriptor = {
      binaryName: 'git',
      displayName: 'Git',
      description: 'Version control',
      category: 'devtools',
      installGuidance: 'https://git-scm.com/',
    };

    it('returns installed: true with path and version when binary exists', async () => {
      registry.register(gitCli);

      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/bin/git\n' })
        .mockResolvedValueOnce({ stdout: 'git version 2.43.0\n' });

      const result = await registry.check('git');
      expect(result.installed).toBe(true);
      expect(result.binaryPath).toBe('/usr/bin/git');
      expect(result.version).toBe('2.43.0');
      expect(result.displayName).toBe('Git');
    });

    it('returns installed: false when binary not found', async () => {
      registry.register(gitCli);
      execaMock.mockRejectedValueOnce(new Error('not found'));

      const result = await registry.check('git');
      expect(result.installed).toBe(false);
      expect(result.binaryPath).toBeUndefined();
    });

    it('returns installed: true even when version check fails', async () => {
      registry.register(gitCli);
      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/bin/git\n' })
        .mockRejectedValueOnce(new Error('version failed'));

      const result = await registry.check('git');
      expect(result.installed).toBe(true);
      expect(result.version).toBe('unknown');
    });

    it('returns unknown descriptor for unregistered binary', async () => {
      const result = await registry.check('unknown-bin');
      expect(result.installed).toBe(false);
      expect(result.category).toBe('unknown');
    });

    it('uses custom versionFlag when provided', async () => {
      registry.register({
        ...gitCli,
        binaryName: 'gcloud',
        versionFlag: '--version',
      });

      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/bin/gcloud\n' })
        .mockResolvedValueOnce({ stdout: 'Google Cloud SDK 456.0.0\n' });

      const result = await registry.check('gcloud');
      expect(result.version).toBe('456.0.0');
      expect(execaMock).toHaveBeenCalledWith('gcloud', ['--version']);
    });

    it('uses custom versionPattern when provided', async () => {
      registry.register({
        ...gitCli,
        binaryName: 'custom',
        versionPattern: /v(\d+\.\d+)/,
      });

      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/bin/custom\n' })
        .mockResolvedValueOnce({ stdout: 'custom tool v12.5 stable\n' });

      const result = await registry.check('custom');
      expect(result.version).toBe('12.5');
    });
  });

  describe('scan()', () => {
    it('checks all registered CLIs', async () => {
      registry.registerAll([
        { binaryName: 'a', displayName: 'A', description: '', category: 'test', installGuidance: '' },
        { binaryName: 'b', displayName: 'B', description: '', category: 'test', installGuidance: '' },
      ]);

      /* Mock based on args since Promise.all order isn't guaranteed */
      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'a') return Promise.resolve({ stdout: '/usr/bin/a\n' });
        if (cmd === 'a') return Promise.resolve({ stdout: 'a 1.0.0\n' });
        if (cmd === 'which' && args[0] === 'b') return Promise.reject(new Error('not found'));
        return Promise.reject(new Error('unexpected call'));
      });

      const results = await registry.scan();
      expect(results).toHaveLength(2);
      expect(results.find(r => r.binaryName === 'a')?.installed).toBe(true);
      expect(results.find(r => r.binaryName === 'b')?.installed).toBe(false);
    });
  });

  describe('installed()', () => {
    it('returns only installed CLIs', async () => {
      registry.registerAll([
        { binaryName: 'yes-bin', displayName: 'Yes', description: '', category: 'test', installGuidance: '' },
        { binaryName: 'no-bin', displayName: 'No', description: '', category: 'test', installGuidance: '' },
      ]);

      execaMock.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' && args[0] === 'yes-bin') return Promise.resolve({ stdout: '/usr/bin/yes-bin\n' });
        if (cmd === 'yes-bin') return Promise.resolve({ stdout: 'yes-bin 1.0.0\n' });
        if (cmd === 'which' && args[0] === 'no-bin') return Promise.reject(new Error('not found'));
        return Promise.reject(new Error('unexpected call'));
      });

      const results = await registry.installed();
      expect(results).toHaveLength(1);
      expect(results[0].binaryName).toBe('yes-bin');
    });
  });

  describe('byCategory()', () => {
    it('filters by category', async () => {
      registry.registerAll([
        { binaryName: 'llm1', displayName: 'LLM1', description: '', category: 'llm', installGuidance: '' },
        { binaryName: 'tool1', displayName: 'Tool1', description: '', category: 'devtools', installGuidance: '' },
      ]);

      // both installed
      execaMock
        .mockResolvedValueOnce({ stdout: '/usr/bin/llm1\n' })
        .mockResolvedValueOnce({ stdout: '1.0.0\n' })
        .mockResolvedValueOnce({ stdout: '/usr/bin/tool1\n' })
        .mockResolvedValueOnce({ stdout: '2.0.0\n' });

      const llms = await registry.byCategory('llm');
      expect(llms).toHaveLength(1);
      expect(llms[0].binaryName).toBe('llm1');
    });
  });

  describe('constructor defaults', () => {
    it('loads WELL_KNOWN_CLIS from JSON registry files when loadDefaults is true', () => {
      const withDefaults = new CLIRegistry(true);
      expect(withDefaults.list().length).toBe(WELL_KNOWN_CLIS.length);
      // Verify CLIs from multiple category files are loaded
      expect(withDefaults.has('claude')).toBe(true);   // llm.json
      expect(withDefaults.has('git')).toBe(true);      // devtools.json
      expect(withDefaults.has('node')).toBe(true);     // runtimes.json
      expect(withDefaults.has('pnpm')).toBe(true);     // package-managers.json
      expect(withDefaults.has('aws')).toBe(true);      // cloud.json
      expect(withDefaults.has('psql')).toBe(true);     // databases.json
      expect(withDefaults.has('ffmpeg')).toBe(true);   // media.json
      expect(withDefaults.has('curl')).toBe(true);     // networking.json
    });

    it('loads at least 40 CLIs from JSON registry files', () => {
      const withDefaults = new CLIRegistry(true);
      expect(withDefaults.list().length).toBeGreaterThanOrEqual(40);
    });

    it('loads CLIs across 8 categories', () => {
      const withDefaults = new CLIRegistry(true);
      const categories = withDefaults.categories();
      expect(categories).toContain('llm');
      expect(categories).toContain('devtools');
      expect(categories).toContain('runtime');
      expect(categories).toContain('package-manager');
      expect(categories).toContain('cloud');
      expect(categories).toContain('database');
      expect(categories).toContain('media');
      expect(categories).toContain('networking');
    });

    it('starts empty when loadDefaults is false', () => {
      const empty = new CLIRegistry(false);
      expect(empty.list()).toHaveLength(0);
    });
  });
});
