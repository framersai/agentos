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
 * - Registering the `discover_capabilities` meta-tool.
 * - Creating the `AgentOSTurnPlanner`.
 *
 * AgentOS replaces its old `this.turnPlanner`, `this.capabilityDiscoveryEngine`,
 * `this.discoveryEmbeddingManager`, and `this.discoveryVectorStore` fields
 * with a single `CapabilityDiscoveryInitializer` instance and accesses values
 * through public read-only accessors.
 */

import type { ILogger } from '../logging/ILogger';
import type { IToolOrchestrator } from '../core/tools/IToolOrchestrator';
import type { ITool } from '../core/tools/ITool';
import type { AIModelProviderManager } from '../core/llm/providers/AIModelProviderManager';
import {
  type ExtensionManager,
  EXTENSION_KIND_TOOL,
  EXTENSION_KIND_WORKFLOW,
  EXTENSION_KIND_MESSAGING_CHANNEL,
} from '../extensions';
import type { MessagingChannelPayload } from '../extensions/MessagingChannelPayload';
import {
  AgentOSTurnPlanner,
  type ITurnPlanner,
} from '../core/orchestration/TurnPlanner';
import {
  CapabilityDiscoveryEngine,
  createDiscoverCapabilitiesTool,
} from '../discovery';
import type {
  CapabilityIndexSources,
  ICapabilityDiscoveryEngine,
} from '../discovery/types';
import { EmbeddingManager } from '../rag/EmbeddingManager';
import { InMemoryVectorStore } from '../rag/vector_stores/InMemoryVectorStore';
import type { WorkflowDescriptorPayload } from '../planning/workflows/WorkflowTypes';

import type {
  AgentOSTurnPlanningConfig,
  AgentOSCapabilityDiscoverySources,
} from './AgentOS';
import { adaptTools } from './toolAdapter';
import type { AdaptableToolInput } from './toolAdapter';
import type { AIModelProviderManagerConfig } from '../core/llm/providers/AIModelProviderManager';

/** Provider-keyed defaults for discovery embedding model and dimension. */
const DISCOVERY_EMBEDDING_DEFAULTS: Record<string, { modelId: string; dimension: number }> = {
  openai: { modelId: 'text-embedding-3-small', dimension: 1536 },
  openrouter: { modelId: 'openai/text-embedding-3-small', dimension: 1536 },
  ollama: { modelId: 'nomic-embed-text', dimension: 768 },
};

/**
 * Dependencies injected into the initializer at construction time.
 */
export interface CapabilityDiscoveryInitializerDependencies {
  /** Tool orchestrator for meta-tool registration and tool listing. */
  toolOrchestrator: IToolOrchestrator;
  /** Extension manager providing access to tool/workflow/channel registries. */
  extensionManager: ExtensionManager;
  /** Model provider manager used to derive embedding provider and create embedding manager. */
  modelProviderManager: AIModelProviderManager;
  /** Model provider manager configuration for provider ID fallback lookup. */
  modelProviderManagerConfig: AIModelProviderManagerConfig;
  /** Turn planning configuration (may be undefined if feature is disabled). */
  turnPlanningConfig?: AgentOSTurnPlanningConfig;
  /** Normalized config-level tool input for index source building. */
  configTools?: AdaptableToolInput;
  /** Logger scoped to this subsystem. */
  logger: ILogger;
}

/**
 * @class CapabilityDiscoveryInitializer
 *
 * Bootstraps the capability discovery engine and turn planner subsystem.
 * Extracted from `AgentOS` to reduce monolith complexity.
 */
export class CapabilityDiscoveryInitializer {
  private _turnPlanner?: ITurnPlanner;
  private _discoveryEngine?: ICapabilityDiscoveryEngine;
  private _embeddingManager?: EmbeddingManager;
  private _vectorStore?: InMemoryVectorStore;

  constructor(private readonly deps: CapabilityDiscoveryInitializerDependencies) {}

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  /**
   * The turn planner instance. Available after {@link initialize} completes.
   * May be `undefined` if turn planning is disabled.
   */
  public get turnPlanner(): ITurnPlanner | undefined {
    return this._turnPlanner;
  }

  /**
   * The capability discovery engine. Available after {@link initialize} completes.
   * May be `undefined` if discovery is disabled or initialization failed gracefully.
   */
  public get discoveryEngine(): ICapabilityDiscoveryEngine | undefined {
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
  public async initialize(): Promise<void> {
    const turnPlanningConfig = this.deps.turnPlanningConfig;
    if (turnPlanningConfig?.enabled === false) {
      this._turnPlanner = undefined;
      this._discoveryEngine = undefined;
      return;
    }

    let discoveryEngine: ICapabilityDiscoveryEngine | undefined =
      turnPlanningConfig?.discovery?.engine;

    if (!discoveryEngine && turnPlanningConfig?.discovery?.enabled !== false) {
      try {
        discoveryEngine = await this.initializeCapabilityDiscoveryEngine(
          turnPlanningConfig ?? {},
        );
      } catch (error: any) {
        this.deps.logger.warn(
          'Capability discovery initialization failed; planner will continue without discovery',
          {
            error: error?.message ?? error,
          },
        );
      }
    }

    this._turnPlanner = new AgentOSTurnPlanner(
      turnPlanningConfig,
      discoveryEngine,
      this.deps.logger.child?.({ component: 'TurnPlanner' }) ?? this.deps.logger,
    );
    this._discoveryEngine = discoveryEngine;
    this.deps.logger.info('AgentOS turn planner initialized', {
      discoveryEnabled: Boolean(discoveryEngine?.isInitialized?.()),
      defaultToolFailureMode: turnPlanningConfig?.defaultToolFailureMode ?? 'fail_open',
      defaultToolSelectionMode:
        turnPlanningConfig?.discovery?.defaultToolSelectionMode ?? 'discovered',
    });
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  /**
   * Clean up owned resources: vector store, embedding manager, and
   * null out planner/engine references.
   */
  public async shutdown(): Promise<void> {
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
  public buildCapabilityIndexSources(
    overrides?: AgentOSCapabilityDiscoverySources,
  ): CapabilityIndexSources {
    const titleCase = (value: string): string =>
      value
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const toolRegistry = this.deps.extensionManager.getRegistry<ITool>(EXTENSION_KIND_TOOL);
    const runtimeTools = new Map<string, ITool>();
    for (const tool of toolRegistry
      .listActive()
      .map((descriptor) => descriptor.payload)
      .filter(Boolean)) {
      runtimeTools.set(tool.name, tool);
    }
    for (const tool of adaptTools(this.deps.configTools)) {
      runtimeTools.set(tool.name, tool);
    }
    const tools: NonNullable<CapabilityIndexSources['tools']> = Array.from(
      runtimeTools.values(),
    ).map((tool) => ({
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
    const packExtensions: NonNullable<CapabilityIndexSources['extensions']> = loadedPacks.map(
      (pack) => ({
        id: `extension:${pack.key}`,
        name: pack.name,
        displayName: titleCase(pack.name),
        description: `Extension pack${pack.version ? ` v${pack.version}` : ''}`,
        category: 'extensions',
        available: true,
      }),
    );

    const workflowRegistry =
      this.deps.extensionManager.getRegistry<WorkflowDescriptorPayload>(EXTENSION_KIND_WORKFLOW);
    const workflowExtensions: NonNullable<CapabilityIndexSources['extensions']> = workflowRegistry
      .listActive()
      .map((descriptor) => ({
        id: `workflow:${descriptor.payload.definition.id}`,
        name: descriptor.payload.definition.id,
        displayName:
          descriptor.payload.definition.displayName ||
          titleCase(descriptor.payload.definition.id),
        description:
          descriptor.payload.definition.description || 'Workflow automation capability',
        category: 'workflow',
        requiredSecrets: descriptor.payload.definition.metadata?.requiredSecrets,
        available: true,
      }));

    const messagingRegistry = this.deps.extensionManager.getRegistry<MessagingChannelPayload>(
      EXTENSION_KIND_MESSAGING_CHANNEL,
    );
    const channels: NonNullable<CapabilityIndexSources['channels']> = messagingRegistry
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
  private async initializeCapabilityDiscoveryEngine(
    turnPlanningConfig: AgentOSTurnPlanningConfig,
  ): Promise<ICapabilityDiscoveryEngine | undefined> {
    const discoveryConfig = turnPlanningConfig.discovery;
    if (discoveryConfig?.enabled === false) {
      return undefined;
    }
    if (discoveryConfig?.autoInitializeEngine === false) {
      return undefined;
    }

    const defaultProvider =
      this.deps.modelProviderManager.getDefaultProvider() ??
      this.deps.modelProviderManager.getProvider(
        this.deps.modelProviderManagerConfig.providers.find((p) => p.enabled)?.providerId || '',
      );
    const providerId = defaultProvider?.providerId;
    if (!providerId) {
      this.deps.logger.warn('Capability discovery disabled: no model provider available');
      return undefined;
    }

    const embeddingDefaults = DISCOVERY_EMBEDDING_DEFAULTS[providerId];
    if (!embeddingDefaults) {
      this.deps.logger.warn(
        'Capability discovery disabled: no embedding defaults for provider',
        { providerId },
      );
      return undefined;
    }

    const embeddingModelId = discoveryConfig?.embeddingModelId ?? embeddingDefaults.modelId;
    const embeddingDimension = discoveryConfig?.embeddingDimension ?? embeddingDefaults.dimension;

    const embeddingManager = new EmbeddingManager();
    await embeddingManager.initialize(
      {
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
      },
      this.deps.modelProviderManager,
    );

    const vectorStore = new InMemoryVectorStore();
    await vectorStore.initialize({
      id: 'agentos-capability-discovery',
      type: 'in_memory',
    });

    const engine = new CapabilityDiscoveryEngine(
      embeddingManager,
      vectorStore,
      discoveryConfig?.config,
    );
    const sources = this.buildCapabilityIndexSources(discoveryConfig?.sources);
    await engine.initialize(sources, discoveryConfig?.sources?.presetCoOccurrences);

    if (discoveryConfig?.registerMetaTool !== false) {
      const existing = await this.deps.toolOrchestrator.getTool('discover_capabilities');
      if (!existing) {
        await this.deps.toolOrchestrator.registerTool(
          createDiscoverCapabilitiesTool(engine, this.deps.toolOrchestrator),
        );
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
