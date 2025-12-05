import { EventEmitter } from 'node:events';

import { ExtensionRegistry } from './ExtensionRegistry';
import type {
  ExtensionDescriptor,
  ExtensionKind,
  ExtensionLifecycleContext,
} from './types';
import type {
  ExtensionEventListener,
  ExtensionDescriptorEvent,
  ExtensionPackEvent,
} from './events';
import type {
  ExtensionManifest,
  ExtensionPack,
  ExtensionPackContext,
  ExtensionPackManifestEntry,
} from './manifest';
import {
  EXTENSION_KIND_WORKFLOW_EXECUTOR,
  EXTENSION_KIND_PLANNING_STRATEGY,
  EXTENSION_KIND_HITL_HANDLER,
  EXTENSION_KIND_COMM_CHANNEL,
  EXTENSION_KIND_MEMORY_PROVIDER,
} from './types';

const DEFAULT_EXTENSIONS_KIND_TOOL = 'tool';
const DEFAULT_EXTENSIONS_KIND_GUARDRAIL = 'guardrail';
const DEFAULT_EXTENSIONS_KIND_RESPONSE = 'response-processor';
const DEFAULT_EXTENSIONS_KIND_WORKFLOW = 'workflow';
const DEFAULT_EXTENSIONS_KIND_WORKFLOW_EXECUTOR = EXTENSION_KIND_WORKFLOW_EXECUTOR;
// New extension kinds (v1.1.0)
const DEFAULT_EXTENSIONS_KIND_PLANNING = EXTENSION_KIND_PLANNING_STRATEGY;
const DEFAULT_EXTENSIONS_KIND_HITL = EXTENSION_KIND_HITL_HANDLER;
const DEFAULT_EXTENSIONS_KIND_COMM = EXTENSION_KIND_COMM_CHANNEL;
const DEFAULT_EXTENSIONS_KIND_MEMORY = EXTENSION_KIND_MEMORY_PROVIDER;

interface ExtensionManagerOptions {
  manifest?: ExtensionManifest;
  secrets?: Record<string, string>;
}

/**
 * Coordinates discovery and lifecycle management for extension packs. Packs
 * emit descriptors which are registered into kind-specific registries.
 */
export class ExtensionManager {
  private readonly emitter = new EventEmitter();
  private readonly registries: Map<ExtensionKind, ExtensionRegistry<unknown>> = new Map();
  private readonly options: ExtensionManagerOptions;
  private readonly secrets = new Map<string, string>();

  constructor(options: ExtensionManagerOptions = {}) {
    this.options = options;
    if (options.secrets) {
      for (const [key, value] of Object.entries(options.secrets)) {
        if (value) {
          this.secrets.set(key, value);
        }
      }
    }
    this.ensureDefaultRegistries();
  }

  /**
    * Loads packs defined in the manifest, registering their descriptors in the
    * appropriate registries. This method currently supports factory-based packs;
    * package/module resolution will be introduced in a follow-up iteration.
    */
  public async loadManifest(context?: ExtensionLifecycleContext): Promise<void> {
    const manifest = this.options.manifest;
    if (!manifest) {
      return;
    }

    for (const entry of manifest.packs) {
      if (entry.enabled === false) {
        continue;
      }

      try {
        const pack = await this.resolvePack(entry);
        if (!pack) {
          continue;
        }

        await this.registerPack(pack, entry, context);
        this.emitPackEvent({
          type: 'pack:loaded',
          timestamp: new Date().toISOString(),
          source: {
            sourceName: pack.name,
            sourceVersion: pack.version,
            identifier: entry.identifier,
          },
        });
      } catch (error) {
        const sourceName =
          'package' in entry
            ? entry.package
            : 'module' in entry
            ? entry.module
            : entry.identifier ?? 'inline-pack';
        this.emitPackEvent({
          type: 'pack:failed',
          timestamp: new Date().toISOString(),
          source: {
            sourceName,
            identifier: entry.identifier,
          },
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  /**
   * Registers a listener for extension lifecycle events.
   */
  public on(listener: ExtensionEventListener): void {
    this.emitter.on('event', listener);
  }

  public off(listener: ExtensionEventListener): void {
    this.emitter.off('event', listener);
  }

  /**
   * Directly loads a pack instance (typically produced by an inline factory)
   * and registers all of its descriptors.
   */
  public async loadPackFromFactory(
    pack: ExtensionPack,
    identifier?: string,
    options?: Record<string, unknown>,
    lifecycleContext?: ExtensionLifecycleContext,
  ): Promise<void> {
    const entry: ExtensionPackManifestEntry = {
      factory: async () => pack,
      identifier,
      options,
    };

    await this.registerPack(pack, entry, lifecycleContext);
    this.emitPackEvent({
      type: 'pack:loaded',
      timestamp: new Date().toISOString(),
      source: {
        sourceName: pack.name,
        sourceVersion: pack.version,
        identifier,
      },
    });
  }

  /**
   * Provides the registry for a particular kind, creating it if necessary.
   */
  public getRegistry<TPayload>(kind: ExtensionKind): ExtensionRegistry<TPayload> {
    let registry = this.registries.get(kind) as ExtensionRegistry<TPayload> | undefined;
    if (!registry) {
      registry = new ExtensionRegistry<TPayload>(kind);
      this.registries.set(kind, registry as ExtensionRegistry<unknown>);
    }
    return registry;
  }

  private ensureDefaultRegistries(): void {
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_TOOL);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_GUARDRAIL);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_RESPONSE);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_WORKFLOW);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_WORKFLOW_EXECUTOR);
    // New extension registries (v1.1.0)
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_PLANNING);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_HITL);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_COMM);
    this.getRegistry(DEFAULT_EXTENSIONS_KIND_MEMORY);
  }

  private async resolvePack(entry: ExtensionPackManifestEntry): Promise<ExtensionPack | null> {
    if ('factory' in entry && typeof entry.factory === 'function') {
      const pack = await entry.factory();
      return pack;
    }

    // Package and module resolution will be implemented in a subsequent phase.
    return null;
  }

  private async registerPack(
    pack: ExtensionPack,
    entry: ExtensionPackManifestEntry,
    lifecycleContext?: ExtensionLifecycleContext,
  ): Promise<void> {
    const ctx: ExtensionPackContext = {
      manifestEntry: entry,
      source: {
        sourceName: pack.name,
        sourceVersion: pack.version,
        identifier: entry.identifier,
      },
      options: entry.options,
    };

    for (const descriptor of pack.descriptors) {
      await this.registerDescriptor(descriptor, ctx, lifecycleContext);
    }
  }

  private async registerDescriptor(
    descriptor: ExtensionDescriptor,
    ctx: ExtensionPackContext,
    lifecycleContext?: ExtensionLifecycleContext,
  ): Promise<void> {
    if (descriptor.requiredSecrets?.length) {
      const missing = descriptor.requiredSecrets.filter((req) => !this.resolveSecret(req.id));
      const blocking = missing.filter((req) => !req.optional);
      if (blocking.length > 0) {
        console.warn(
          `ExtensionManager: Skipping descriptor '${descriptor.id}' (${descriptor.kind}) because required secrets are missing: ${blocking
            .map((req) => req.id)
            .join(', ')}`,
        );
        return;
      }
    }

    const registry = this.getRegistry(descriptor.kind);
    const payloadDescriptor = {
      ...descriptor,
      priority: descriptor.priority ?? ctx.manifestEntry.priority ?? 0,
      source: descriptor.source ?? ctx.source,
    };
    await registry.register(payloadDescriptor, this.enrichLifecycleContext(lifecycleContext));
    this.emitDescriptorEvent({
      type: 'descriptor:activated',
      timestamp: new Date().toISOString(),
      kind: descriptor.kind,
      descriptor: payloadDescriptor,
    });
  }

  private enrichLifecycleContext(
    context?: ExtensionLifecycleContext,
  ): ExtensionLifecycleContext {
    return {
      ...(context ?? {}),
      getSecret: (id: string) => this.resolveSecret(id),
    };
  }

  private resolveSecret(id: string): string | undefined {
    return this.secrets.get(id);
  }

  private emitDescriptorEvent(event: ExtensionDescriptorEvent): void {
    this.emitter.emit('event', event);
  }

  private emitPackEvent(event: ExtensionPackEvent): void {
    this.emitter.emit('event', event);
  }
}
