/**
 * @fileoverview CLI discovery registry — scans PATH for known binaries
 * so AgentOS can auto-detect available tools, LLM CLIs, and utilities.
 *
 * Providers and extensions register their CLI dependencies at startup.
 * A curated set of well-known CLIs ships as defaults.
 *
 * @module agentos/sandbox/subprocess/CLIRegistry
 */

import { execa } from 'execa';
import type { CLIDescriptor, CLIScanResult } from './types';

/* ------------------------------------------------------------------ */
/*  Well-known CLIs                                                    */
/* ------------------------------------------------------------------ */

/**
 * Curated set of well-known CLIs that AgentOS scans for by default.
 * Extensions and providers can register additional descriptors at runtime.
 */
export const WELL_KNOWN_CLIS: CLIDescriptor[] = [
  // ── LLM CLIs ──
  {
    binaryName: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic Claude via Max subscription — no API key required',
    category: 'llm',
    installGuidance: 'npm install -g @anthropic-ai/claude-code — or download from https://claude.ai/download',
  },
  {
    binaryName: 'gemini',
    displayName: 'Gemini CLI',
    description: 'Google Gemini via Google account login — no API key required',
    category: 'llm',
    installGuidance: 'npm install -g @google/gemini-cli',
  },
  // ── Dev tools ──
  {
    binaryName: 'git',
    displayName: 'Git',
    description: 'Distributed version control system',
    category: 'devtools',
    installGuidance: 'https://git-scm.com/downloads',
  },
  {
    binaryName: 'gh',
    displayName: 'GitHub CLI',
    description: 'GitHub API from the terminal — PRs, issues, actions',
    category: 'devtools',
    installGuidance: 'https://cli.github.com/',
  },
  {
    binaryName: 'docker',
    displayName: 'Docker',
    description: 'Container runtime for building and running applications',
    category: 'devtools',
    installGuidance: 'https://docs.docker.com/get-docker/',
  },
  // ── Runtimes ──
  {
    binaryName: 'node',
    displayName: 'Node.js',
    description: 'JavaScript runtime built on V8',
    category: 'runtime',
    installGuidance: 'https://nodejs.org/',
  },
  {
    binaryName: 'python3',
    displayName: 'Python 3',
    description: 'Python interpreter',
    category: 'runtime',
    installGuidance: 'https://www.python.org/downloads/',
  },
  // ── Media ──
  {
    binaryName: 'ffmpeg',
    displayName: 'FFmpeg',
    description: 'Audio/video processing and conversion toolkit',
    category: 'media',
    installGuidance: 'https://ffmpeg.org/download.html',
  },
  // ── Cloud ──
  {
    binaryName: 'gcloud',
    displayName: 'Google Cloud SDK',
    description: 'Google Cloud resource management',
    category: 'cloud',
    installGuidance: 'https://cloud.google.com/sdk/docs/install',
    versionFlag: '--version',
  },
  {
    binaryName: 'aws',
    displayName: 'AWS CLI',
    description: 'Amazon Web Services resource management',
    category: 'cloud',
    installGuidance: 'https://aws.amazon.com/cli/',
  },
];

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

/**
 * Registry of known CLI binaries with PATH scanning capabilities.
 *
 * Usage:
 * 1. Create a registry and register well-known CLIs (done automatically if using defaults).
 * 2. Providers/extensions register additional CLIs via {@link register}.
 * 3. Call {@link scan} to discover what's installed on the user's machine.
 * 4. Results feed into `wunderland doctor`, capability discovery, and provider auto-detection.
 *
 * @example
 * const registry = new CLIRegistry();
 * registry.registerAll(WELL_KNOWN_CLIS);
 * registry.register({ binaryName: 'my-tool', ... });
 *
 * const results = await registry.scan();
 * for (const r of results) {
 *   console.log(`${r.displayName}: ${r.installed ? `v${r.version}` : 'not installed'}`);
 * }
 */
export class CLIRegistry {
  private descriptors: Map<string, CLIDescriptor> = new Map();

  /**
   * Create a registry, optionally pre-populated with well-known CLIs.
   * @param loadDefaults — whether to register {@link WELL_KNOWN_CLIS} (default true)
   */
  constructor(loadDefaults: boolean = true) {
    if (loadDefaults) {
      this.registerAll(WELL_KNOWN_CLIS);
    }
  }

  /** Register a single CLI descriptor. Overwrites existing entry for the same binaryName. */
  register(descriptor: CLIDescriptor): void {
    this.descriptors.set(descriptor.binaryName, descriptor);
  }

  /** Register multiple descriptors at once. */
  registerAll(descriptors: CLIDescriptor[]): void {
    for (const d of descriptors) this.register(d);
  }

  /** Remove a descriptor by binary name. */
  unregister(binaryName: string): boolean {
    return this.descriptors.delete(binaryName);
  }

  /**
   * Scan PATH for all registered CLIs.
   * Runs `which` + `--version` for each descriptor in parallel.
   * @returns scan results for every registered CLI (installed or not)
   */
  async scan(): Promise<CLIScanResult[]> {
    return Promise.all(
      Array.from(this.descriptors.values()).map(d => this.check(d.binaryName)),
    );
  }

  /**
   * Check a single binary by name.
   * @param binaryName — the binary to look for (must be registered)
   * @returns scan result with installation status, path, and version
   */
  async check(binaryName: string): Promise<CLIScanResult> {
    const descriptor = this.descriptors.get(binaryName);
    if (!descriptor) {
      return {
        binaryName,
        displayName: binaryName,
        description: '',
        category: 'unknown',
        installGuidance: '',
        installed: false,
      };
    }

    try {
      const whichResult = await execa('which', [binaryName]);
      const binaryPath = whichResult.stdout.trim();

      const versionFlag = descriptor.versionFlag ?? '--version';
      let version = 'unknown';
      try {
        const versionResult = await execa(binaryName, [versionFlag]);
        const pattern = descriptor.versionPattern ?? /(\d+\.\d+\.\d+)/;
        const match = versionResult.stdout.match(pattern);
        version = match ? match[1] : 'unknown';
      } catch {
        /* version check failed — binary still exists though */
      }

      return { ...descriptor, installed: true, binaryPath, version };
    } catch {
      return { ...descriptor, installed: false };
    }
  }

  /** Get all registered descriptors (installed or not). */
  list(): CLIDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  /** Get only installed CLIs. */
  async installed(): Promise<CLIScanResult[]> {
    const results = await this.scan();
    return results.filter(r => r.installed);
  }

  /** Get CLIs by category. */
  async byCategory(category: string): Promise<CLIScanResult[]> {
    const results = await this.scan();
    return results.filter(r => r.category === category);
  }

  /** Check if a binary is registered (not whether it's installed). */
  has(binaryName: string): boolean {
    return this.descriptors.has(binaryName);
  }

  /** Get a descriptor by binary name. */
  get(binaryName: string): CLIDescriptor | undefined {
    return this.descriptors.get(binaryName);
  }
}
