import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExtensionRegistry } from './ExtensionRegistry.js';
import { SharedServiceRegistry } from './SharedServiceRegistry.js';
import { EXTENSION_KIND_WORKFLOW_EXECUTOR, EXTENSION_KIND_PLANNING_STRATEGY, EXTENSION_KIND_HITL_HANDLER, EXTENSION_KIND_COMM_CHANNEL, EXTENSION_KIND_MEMORY_PROVIDER, EXTENSION_KIND_MESSAGING_CHANNEL, EXTENSION_KIND_PROVENANCE, EXTENSION_KIND_STT_PROVIDER, EXTENSION_KIND_TTS_PROVIDER, EXTENSION_KIND_VAD_PROVIDER, EXTENSION_KIND_WAKE_WORD_PROVIDER, } from './types.js';
import { getSecretDefinition } from '../core/config/extensionSecrets.js';
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
const DEFAULT_EXTENSIONS_KIND_PROVENANCE = EXTENSION_KIND_PROVENANCE;
const DEFAULT_EXTENSIONS_KIND_STT = EXTENSION_KIND_STT_PROVIDER;
const DEFAULT_EXTENSIONS_KIND_TTS = EXTENSION_KIND_TTS_PROVIDER;
const DEFAULT_EXTENSIONS_KIND_VAD = EXTENSION_KIND_VAD_PROVIDER;
const DEFAULT_EXTENSIONS_KIND_WAKE_WORD = EXTENSION_KIND_WAKE_WORD_PROVIDER;
/**
 * Coordinates discovery and lifecycle management for extension packs. Packs
 * emit descriptors which are registered into kind-specific registries.
 */
export class ExtensionManager {
    constructor(options = {}) {
        this.emitter = new EventEmitter();
        this.registries = new Map();
        this.secrets = new Map();
        this.services = new SharedServiceRegistry();
        this.loadedPacks = [];
        this.loadedPackKeys = new Set();
        this.loadedPackRecords = [];
        this.options = options;
        if (options.secrets) {
            for (const [key, value] of Object.entries(options.secrets)) {
                if (value) {
                    this.secrets.set(key, value);
                }
            }
        }
        this.overrides = mergeOverrides(options.manifest?.overrides, options.overrides);
        this.ensureDefaultRegistries();
    }
    /**
      * Loads packs defined in the manifest, registering their descriptors in the
      * appropriate registries. Supports factory-based packs as well as resolving
      * packs from `package` and `module` manifest entries.
      */
    async loadManifest(context) {
        const manifest = this.options.manifest;
        if (!manifest) {
            return;
        }
        for (const entry of manifest.packs) {
            await this.loadPackEntry(entry, context);
        }
    }
    /**
     * Registers a listener for extension lifecycle events.
     */
    on(listener) {
        this.emitter.on('event', listener);
    }
    off(listener) {
        this.emitter.off('event', listener);
    }
    /**
     * Directly loads a pack instance (typically produced by an inline factory)
     * and registers all of its descriptors.
     */
    async loadPackFromFactory(pack, identifier, options, lifecycleContext) {
        const entry = {
            factory: async () => pack,
            identifier,
            options,
        };
        const outcome = await this.loadPackEntry(entry, lifecycleContext);
        if (!outcome.loaded) {
            if (outcome.skipped && outcome.reason === 'already_loaded') {
                return;
            }
            const err = outcome.skipped ? new Error(outcome.reason || 'Unknown extension pack load failure') : outcome.error;
            throw err;
        }
    }
    /**
     * Load a single manifest entry at runtime, applying the same resolution,
     * secret hydration, registration, and event emission logic as {@link loadManifest}.
     *
     * This enables schema-on-demand / lazy-loading flows where an agent can
     * enable an extension pack mid-session.
     */
    async loadPackEntry(entry, lifecycleContext) {
        if (entry.enabled === false) {
            return { loaded: false, skipped: true, reason: 'disabled' };
        }
        const preKey = this.resolvePackKey(entry);
        if (preKey && this.loadedPackKeys.has(preKey)) {
            return { loaded: false, skipped: true, reason: 'already_loaded', key: preKey };
        }
        try {
            this.hydrateSecretsFromPackEntry(entry);
            const pack = await this.resolvePack(entry, lifecycleContext);
            if (!pack) {
                return { loaded: false, skipped: true, reason: 'unresolved', key: preKey ?? undefined };
            }
            const key = this.resolvePackKey(entry, pack);
            if (key && this.loadedPackKeys.has(key)) {
                return { loaded: false, skipped: true, reason: 'already_loaded', key };
            }
            await this.registerPack(pack, entry, lifecycleContext);
            if (key) {
                this.loadedPackKeys.add(key);
                this.loadedPackRecords.push({
                    key,
                    name: pack.name,
                    version: pack.version ?? undefined,
                    identifier: entry.identifier,
                    packageName: 'package' in entry ? entry.package : undefined,
                    module: 'module' in entry ? entry.module : undefined,
                    loadedAt: new Date().toISOString(),
                });
            }
            this.emitPackEvent({
                type: 'pack:loaded',
                timestamp: new Date().toISOString(),
                source: {
                    sourceName: pack.name,
                    sourceVersion: pack.version,
                    identifier: entry.identifier,
                },
            });
            return {
                loaded: true,
                key: key ?? pack.name,
                pack: { name: pack.name, version: pack.version ?? undefined, identifier: entry.identifier ?? undefined },
            };
        }
        catch (error) {
            const sourceName = 'package' in entry
                ? entry.package
                : 'module' in entry
                    ? entry.module
                    : entry.identifier ?? 'inline-pack';
            const err = error instanceof Error ? error : new Error(String(error));
            this.emitPackEvent({
                type: 'pack:failed',
                timestamp: new Date().toISOString(),
                source: {
                    sourceName,
                    identifier: entry.identifier,
                },
                error: err,
            });
            return { loaded: false, skipped: false, reason: 'failed', key: preKey ?? undefined, error: err, sourceName };
        }
    }
    /**
     * Convenience: load an extension pack by npm package name at runtime.
     */
    async loadPackFromPackage(packageName, options, identifier, lifecycleContext) {
        const entry = {
            package: packageName,
            identifier: identifier ?? `runtime:${packageName}`,
            options,
        };
        return this.loadPackEntry(entry, lifecycleContext);
    }
    /**
     * Convenience: load an extension pack by local module specifier at runtime.
     */
    async loadPackFromModule(moduleSpecifier, options, identifier, lifecycleContext) {
        const entry = {
            module: moduleSpecifier,
            identifier: identifier ?? `runtime:${moduleSpecifier}`,
            options,
        };
        return this.loadPackEntry(entry, lifecycleContext);
    }
    /**
     * List pack metadata for packs loaded during this process lifetime.
     */
    listLoadedPacks() {
        return [...this.loadedPackRecords];
    }
    /**
     * Provides the registry for a particular kind, creating it if necessary.
     */
    getRegistry(kind) {
        let registry = this.registries.get(kind);
        if (!registry) {
            registry = new ExtensionRegistry(kind);
            this.registries.set(kind, registry);
        }
        return registry;
    }
    /**
     * Deactivates all loaded descriptors and extension packs.
     *
     * This is intentionally best-effort: one failing deactivation should not
     * prevent other packs/descriptors from shutting down.
     */
    async shutdown(context) {
        const lifecycleContext = this.enrichLifecycleContext(context);
        for (const registry of this.registries.values()) {
            await registry.clear(lifecycleContext).catch((err) => {
                console.warn(`ExtensionManager: Failed clearing registry during shutdown`, err);
            });
        }
        for (const pack of [...this.loadedPacks].reverse()) {
            try {
                await pack.onDeactivate?.(lifecycleContext);
            }
            catch (err) {
                console.warn(`ExtensionManager: Pack '${pack.name}' onDeactivate failed`, err);
            }
        }
        this.loadedPacks.length = 0;
        this.loadedPackKeys.clear();
        this.loadedPackRecords.length = 0;
        await this.services.releaseAll().catch((err) => {
            console.warn(`ExtensionManager: Failed releasing shared services during shutdown`, err);
        });
    }
    ensureDefaultRegistries() {
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
        this.getRegistry(DEFAULT_EXTENSIONS_KIND_STT);
        this.getRegistry(DEFAULT_EXTENSIONS_KIND_TTS);
        this.getRegistry(DEFAULT_EXTENSIONS_KIND_VAD);
        this.getRegistry(DEFAULT_EXTENSIONS_KIND_WAKE_WORD);
        // Messaging Channels — external human-facing platforms (v1.3.0)
        this.getRegistry(EXTENSION_KIND_MESSAGING_CHANNEL);
        // Provenance & Audit (v1.2.0)
        this.getRegistry(DEFAULT_EXTENSIONS_KIND_PROVENANCE);
    }
    resolvePackKey(entry, pack) {
        if (entry.identifier && String(entry.identifier).trim()) {
            return `id:${String(entry.identifier).trim()}`;
        }
        if ('package' in entry && typeof entry.package === 'string' && entry.package.trim()) {
            return `pkg:${entry.package.trim()}`;
        }
        if ('module' in entry && typeof entry.module === 'string' && entry.module.trim()) {
            return `mod:${entry.module.trim()}`;
        }
        if (pack?.name && typeof pack.name === 'string' && pack.name.trim()) {
            return `name:${pack.name.trim()}`;
        }
        return null;
    }
    async resolvePack(entry, lifecycleContext) {
        if ('factory' in entry && typeof entry.factory === 'function') {
            return await entry.factory();
        }
        const ctx = this.enrichLifecycleContext(lifecycleContext);
        if ('package' in entry && typeof entry.package === 'string' && entry.package.trim()) {
            const mod = await import(entry.package);
            return this.resolvePackFromModule(mod, entry, ctx);
        }
        if ('module' in entry && typeof entry.module === 'string' && entry.module.trim()) {
            const spec = normalizeModuleSpecifier(entry.module);
            const mod = await import(spec);
            return this.resolvePackFromModule(mod, entry, ctx);
        }
        return null;
    }
    resolvePackFromModule(mod, entry, lifecycleContext) {
        const factory = mod?.createExtensionPack ?? mod?.default?.createExtensionPack ?? mod?.default;
        if (typeof factory === 'function') {
            const packContext = {
                manifestEntry: entry,
                options: entry.options,
                logger: lifecycleContext.logger,
                getSecret: lifecycleContext.getSecret,
                services: lifecycleContext.services,
            };
            return factory(packContext);
        }
        const candidate = mod?.default ?? mod;
        if (candidate &&
            typeof candidate === 'object' &&
            typeof candidate.name === 'string' &&
            Array.isArray(candidate.descriptors)) {
            return candidate;
        }
        const source = 'package' in entry ? entry.package : 'module' in entry ? entry.module : entry.identifier ?? 'unknown';
        throw new Error(`ExtensionManager: Failed to resolve pack from ${source} — expected createExtensionPack() or a default ExtensionPack export.`);
    }
    async registerPack(pack, entry, lifecycleContext) {
        const enrichedLifecycleContext = this.enrichLifecycleContext(lifecycleContext);
        let packActivated = false;
        // Pack-level lifecycle hook (used by several curated packs for initialization).
        await pack.onActivate?.(enrichedLifecycleContext);
        packActivated = true;
        const ctx = {
            manifestEntry: entry,
            source: {
                sourceName: pack.name,
                sourceVersion: pack.version,
                identifier: entry.identifier,
            },
            options: entry.options,
            logger: enrichedLifecycleContext.logger,
            getSecret: enrichedLifecycleContext.getSecret,
            services: enrichedLifecycleContext.services,
        };
        try {
            for (const descriptor of pack.descriptors) {
                await this.registerDescriptor(descriptor, ctx, lifecycleContext);
            }
            this.loadedPacks.push(pack);
        }
        catch (err) {
            // Best-effort cleanup to avoid leaking resources for partially-registered packs.
            if (packActivated) {
                try {
                    await pack.onDeactivate?.(enrichedLifecycleContext);
                }
                catch (cleanupErr) {
                    console.warn(`ExtensionManager: Pack '${pack.name}' onDeactivate failed after registration error`, cleanupErr);
                }
            }
            throw err;
        }
    }
    async registerDescriptor(descriptor, ctx, lifecycleContext) {
        const override = this.resolveOverride(descriptor.kind, descriptor.id);
        if (override?.enabled === false) {
            ctx.logger?.info?.(`ExtensionManager: Skipping descriptor '${descriptor.id}' (${descriptor.kind}) due to override`);
            return;
        }
        if (descriptor.requiredSecrets?.length) {
            const missing = descriptor.requiredSecrets.filter((req) => !this.resolveSecret(req.id));
            const blocking = missing.filter((req) => !req.optional);
            if (blocking.length > 0) {
                console.warn(`ExtensionManager: Skipping descriptor '${descriptor.id}' (${descriptor.kind}) because required secrets are missing: ${blocking
                    .map((req) => req.id)
                    .join(', ')}`);
                return;
            }
        }
        const registry = this.getRegistry(descriptor.kind);
        const payloadDescriptor = {
            ...descriptor,
            priority: override?.priority ?? descriptor.priority ?? ctx.manifestEntry?.priority ?? 0,
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
    enrichLifecycleContext(context) {
        return {
            ...(context ?? {}),
            getSecret: (id) => this.resolveSecret(id),
            services: context?.services ?? this.services,
        };
    }
    resolveSecret(id) {
        const direct = this.secrets.get(id);
        if (direct) {
            return direct;
        }
        // Fall back to environment variables for known secret ids.
        const definition = getSecretDefinition(id);
        const envVar = definition?.envVar;
        const envValue = envVar && typeof process !== 'undefined' ? process.env?.[envVar] : undefined;
        if (typeof envValue === 'string' && envValue.trim()) {
            return envValue;
        }
        return undefined;
    }
    resolveOverride(kind, id) {
        if (!this.overrides) {
            return undefined;
        }
        // Overrides are currently supported for tools, guardrails, and response processors.
        if (kind === DEFAULT_EXTENSIONS_KIND_TOOL) {
            return this.overrides.tools?.[id];
        }
        if (kind === DEFAULT_EXTENSIONS_KIND_GUARDRAIL) {
            return this.overrides.guardrails?.[id];
        }
        if (kind === DEFAULT_EXTENSIONS_KIND_RESPONSE) {
            return this.overrides.responses?.[id];
        }
        return undefined;
    }
    hydrateSecretsFromPackEntry(entry) {
        const opts = entry.options;
        const secrets = opts?.secrets;
        if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
            return;
        }
        for (const [key, value] of Object.entries(secrets)) {
            if (typeof value !== 'string')
                continue;
            const trimmed = value.trim();
            if (!trimmed)
                continue;
            // Allow explicit ExtensionManager.secrets to win over per-pack secrets.
            if (!this.secrets.has(key)) {
                this.secrets.set(key, trimmed);
            }
        }
    }
    emitDescriptorEvent(event) {
        this.emitter.emit('event', event);
    }
    emitPackEvent(event) {
        this.emitter.emit('event', event);
    }
}
function mergeOverrides(base, extra) {
    if (!base && !extra) {
        return undefined;
    }
    const merged = {
        tools: { ...(base?.tools ?? {}) },
        guardrails: { ...(base?.guardrails ?? {}) },
        responses: { ...(base?.responses ?? {}) },
    };
    for (const [key, value] of Object.entries(extra?.tools ?? {})) {
        merged.tools[key] = { ...(merged.tools[key] ?? {}), ...value };
    }
    for (const [key, value] of Object.entries(extra?.guardrails ?? {})) {
        merged.guardrails[key] = { ...(merged.guardrails[key] ?? {}), ...value };
    }
    for (const [key, value] of Object.entries(extra?.responses ?? {})) {
        merged.responses[key] = { ...(merged.responses[key] ?? {}), ...value };
    }
    return merged;
}
function normalizeModuleSpecifier(raw) {
    const spec = raw.trim();
    if (!spec)
        return spec;
    if (spec.startsWith('file://'))
        return spec;
    // Support workspace-relative paths for convenience.
    if (spec.startsWith('.') || spec.startsWith('/')) {
        const abs = path.isAbsolute(spec) ? spec : path.resolve(process.cwd(), spec);
        return pathToFileURL(abs).href;
    }
    return spec;
}
//# sourceMappingURL=ExtensionManager.js.map