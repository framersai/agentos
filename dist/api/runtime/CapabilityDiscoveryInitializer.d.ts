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
import type { ILogger } from '../../logging/ILogger';
import type { IToolOrchestrator } from '../../core/tools/IToolOrchestrator';
import type { AIModelProviderManager } from '../../core/llm/providers/AIModelProviderManager';
import { type ExtensionManager } from '../extensions';
import { type ITurnPlanner } from '../../orchestration/turn-planner/TurnPlanner';
import type { CapabilityIndexSources, ICapabilityDiscoveryEngine } from '../../discovery/types';
import type { AgentOSTurnPlanningConfig, AgentOSCapabilityDiscoverySources } from './AgentOS';
import type { AdaptableToolInput } from './toolAdapter';
import type { AIModelProviderManagerConfig } from '../../core/llm/providers/AIModelProviderManager';
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
export declare class CapabilityDiscoveryInitializer {
    private readonly deps;
    private _turnPlanner?;
    private _discoveryEngine?;
    private _embeddingManager?;
    private _vectorStore?;
    constructor(deps: CapabilityDiscoveryInitializerDependencies);
    /**
     * The turn planner instance. Available after {@link initialize} completes.
     * May be `undefined` if turn planning is disabled.
     */
    get turnPlanner(): ITurnPlanner | undefined;
    /**
     * The capability discovery engine. Available after {@link initialize} completes.
     * May be `undefined` if discovery is disabled or initialization failed gracefully.
     */
    get discoveryEngine(): ICapabilityDiscoveryEngine | undefined;
    /**
     * Run the full bootstrapping sequence:
     * 1. Optionally create the capability discovery engine.
     * 2. Create the turn planner with the discovery engine (if available).
     * 3. Register the `discover_capabilities` meta-tool when configured.
     */
    initialize(): Promise<void>;
    /**
     * Clean up owned resources: vector store, embedding manager, and
     * null out planner/engine references.
     */
    shutdown(): Promise<void>;
    /**
     * Build capability index sources from the active runtime registries.
     *
     * @param overrides - Optional explicit sources to merge with runtime-derived data.
     * @returns Aggregated sources suitable for `CapabilityDiscoveryEngine.initialize()`.
     */
    buildCapabilityIndexSources(overrides?: AgentOSCapabilityDiscoverySources): CapabilityIndexSources;
    /**
     * Initialize the capability discovery engine: embedding manager, vector
     * store, discovery engine, and optionally register the meta-tool.
     */
    private initializeCapabilityDiscoveryEngine;
}
//# sourceMappingURL=CapabilityDiscoveryInitializer.d.ts.map