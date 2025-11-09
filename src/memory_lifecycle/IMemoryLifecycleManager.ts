/**
 * @fileoverview Defines the interface for the MemoryLifecycleManager (IMemoryLifecycleManager).
 * This manager is responsible for enforcing data retention and eviction policies
 * across various memory stores, particularly those managed by the RAG system.
 * It can interact with GMI instances to negotiate decisions about critical memories.
 *
 * @module backend/agentos/memory_lifecycle/IMemoryLifecycleManager
 * @see ../config/MemoryLifecycleManagerConfiguration.ts for configuration.
 * @see ../cognitive_substrate/IGMI.ts for GMI interaction types.
 * @see ../rag/IVectorStoreManager.ts for interaction with storage.
 */

import { MemoryLifecycleManagerConfig } from '../config/MemoryLifecycleManagerConfiguration';
import { IGMI, MemoryLifecycleEvent, LifecycleActionResponse, LifecycleAction } from '../cognitive_substrate/IGMI';
import { IVectorStoreManager } from '../rag/IVectorStoreManager';
import { IUtilityAI } from '../core/ai_utilities/IUtilityAI';
import { RagMemoryCategory } from '../rag/IRetrievalAugmentor';

/**
 * Function signature for resolving a GMI instance by its ID.
 * The MemoryLifecycleManager uses this to fetch a GMI instance for negotiation.
 *
 * @async
 * @param {string} gmiId - The ID of the GMI instance to resolve.
 * @param {string} [personaId] - Optional: The persona ID associated with the GMI, if relevant for resolving.
 * @returns {Promise<IGMI | undefined>} The GMI instance, or undefined if not found or not active.
 */
export type GMIResolverFunction = (gmiId: string, personaId?: string) => Promise<IGMI | undefined>;

/**
 * Options to filter which policies or data items are processed during enforcement.
 *
 * @interface PolicyEnforcementFilter
 * @property {string[]} [policyIds] - Specific policy IDs to enforce. If empty, all enabled policies are considered.
 * @property {string[]} [dataSourceIds] - Specific RAG Data Source IDs to target.
 * @property {RagMemoryCategory[]} [categories] - Specific RAG memory categories to target.
 * @property {string} [gmiOwnerId] - Only process items owned by this GMI.
 * @property {string} [personaOwnerId] - Only process items associated with this Persona.
 */
export interface PolicyEnforcementFilter {
  policyIds?: string[];
  dataSourceIds?: string[];
  categories?: RagMemoryCategory[];
  gmiOwnerId?: string;
  personaOwnerId?: string;
}

/**
 * Report detailing the results of a policy enforcement run.
 *
 * @interface LifecycleEnforcementReport
 * @property {Date} startTime - When the enforcement process started.
 * @property {Date} endTime - When the enforcement process completed.
 * @property {number} policiesEvaluated - Number of policies considered.
 * @property {number} itemsScanned - Total number of items scanned across data sources.
 * @property {number} itemsAffected - Number of items upon which an action was taken (or would have been in dry run).
 * @property {Record<string, { itemsProcessed: number; actionsTaken: Record<string, number> }>} [policyResults] -
 * Results per policy ID, detailing items processed and counts of actions taken (e.g., {'delete': 10, 'archive': 5}).
 * @property {Array<{ itemId: string; policyId: string; action: string; error?: string }>} [errors] - Any errors encountered.
 * @property {boolean} [wasDryRun] - Indicates if the enforcement was a dry run.
 */
export interface LifecycleEnforcementReport {
  startTime: Date;
  endTime: Date;
  policiesEvaluated: number;
  itemsScanned: number;
  itemsAffected: number;
  policyResults?: Record<string, { itemsProcessed: number; actionsTaken: Record<string, number> }>;
  errors?: Array<{ itemId?: string; policyId?: string; action?: string; message: string; details?: any }>;
  wasDryRun?: boolean;
}

/**
 * @interface IMemoryLifecycleManager
 * @description Defines the contract for managing the lifecycle of stored memories.
 * This includes applying retention policies, handling eviction, and negotiating
 * with GMIs about the fate of specific memory items.
 */
export interface IMemoryLifecycleManager {
  /**
   * A unique identifier for this MemoryLifecycleManager instance.
   * @readonly
   */
  readonly managerId: string;

  /**
   * Initializes the MemoryLifecycleManager with its configuration and necessary dependencies.
   * This method must be called before any other operations.
   *
   * @async
   * @param {MemoryLifecycleManagerConfig} config - The configuration for this manager, including all policies.
   * @param {IVectorStoreManager} vectorStoreManager - An instance of IVectorStoreManager to interact with data stores.
   * @param {GMIResolverFunction} gmiResolver - A function to resolve GMI instances for negotiation.
   * @param {IUtilityAI} [utilityAI] - Optional: An instance of IUtilityAI, needed if any policies involve
   * summarization actions.
   * @returns {Promise<void>} A promise that resolves upon successful initialization.
   * @throws {GMIError | Error} If initialization fails (e.g., invalid config, missing critical dependencies).
   */
  initialize(
    config: MemoryLifecycleManagerConfig,
    vectorStoreManager: IVectorStoreManager,
    gmiResolver: GMIResolverFunction,
    utilityAI?: IUtilityAI,
  ): Promise<void>;

  /**
   * Triggers the evaluation and enforcement of all applicable (and enabled) memory lifecycle policies.
   * This can be called manually or be part of a scheduled internal loop.
   *
   * @async
   * @param {PolicyEnforcementFilter} [filter] - Optional filters to narrow down which policies or data to process.
   * If not provided, all enabled policies are evaluated against all relevant data.
   * @returns {Promise<LifecycleEnforcementReport>} A report summarizing the actions taken (or that would be taken if dryRun).
   * @throws {GMIError | Error} If a critical error occurs during the enforcement process.
   */
  enforcePolicies(filter?: PolicyEnforcementFilter): Promise<LifecycleEnforcementReport>;

  /**
   * Manually triggers a lifecycle check and potential GMI negotiation for a specific item.
   * This might be used by other systems that detect a potentially obsolete item.
   *
   * @async
   * @param {object} itemContext - Information about the item to process.
   * @param {string} itemContext.itemId - The ID of the item.
   * @param {string} itemContext.dataSourceId - The data source where the item resides.
   * @param {string} [itemContext.gmiOwnerId] - The ID of the GMI that owns or is primarily associated with this item.
   * @param {string} [itemContext.personaOwnerId] - The ID of the Persona that owns or is primarily associated with this item.
   * @param {RagMemoryCategory} [itemContext.category] - The category of the item.
   * @param {Record<string, any>} [itemContext.metadata] - The item's metadata.
   * @param {string} [itemContext.contentSummary] - A summary of the item's content for GMI negotiation.
   * @param {string} [triggeringReason] - Why this specific item check was triggered.
   * @returns {Promise<{ actionTaken: LifecycleAction; details?: any }>} The outcome of processing the item.
   * @throws {GMIError | Error} If processing the specific item fails.
   */
  processSingleItemLifecycle(itemContext: {
    itemId: string;
    dataSourceId: string;
    gmiOwnerId?: string;
    personaOwnerId?: string;
    category?: RagMemoryCategory;
    metadata?: Record<string, any>;
    contentSummary?: string; // Could be generated by UtilityAI if not provided
  }, triggeringReason?: string): Promise<{ actionTaken: LifecycleAction; details?: any }>;


  /**
   * Checks the health and operational status of the MemoryLifecycleManager.
   *
   * @async
   * @returns {Promise<{ isHealthy: boolean; details?: Record<string, unknown> }>} Health status.
   */
  checkHealth(): Promise<{ isHealthy: boolean; details?: Record<string, unknown> }>;

  /**
   * Gracefully shuts down the MemoryLifecycleManager.
   * This should stop any ongoing background tasks (like periodic policy checks)
   * and release any resources.
   *
   * @async
   * @returns {Promise<void>} A promise that resolves when shutdown is complete.
   */
  shutdown(): Promise<void>;
}
