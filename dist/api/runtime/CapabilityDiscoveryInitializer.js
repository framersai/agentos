/**
 * @file CapabilityDiscoveryInitializer.ts
 * @module api/CapabilityDiscoveryInitializer
 *
 * @description
 * Encapsulates the bootstrapping of the capability discovery subsystem and
 * turn planner, previously inlined in `AgentOS.initialize()`. This includes:
 *
 * - Creating and configuring the `EmbeddingManager` dedicated to discovery.
 * - Creating an `InMemoryVectorStore` for capability embeddings.
 * - Initializing the `CapabilityDiscoveryEngine` with sources derived from
 *   the active tool, extension, workflow, and messaging registries.
 * - Registering the discovery meta-tools.
 * - Creating the `AgentOSTurnPlanner`.
 *
 * AgentOS replaces its old `this.turnPlanner`, `this.capabilityDiscoveryEngine`,
 * `this.discoveryEmbeddingManager`, and `this.discoveryVectorStore` fields
 * with a single `CapabilityDiscoveryInitializer` instance and accesses values
 * through public read-only accessors.
 */
import { createRequire } from 'node:module';
import { EXTENSION_KIND_TOOL, EXTENSION_KIND_WORKFLOW, EXTENSION_KIND_MESSAGING_CHANNEL, } from '../extensions/index.js';
import { AgentOSTurnPlanner, } from '../../orchestration/turn-planner/TurnPlanner.js';
import { CapabilityDiscoveryEngine, createDiscoverCapabilitiesTool, createLoadCapabilityExtensionTool, } from '../discovery/index.js';
import { EmbeddingManager } from '../../rag/EmbeddingManager.js';
import { InMemoryVectorStore } from '../../rag/vector_stores/InMemoryVectorStore.js';
import { adaptTools } from './toolAdapter.js';
/** Provider-keyed defaults for discovery embedding model and dimension. */
const DISCOVERY_EMBEDDING_DEFAULTS = {
    openai: { modelId: 'text-embedding-3-small', dimension: 1536 },
    openrouter: { modelId: 'openai/text-embedding-3-small', dimension: 1536 },
    ollama: { modelId: 'nomic-embed-text', dimension: 768 },
};
const require = createRequire(import.meta.url);
let curatedManifestDescriptorCache;
function titleCase(value) {
    return value
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
async function loadCuratedManifestDescriptors(logger) {
    if (!curatedManifestDescriptorCache) {
        curatedManifestDescriptorCache = (async () => {
            try {
                const registry = await import('@framers/agentos-extensions-registry');
                const catalog = Array.isArray(registry.TOOL_CATALOG)
                    ? (registry.TOOL_CATALOG ?? [])
                    : [];
                const descriptors = [];
                for (const entry of catalog) {
                    if (typeof entry.packageName !== 'string' || !entry.packageName.trim()) {
                        continue;
                    }
                    let manifest = null;
                    try {
                        manifest = require(`${entry.packageName}/manifest.json`);
                    }
                    catch {
                        continue;
                    }
                    const extensions = Array.isArray(manifest.extensions) ? manifest.extensions : [];
                    for (const extension of extensions) {
                        if (extension?.kind !== 'tool' || typeof extension.id !== 'string' || !extension.id.trim()) {
                            continue;
                        }
                        const tags = Array.from(new Set([
                            ...(Array.isArray(manifest.keywords) ? manifest.keywords : []),
                            ...(Array.isArray(manifest.categories) ? manifest.categories : []),
                        ].filter((tag) => typeof tag === 'string' && tag.trim().length > 0)));
                        descriptors.push({
                            id: `tool:${extension.id}`,
                            kind: 'tool',
                            name: extension.id,
                            displayName: extension.displayName || titleCase(extension.id),
                            description: extension.description || entry.description || manifest.description || '',
                            category: (Array.isArray(manifest.categories) && manifest.categories[0]) ||
                                entry.category ||
                                'general',
                            tags,
                            requiredSecrets: Array.isArray(entry.requiredSecrets) ? entry.requiredSecrets : [],
                            requiredTools: [],
                            available: entry.available !== false,
                            sourceRef: {
                                type: 'extension',
                                packageName: entry.name,
                                extensionId: entry.name,
                            },
                        });
                    }
                }
                return descriptors;
            }
            catch (error) {
                logger?.warn?.('Capability discovery could not load curated registry manifests', {
                    error,
                });
                return [];
            }
        })();
    }
    return curatedManifestDescriptorCache;
}
/**
 * @class CapabilityDiscoveryInitializer
 *
 * Bootstraps the capability discovery engine and turn planner subsystem.
 * Extracted from `AgentOS` to reduce monolith complexity.
 */
export class CapabilityDiscoveryInitializer {
    constructor(deps) {
        this.deps = deps;
    }
    // ---------------------------------------------------------------------------
    // Public accessors
    // ---------------------------------------------------------------------------
    /**
     * The turn planner instance. Available after {@link initialize} completes.
     * May be `undefined` if turn planning is disabled.
     */
    get turnPlanner() {
        return this._turnPlanner;
    }
    /**
     * The capability discovery engine. Available after {@link initialize} completes.
     * May be `undefined` if discovery is disabled or initialization failed gracefully.
     */
    get discoveryEngine() {
        return this._discoveryEngine;
    }
    // ---------------------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------------------
    /**
     * Run the full bootstrapping sequence:
     * 1. Optionally create the capability discovery engine.
     * 2. Create the turn planner with the discovery engine (if available).
     * 3. Register the `discover_capabilities` meta-tool when configured.
     */
    async initialize() {
        const turnPlanningConfig = this.deps.turnPlanningConfig;
        if (turnPlanningConfig?.enabled === false) {
            this._turnPlanner = undefined;
            this._discoveryEngine = undefined;
            return;
        }
        let discoveryEngine = turnPlanningConfig?.discovery?.engine;
        if (!discoveryEngine && turnPlanningConfig?.discovery?.enabled !== false) {
            try {
                discoveryEngine = await this.initializeCapabilityDiscoveryEngine(turnPlanningConfig ?? {});
            }
            catch (error) {
                this.deps.logger.warn('Capability discovery initialization failed; planner will continue without discovery', {
                    error: error?.message ?? error,
                });
            }
        }
        this._turnPlanner = new AgentOSTurnPlanner(turnPlanningConfig, discoveryEngine, this.deps.logger.child?.({ component: 'TurnPlanner' }) ?? this.deps.logger);
        this._discoveryEngine = discoveryEngine;
        this.deps.logger.info('AgentOS turn planner initialized', {
            discoveryEnabled: Boolean(discoveryEngine?.isInitialized?.()),
            defaultToolFailureMode: turnPlanningConfig?.defaultToolFailureMode ?? 'fail_open',
            defaultToolSelectionMode: turnPlanningConfig?.discovery?.defaultToolSelectionMode ?? 'discovered',
        });
    }
    // ---------------------------------------------------------------------------
    // Shutdown
    // ---------------------------------------------------------------------------
    /**
     * Clean up owned resources: vector store, embedding manager, and
     * null out planner/engine references.
     */
    async shutdown() {
        if (this._vectorStore?.shutdown) {
            await this._vectorStore.shutdown();
            this._vectorStore = undefined;
        }
        if (this._embeddingManager?.shutdown) {
            await this._embeddingManager.shutdown();
            this._embeddingManager = undefined;
        }
        this._turnPlanner = undefined;
        this._discoveryEngine = undefined;
    }
    // ---------------------------------------------------------------------------
    // Public helpers
    // ---------------------------------------------------------------------------
    /**
     * Build capability index sources from the active runtime registries.
     *
     * @param overrides - Optional explicit sources to merge with runtime-derived data.
     * @returns Aggregated sources suitable for `CapabilityDiscoveryEngine.initialize()`.
     */
    buildCapabilityIndexSources(overrides) {
        const toolRegistry = this.deps.extensionManager.getRegistry(EXTENSION_KIND_TOOL);
        const runtimeTools = new Map();
        for (const tool of toolRegistry
            .listActive()
            .map((descriptor) => descriptor.payload)
            .filter(Boolean)) {
            runtimeTools.set(tool.name, tool);
        }
        for (const tool of adaptTools(this.deps.configTools)) {
            runtimeTools.set(tool.name, tool);
        }
        const tools = Array.from(runtimeTools.values()).map((tool) => ({
            id: tool.id || `tool:${tool.name}`,
            name: tool.name,
            displayName: tool.displayName || titleCase(tool.name),
            description: tool.description || '',
            category: tool.category || 'general',
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            requiredCapabilities: tool.requiredCapabilities,
            hasSideEffects: tool.hasSideEffects,
        }));
        const loadedPacks = this.deps.extensionManager.listLoadedPacks();
        const packExtensions = loadedPacks.map((pack) => ({
            id: `extension:${pack.key}`,
            name: pack.name,
            displayName: titleCase(pack.name),
            description: `Extension pack${pack.version ? ` v${pack.version}` : ''}`,
            category: 'extensions',
            available: true,
        }));
        const workflowRegistry = this.deps.extensionManager.getRegistry(EXTENSION_KIND_WORKFLOW);
        const workflowExtensions = workflowRegistry
            .listActive()
            .map((descriptor) => ({
            id: `workflow:${descriptor.payload.definition.id}`,
            name: descriptor.payload.definition.id,
            displayName: descriptor.payload.definition.displayName ||
                titleCase(descriptor.payload.definition.id),
            description: descriptor.payload.definition.description || 'Workflow automation capability',
            category: 'workflow',
            requiredSecrets: descriptor.payload.definition.metadata?.requiredSecrets,
            available: true,
        }));
        const messagingRegistry = this.deps.extensionManager.getRegistry(EXTENSION_KIND_MESSAGING_CHANNEL);
        const channels = messagingRegistry
            .listActive()
            .map((descriptor) => descriptor.payload)
            .filter(Boolean)
            .map((channel) => ({
            platform: channel.platform,
            displayName: channel.displayName || titleCase(channel.platform),
            description: `${channel.displayName || titleCase(channel.platform)} messaging channel`,
            capabilities: Array.isArray(channel.capabilities)
                ? channel.capabilities.map((cap) => String(cap))
                : [],
        }));
        return {
            tools,
            extensions: [...packExtensions, ...workflowExtensions, ...(overrides?.extensions ?? [])],
            channels: [...channels, ...(overrides?.channels ?? [])],
            skills: overrides?.skills,
            manifests: overrides?.manifests,
        };
    }
    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------
    /**
     * Initialize the capability discovery engine: embedding manager, vector
     * store, discovery engine, and optionally register the meta-tool.
     */
    async initializeCapabilityDiscoveryEngine(turnPlanningConfig) {
        const discoveryConfig = turnPlanningConfig.discovery;
        if (discoveryConfig?.enabled === false) {
            return undefined;
        }
        if (discoveryConfig?.autoInitializeEngine === false) {
            return undefined;
        }
        const defaultProvider = this.deps.modelProviderManager.getDefaultProvider() ??
            this.deps.modelProviderManager.getProvider(this.deps.modelProviderManagerConfig.providers.find((p) => p.enabled)?.providerId || '');
        const providerId = defaultProvider?.providerId;
        if (!providerId) {
            this.deps.logger.warn('Capability discovery disabled: no model provider available');
            return undefined;
        }
        const embeddingDefaults = DISCOVERY_EMBEDDING_DEFAULTS[providerId];
        if (!embeddingDefaults) {
            this.deps.logger.warn('Capability discovery disabled: no embedding defaults for provider', { providerId });
            return undefined;
        }
        const embeddingModelId = discoveryConfig?.embeddingModelId ?? embeddingDefaults.modelId;
        const embeddingDimension = discoveryConfig?.embeddingDimension ?? embeddingDefaults.dimension;
        const embeddingManager = new EmbeddingManager();
        await embeddingManager.initialize({
            embeddingModels: [
                {
                    modelId: embeddingModelId,
                    providerId,
                    dimension: embeddingDimension,
                    isDefault: true,
                },
            ],
            defaultModelId: embeddingModelId,
            enableCache: true,
            cacheMaxSize: 500,
            cacheTTLSeconds: 3600,
        }, this.deps.modelProviderManager);
        const vectorStore = new InMemoryVectorStore();
        await vectorStore.initialize({
            id: 'agentos-capability-discovery',
            type: 'in_memory',
        });
        const engine = new CapabilityDiscoveryEngine(embeddingManager, vectorStore, discoveryConfig?.config);
        const curatedManifestDescriptors = await loadCuratedManifestDescriptors(this.deps.logger);
        const sources = this.buildCapabilityIndexSources({
            ...discoveryConfig?.sources,
            manifests: [
                ...(discoveryConfig?.sources?.manifests ?? []),
                ...curatedManifestDescriptors,
            ],
        });
        await engine.initialize(sources, discoveryConfig?.sources?.presetCoOccurrences);
        if (discoveryConfig?.registerMetaTool !== false) {
            const existingDiscover = await this.deps.toolOrchestrator.getTool('discover_capabilities');
            if (!existingDiscover) {
                await this.deps.toolOrchestrator.registerTool(createDiscoverCapabilitiesTool(engine, this.deps.toolOrchestrator));
            }
            const existingLoad = await this.deps.toolOrchestrator.getTool('load_capability_extension');
            if (!existingLoad) {
                await this.deps.toolOrchestrator.registerTool(createLoadCapabilityExtensionTool(this.deps.toolOrchestrator));
            }
        }
        this._embeddingManager = embeddingManager;
        this._vectorStore = vectorStore;
        this.deps.logger.info('Capability discovery engine initialized', {
            providerId,
            embeddingModelId,
            indexedCapabilities: engine.listCapabilityIds().length,
        });
        return engine;
    }
}
//# sourceMappingURL=CapabilityDiscoveryInitializer.js.map