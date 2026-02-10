/**
 * @file schema-on-demand-pack.ts
 * @description ExtensionPack that exposes "schema-on-demand" meta tools for
 * enabling extension packs at runtime. This supports "lazy tool schemas":
 * start with a small toolset (this pack), then dynamically load additional
 * packs when the model requests them.
 *
 * @module AgentOS/Extensions/Packs
 */

import type { ExtensionPack } from '../manifest.js';
import { EXTENSION_KIND_TOOL } from '../types.js';
import type {
  ITool,
  JSONSchemaObject,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../../core/tools/ITool.js';
import type { ExtensionManager } from '../ExtensionManager.js';

type ExtensionsListInput = {
  includeUnavailable?: boolean;
};

type LoadedPackInfo = {
  key: string;
  name: string;
  version?: string;
  identifier?: string;
  packageName?: string;
  module?: string;
  loadedAt: string;
};

type CuratedExtensionInfo = {
  name: string;
  packageName: string;
  category?: string;
  displayName?: string;
  description?: string;
  requiredSecrets?: string[];
  available?: boolean;
};

type ExtensionsListOutput = {
  loadedPacks: LoadedPackInfo[];
  curated?: CuratedExtensionInfo[];
  note?: string;
};

type ExtensionsEnableInput = {
  /**
   * Extension reference:
   * - when source is 'curated' (default): a curated name like 'web-search' or 'skills'
   * - when source is 'package': an npm package name like '@framers/agentos-ext-web-search'
   * - when source is 'module': a local module specifier/path
   */
  extension: string;
  source?: 'curated' | 'package' | 'module';
  /** Optional options passed to createExtensionPack() via manifest entry options. */
  options?: Record<string, unknown>;
  /** Optional manifest identifier override. */
  identifier?: string;
  /** If true, returns what would happen without loading the pack. */
  dryRun?: boolean;
};

type ExtensionsEnableOutput = {
  source: 'curated' | 'package' | 'module';
  extension: string;
  resolved?: {
    packageName?: string;
    moduleSpecifier?: string;
    identifier?: string;
  };
  loaded: boolean;
  skipped?: boolean;
  reason?: string;
  toolsAdded?: string[];
  toolsCountBefore?: number;
  toolsCountAfter?: number;
};

type ExtensionsStatusOutput = {
  loadedPacks: LoadedPackInfo[];
};

const EXT_REGISTRY_MODULE = '@framers/agentos-extensions-registry';

async function tryLoadExtensionsRegistry(): Promise<any | null> {
  try {
    // Avoid a hard dependency: this pack works without the registry bundle,
    // but curated discovery is better when it's installed.
    const mod = await import(EXT_REGISTRY_MODULE as unknown as string);
    return mod ?? null;
  } catch {
    return null;
  }
}

async function getCuratedExtensionsCatalog(): Promise<{ curated?: CuratedExtensionInfo[]; note?: string }> {
  const mod = await tryLoadExtensionsRegistry();
  if (!mod || typeof mod.getAvailableExtensions !== 'function') {
    return {
      curated: undefined,
      note:
        `Curated extension catalog unavailable. Install ${EXT_REGISTRY_MODULE} to enable curated discovery.`,
    };
  }

  try {
    const entries = (await mod.getAvailableExtensions()) as CuratedExtensionInfo[];
    return { curated: entries };
  } catch (err: any) {
    return {
      curated: undefined,
      note: `Failed to load curated extension catalog: ${err?.message ?? String(err)}`,
    };
  }
}

function listActiveToolNames(manager: ExtensionManager): string[] {
  return manager
    .getRegistry<any>(EXTENSION_KIND_TOOL)
    .listActive()
    .map((d: any) => String(d?.id))
    .filter(Boolean);
}

function diffAdded(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((name) => !beforeSet.has(name));
}

export interface SchemaOnDemandPackOptions {
  /**
   * When true, allow enabling packs via `source='package'`.
   *
   * Default: true in non-production, false in production.
   *
   * Note: when `officialRegistryOnly` is enabled (default), package names must
   * still be present in the installed `@framers/agentos-extensions-registry` catalog.
   */
  allowPackages?: boolean;
  /**
   * When true, allow enabling packs via `source='module'` with a local module specifier/path.
   *
   * Default: false.
   */
  allowModules?: boolean;
  /**
   * When true, only allow loading extension packs present in the official
   * `@framers/agentos-extensions-registry` catalog.
   *
   * This blocks arbitrary npm imports (typosquatting/supply-chain).
   *
   * Default: true.
   */
  officialRegistryOnly?: boolean;
}

/**
 * Create an ExtensionPack that adds schema-on-demand tools:
 * - `extensions_list`
 * - `extensions_enable`
 * - `extensions_status`
 */
export function createSchemaOnDemandPack(opts: {
  extensionManager: ExtensionManager;
  options?: SchemaOnDemandPackOptions;
}): ExtensionPack {
  const manager = opts.extensionManager;
  const options = opts.options ?? {};
  const allowPackages =
    typeof options.allowPackages === 'boolean' ? options.allowPackages : process.env.NODE_ENV !== 'production';
  const allowModules = options.allowModules === true;
  const officialRegistryOnly = options.officialRegistryOnly !== false;

  const extensionsListTool: ITool<ExtensionsListInput, ExtensionsListOutput> = {
    id: 'agentos-extensions-list-v1',
    name: 'extensions_list',
    displayName: 'List Extensions',
    description: 'List loaded extension packs and (optionally) the curated extension catalog.',
    category: 'system',
    hasSideEffects: false,
    inputSchema: {
      type: 'object',
      properties: {
        includeUnavailable: {
          type: 'boolean',
          default: false,
          description: 'Include curated entries that are not installed (available=false).',
        },
      },
      additionalProperties: false,
    } as JSONSchemaObject,
    execute: async (input: ExtensionsListInput): Promise<ToolExecutionResult<ExtensionsListOutput>> => {
      const loadedPacks = manager.listLoadedPacks();
      const { curated, note } = await getCuratedExtensionsCatalog();

      const includeUnavailable = input?.includeUnavailable === true;
      const filteredCurated = curated
        ? curated.filter((c) => includeUnavailable || c.available !== false)
        : undefined;

      return {
        success: true,
        output: {
          loadedPacks,
          curated: filteredCurated,
          note,
        },
      };
    },
  };

  const extensionsStatusTool: ITool<Record<string, never>, ExtensionsStatusOutput> = {
    id: 'agentos-extensions-status-v1',
    name: 'extensions_status',
    displayName: 'Extensions Status',
    description: 'Show which extension packs are loaded in this AgentOS process.',
    category: 'system',
    hasSideEffects: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    } as JSONSchemaObject,
    execute: async (): Promise<ToolExecutionResult<ExtensionsStatusOutput>> => {
      return { success: true, output: { loadedPacks: manager.listLoadedPacks() } };
    },
  };

  const extensionsEnableTool: ITool<ExtensionsEnableInput, ExtensionsEnableOutput> = {
    id: 'agentos-extensions-enable-v1',
    name: 'extensions_enable',
    displayName: 'Enable Extension',
    description:
      'Load an extension pack at runtime so its tools become available in the next tool-listing iteration. This has side effects and should be human-approved.',
    category: 'system',
    hasSideEffects: true,
    inputSchema: {
      type: 'object',
      required: ['extension'],
      properties: {
        extension: {
          type: 'string',
          description:
            "Extension ref. Default source='curated' uses curated names like 'web-search' or 'skills'.",
        },
        source: {
          type: 'string',
          enum: ['curated', 'package', 'module'],
          description: "Where to resolve from. Default: 'curated'.",
          default: 'curated',
        },
        options: {
          type: 'object',
          description: 'Options passed to the extension pack factory.',
          additionalProperties: true,
        },
        identifier: {
          type: 'string',
          description: 'Optional manifest identifier override.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Return what would happen without loading.',
          default: false,
        },
      },
      additionalProperties: false,
    } as JSONSchemaObject,
    execute: async (
      input: ExtensionsEnableInput,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult<ExtensionsEnableOutput>> => {
      const raw = (input?.extension || '').trim();
      if (!raw) {
        return { success: false, error: 'Missing required field: extension' };
      }

      const source: NonNullable<ExtensionsEnableInput['source']> = input?.source ?? 'curated';

      // Resolve package/module target.
      let packageName: string | undefined;
      let moduleSpecifier: string | undefined;

      if (source === 'module') {
        if (!allowModules) {
          return { success: false, error: "Module loading is disabled by SchemaOnDemandPackOptions.allowModules=false" };
        }
        moduleSpecifier = raw;
      } else if (source === 'package') {
        if (!allowPackages) {
          return { success: false, error: "Package loading is disabled by SchemaOnDemandPackOptions.allowPackages=false" };
        }

        if (!officialRegistryOnly) {
          packageName = raw;
        } else {
          const { curated, note } = await getCuratedExtensionsCatalog();
          if (!curated) {
            return { success: false, error: note || 'Curated extension catalog unavailable.' };
          }

          const match = curated.find((c) => c.packageName === raw || c.name === raw);
          if (!match) {
            return { success: false, error: `Package is not in the official registry: ${raw}` };
          }

          packageName = match.packageName;
        }
      } else {
        // curated (default)
        const { curated, note } = await getCuratedExtensionsCatalog();
        if (!curated) {
          return { success: false, error: note || 'Curated extension catalog unavailable.' };
        }

        const match = curated.find((c) => c.name === raw || c.packageName === raw);
        if (!match) {
          return { success: false, error: `Unknown curated extension: ${raw}` };
        }

        packageName = match.packageName;
      }

      const identifier = (input?.identifier && String(input.identifier).trim()) || undefined;
      const dryRun = input?.dryRun === true;
      const toolsBefore = listActiveToolNames(manager);

      if (dryRun) {
        return {
          success: true,
          output: {
            source,
            extension: raw,
            resolved: {
              packageName,
              moduleSpecifier,
              identifier,
            },
            loaded: false,
            skipped: true,
            reason: 'dry_run',
            toolsCountBefore: toolsBefore.length,
            toolsCountAfter: toolsBefore.length,
            toolsAdded: [],
          },
        };
      }

      const outcome = packageName
        ? await manager.loadPackFromPackage(packageName, input?.options, identifier)
        : await manager.loadPackFromModule(moduleSpecifier!, input?.options, identifier);

      const toolsAfter = listActiveToolNames(manager);
      const toolsAdded = diffAdded(toolsBefore, toolsAfter);

      if (!outcome.loaded) {
        if (outcome.skipped) {
          return {
            success: true,
            output: {
              source,
              extension: raw,
              resolved: { packageName, moduleSpecifier, identifier },
              loaded: false,
              skipped: true,
              reason: outcome.reason,
              toolsAdded,
              toolsCountBefore: toolsBefore.length,
              toolsCountAfter: toolsAfter.length,
            },
          };
        }

        return {
          success: false,
          error: outcome.error.message,
          details: { outcome, resolved: { packageName, moduleSpecifier, identifier } },
        };
      }

      return {
        success: true,
        output: {
          source,
          extension: raw,
          resolved: {
            packageName,
            moduleSpecifier,
            identifier: outcome.pack.identifier ?? identifier,
          },
          loaded: true,
          toolsAdded,
          toolsCountBefore: toolsBefore.length,
          toolsCountAfter: toolsAfter.length,
        },
      };
    },
  };

  return {
    name: 'schema-on-demand',
    version: '1.0.0',
    descriptors: [
      { id: extensionsListTool.name, kind: EXTENSION_KIND_TOOL, priority: 0, payload: extensionsListTool },
      { id: extensionsEnableTool.name, kind: EXTENSION_KIND_TOOL, priority: 0, payload: extensionsEnableTool },
      { id: extensionsStatusTool.name, kind: EXTENSION_KIND_TOOL, priority: 0, payload: extensionsStatusTool },
    ],
  };
}
