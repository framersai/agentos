/**
 * @fileoverview Capability Manifest Scanner — file-based discovery.
 * @module @framers/agentos/discovery/CapabilityManifestScanner
 *
 * Scans directories for CAPABILITY.yaml manifest files and optional
 * SKILL.md companions. Supports hot-reload via fs.watch with debouncing.
 *
 * Directory conventions:
 *   ~/.wunderland/capabilities/       (user-global)
 *   ./.wunderland/capabilities/       (workspace-local)
 *   $WUNDERLAND_CAPABILITY_DIRS       (env var, colon-separated)
 *
 * CAPABILITY.yaml format:
 *   id: custom:my-tool
 *   kind: tool
 *   name: my-tool
 *   displayName: My Custom Tool
 *   description: Does something useful
 *   category: information
 *   tags: [search, api]
 *   requiredSecrets: [MY_API_KEY]
 *   inputSchema: { type: object, properties: { query: { type: string } } }
 *   skillContent: ./SKILL.md   # optional relative path
 *
 * Extends the existing workspace-discovery.ts pattern from agentos-skills-registry.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityManifestFile,
} from './types.js';

// ============================================================================
// YAML FRONTMATTER PARSER (lightweight, no external dependency)
// ============================================================================

/**
 * Parse a simple YAML document into a plain object.
 * Handles basic scalar values, arrays, and nested objects.
 * Not a full YAML parser — sufficient for CAPABILITY.yaml manifests.
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let currentKey = '';
  let inArray = false;
  let arrayItems: unknown[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Array item (indented with -)
    if (inArray && /^\s+-\s*/.test(line)) {
      const value = line.replace(/^\s+-\s*/, '').trim();
      arrayItems.push(parseScalar(value));
      continue;
    }

    // If we were in an array, flush it
    if (inArray) {
      result[currentKey] = arrayItems;
      inArray = false;
      arrayItems = [];
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w[\w.]*)\s*:\s*(.*)/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();

      if (!value) {
        // Could be start of array or nested object
        currentKey = key;
        continue;
      }

      // Inline array: [item1, item2, item3]
      if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1);
        result[key] = inner
          .split(',')
          .map((s) => parseScalar(s.trim()))
          .filter((s) => s !== '');
        continue;
      }

      // Inline object: { key: value }
      if (value.startsWith('{') && value.endsWith('}')) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
        continue;
      }

      result[key] = parseScalar(value);
      currentKey = key;
      continue;
    }

    // Check if this starts an array
    if (/^\s+-\s*/.test(line) && currentKey) {
      inArray = true;
      const value = line.replace(/^\s+-\s*/, '').trim();
      arrayItems.push(parseScalar(value));
    }
  }

  // Flush any remaining array
  if (inArray && currentKey) {
    result[currentKey] = arrayItems;
  }

  return result;
}

/**
 * Parse a YAML scalar value to its JS type.
 */
function parseScalar(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return '';
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Remove surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ============================================================================
// MANIFEST SCANNER
// ============================================================================

export class CapabilityManifestScanner {
  private watchers: fs.FSWatcher[] = [];

  /**
   * Get default scan directories.
   *
   * 1. ~/.wunderland/capabilities/ (user-global)
   * 2. ./.wunderland/capabilities/ (workspace-local, relative to cwd)
   * 3. $WUNDERLAND_CAPABILITY_DIRS (env var, colon-separated)
   */
  getDefaultDirs(): string[] {
    const dirs: string[] = [];

    // User-global
    const homeDir = os.homedir();
    dirs.push(path.join(homeDir, '.wunderland', 'capabilities'));

    // Workspace-local
    dirs.push(path.join(process.cwd(), '.wunderland', 'capabilities'));

    // Env var
    const envDirs = process.env.WUNDERLAND_CAPABILITY_DIRS;
    if (envDirs) {
      dirs.push(...envDirs.split(':').filter(Boolean));
    }

    return dirs;
  }

  /**
   * Scan directories for CAPABILITY.yaml files.
   * Each subdirectory should contain a CAPABILITY.yaml and optional SKILL.md.
   *
   * Structure:
   *   <dir>/
   *     my-custom-tool/
   *       CAPABILITY.yaml
   *       SKILL.md          (optional)
   *       schema.json       (optional)
   */
  async scan(dirs?: string[]): Promise<CapabilityDescriptor[]> {
    const scanDirs = dirs ?? this.getDefaultDirs();
    const descriptors: CapabilityDescriptor[] = [];

    for (const dir of scanDirs) {
      if (!fs.existsSync(dir)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const capDir = path.join(dir, entry.name);
        const yamlPath = path.join(capDir, 'CAPABILITY.yaml');
        const ymlPath = path.join(capDir, 'CAPABILITY.yml');

        const manifestPath = fs.existsSync(yamlPath)
          ? yamlPath
          : fs.existsSync(ymlPath)
            ? ymlPath
            : null;

        if (!manifestPath) continue;

        try {
          const descriptor = await this.parseManifest(manifestPath, capDir);
          if (descriptor) {
            descriptors.push(descriptor);
          }
        } catch (err) {
          console.warn(
            `[CapabilityManifestScanner] Failed to parse ${manifestPath}: ${err}`,
          );
        }
      }
    }

    return descriptors;
  }

  /**
   * Parse a single CAPABILITY.yaml file into a CapabilityDescriptor.
   */
  async parseManifest(
    yamlPath: string,
    capDir: string,
  ): Promise<CapabilityDescriptor | null> {
    const content = fs.readFileSync(yamlPath, 'utf-8');
    const parsed = parseSimpleYaml(content) as Partial<CapabilityManifestFile>;

    // Validate required fields
    if (!parsed.name || !parsed.kind || !parsed.description) {
      console.warn(
        `[CapabilityManifestScanner] Missing required fields in ${yamlPath}`,
      );
      return null;
    }

    // Load optional SKILL.md content
    let fullContent: string | undefined;
    if (parsed.skillContent) {
      const skillPath = path.resolve(capDir, parsed.skillContent as string);
      if (fs.existsSync(skillPath)) {
        fullContent = fs.readFileSync(skillPath, 'utf-8');
      }
    } else {
      // Check for default SKILL.md in same directory
      const defaultSkillPath = path.join(capDir, 'SKILL.md');
      if (fs.existsSync(defaultSkillPath)) {
        fullContent = fs.readFileSync(defaultSkillPath, 'utf-8');
      }
    }

    // Load optional schema.json
    let fullSchema: Record<string, unknown> | undefined;
    if (parsed.inputSchema) {
      fullSchema = parsed.inputSchema as Record<string, unknown>;
    } else {
      const schemaPath = path.join(capDir, 'schema.json');
      if (fs.existsSync(schemaPath)) {
        try {
          fullSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        } catch {
          // Ignore invalid schema files
        }
      }
    }

    const kind = parsed.kind as CapabilityKind;
    const name = parsed.name as string;
    const id = (parsed.id as string) ?? `${kind}:${name}`;

    return {
      id,
      kind,
      name,
      displayName: (parsed.displayName as string) ?? name,
      description: parsed.description as string,
      category: (parsed.category as string) ?? 'custom',
      tags: (parsed.tags as string[]) ?? [],
      requiredSecrets: (parsed.requiredSecrets as string[]) ?? [],
      requiredTools: (parsed.requiredTools as string[]) ?? [],
      available: true,
      hasSideEffects: parsed.hasSideEffects as boolean | undefined,
      fullSchema,
      fullContent,
      sourceRef: {
        type: 'manifest',
        manifestPath: yamlPath,
        entryId: id,
      },
    };
  }

  /**
   * Watch directories for changes and call the callback when capabilities
   * are added, modified, or removed.
   *
   * Uses debouncing to prevent rapid-fire events from fs.watch.
   */
  watch(
    dirs: string[],
    onChange: (descriptors: CapabilityDescriptor[]) => void,
    debounceMs = 500,
  ): void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const descriptors = await this.scan(dirs);
          onChange(descriptors);
        } catch (err) {
          console.warn(`[CapabilityManifestScanner] Watch error: ${err}`);
        }
      }, debounceMs);
    };

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      try {
        const watcher = fs.watch(dir, { recursive: true }, handleChange);
        this.watchers.push(watcher);
      } catch {
        // fs.watch may not support recursive on all platforms
      }
    }
  }

  /**
   * Stop watching all directories.
   */
  stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }
}
