/**
 * @fileoverview Implements the MemoryLifecycleManager (MemoryLifecycleManager),
 * responsible for enforcing data retention and eviction policies on memories
 * stored within the AgentOS RAG system. It uses IUtilityAI for summarization tasks
 * and interacts with IVectorStoreManager to query and act on stored items.
 * GMI negotiation is a key feature for handling potentially critical memories.
 *
 * @module backend/agentos/memory/lifecycle/MemoryLifecycleManager
 * @see ./IMemoryLifecycleManager.ts for the interface definition.
 * @see ../core/config/MemoryLifecycleManagerConfiguration.ts for configuration.
 * @see ../nlp/ai_utilities/IUtilityAI.ts for summarization.
 * @see ../core/vector-store/IVectorStore.ts and ../rag/IVectorStoreManager.ts
 */
import { IMemoryLifecycleManager, GMIResolverFunction, PolicyEnforcementFilter, LifecycleEnforcementReport } from './IMemoryLifecycleManager';
import { MemoryLifecycleManagerConfig } from '../../../core/config/MemoryLifecycleManagerConfiguration';
import { IVectorStoreManager } from '../../../core/vector-store/IVectorStoreManager';
import { IUtilityAI } from '../../../nlp/ai_utilities/IUtilityAI';
import { RagMemoryCategory } from '../../../rag/IRetrievalAugmentor';
import { LifecycleAction } from '../../../cognitive_substrate/IGMI';
/**
 * @class MemoryLifecycleManager
 * @implements {IMemoryLifecycleManager}
 * Manages the lifecycle of stored memories by enforcing configured policies,
 * handling data retention, eviction, archival, and negotiating with GMIs.
 */
export declare class MemoryLifecycleManager implements IMemoryLifecycleManager {
    readonly managerId: string;
    private config;
    private vectorStoreManager;
    private gmiResolver;
    private utilityAI?;
    private isInitialized;
    private periodicCheckTimer?;
    /**
     * Constructs a MemoryLifecycleManager instance.
     * The manager is not operational until `initialize` is called.
     */
    constructor();
    /**
     * @inheritdoc
     */
    initialize(config: MemoryLifecycleManagerConfig, vectorStoreManager: IVectorStoreManager, gmiResolver: GMIResolverFunction, utilityAI?: IUtilityAI): Promise<void>;
    /**
     * Ensures the manager is initialized before performing operations.
     * @private
     */
    private ensureInitialized;
    /**
     * Sets up periodic policy enforcement based on configuration.
     * @private
     */
    private setupPeriodicChecks;
    /**
     * @inheritdoc
     */
    enforcePolicies(filter?: PolicyEnforcementFilter): Promise<LifecycleEnforcementReport>;
    /**
     * Finds candidate items for a given policy.
     * This is a complex method that needs to interact with IVectorStoreManager and IVectorStore.
     * @private
     */
    private findPolicyCandidates;
    private negotiateAndDetermineAction;
    private mapPolicyActionToEventType;
    private executeLifecycleAction;
    processSingleItemLifecycle(itemContext: {
        itemId: string;
        dataSourceId: string;
        gmiOwnerId?: string;
        personaOwnerId?: string;
        category?: RagMemoryCategory;
        metadata?: Record<string, any>;
        contentSummary?: string;
        textContent?: string;
    }, triggeringReason?: string): Promise<{
        actionTaken: LifecycleAction;
        details?: any;
    }>;
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: Record<string, unknown>;
        dependencies?: any[];
    }>;
    shutdown(): Promise<void>;
    /**
     * Helper to add entries to the enforcement report's error/trace log.
     * This is an internal helper.
     * @param report The report to add to.
     * @param itemId ID of the item being processed.
     * @param policyId ID of the policy being applied.
     * @param action Action taken or intended.
     * @param message Descriptive message.
     * @param details Additional details.
     * @private
     */
    private addTraceToReport;
}
//# sourceMappingURL=MemoryLifecycleManager.d.ts.map