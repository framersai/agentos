/**
 * @fileoverview Defines configuration structures for the MemoryLifecycleManager.
 * This includes defining individual lifecycle policies, their triggers, actions,
 * and how they apply to different categories or data sources within the RAG system.
 *
 * These configurations guide the MemoryLifecycleManager in automatically managing
 * the retention, eviction, or archival of stored information, potentially involving
 * negotiation with GMI instances for critical data.
 *
 * @module backend/agentos/config/MemoryLifecycleManagerConfiguration
 * @see ../memory_lifecycle/IMemoryLifecycleManager.ts
 * @see ../rag/IRetrievalAugmentor.ts for RagMemoryCategory
 * @see ../rag/IVectorStore.ts for MetadataFilter
 */

import { RagMemoryCategory } from '../rag/IRetrievalAugmentor';
import { MetadataFilter } from '../rag/IVectorStore';
import { LifecycleAction } from '../cognitive_substrate/IGMI'; // For defaultActionOnTimeout

/**
 * Specifies the conditions under which a MemoryLifecyclePolicy is triggered.
 *
 * @interface PolicyTriggerCondition
 * @property {'periodic' | 'on_storage_threshold' | 'on_item_age'} type - The type of trigger.
 * - `periodic`: The policy check runs at regular intervals.
 * - `on_storage_threshold`: Triggered when a data source or category exceeds a size/item count. (Requires monitoring)
 * - `on_item_age`: Policy applies based on individual item age (implicitly handled by retentionDays).
 * @property {string} [checkInterval] - For `periodic` trigger, the interval (e.g., "1h", "30m", "7d").
 * This will be parsed into seconds or milliseconds by the manager.
 * @property {number} [itemCountThreshold] - For `on_storage_threshold`, max number of items.
 * @property {number} [sizeBytesThreshold] - For `on_storage_threshold`, max size in bytes.
 */
export interface PolicyTriggerCondition {
  type: 'periodic' | 'on_storage_threshold' | 'on_item_age';
  checkInterval?: string; // e.g., "PT24H" (ISO 8601 duration) or simple "24h"
  itemCountThreshold?: number;
  sizeBytesThreshold?: number;
}

/**
 * Defines the action to be taken when a policy's conditions are met.
 *
 * @interface PolicyAction
 * @property {'delete' | 'archive' | 'summarize_and_delete' | 'summarize_and_archive' | 'notify_gmi_owner'} type - The lifecycle action.
 * - `delete`: Permanently remove the item.
 * - `archive`: Move the item to a designated archive location/store.
 * - `summarize_and_delete`: Generate a summary (requires UtilityAI), store summary (optional), then delete original.
 * - `summarize_and_archive`: Generate summary, store summary, then archive original.
 * - `notify_gmi_owner`: Only notify the owning GMI about the item meeting criteria, letting GMI decide via other means.
 * @property {string} [archiveTargetId] - Identifier for the archive storage (e.g., a different vector store collection ID or a cold storage path).
 * @property {string} [summaryDataSourceId] - If summarizing, the data source ID where the summary should be stored.
 * @property {boolean} [deleteOriginalAfterSummary=true] - If summarizing, whether to delete the original item.
 */
export interface PolicyAction {
  type: 'delete' | 'archive' | 'summarize_and_delete' | 'summarize_and_archive' | 'notify_gmi_owner';
  archiveTargetId?: string;
  summaryDataSourceId?: string;
  deleteOriginalAfterSummary?: boolean;
  /**
   * Optional model override for summarisation flows. Falls back to
   * `MemoryLifecycleManagerConfig.defaultSummarizationModelId` when omitted.
   */
  llmModelForSummary?: string;
}

/**
 * Configuration for GMI negotiation during lifecycle events.
 *
 * @interface GMINegotiationConfig
 * @property {boolean} enabled - Whether GMI negotiation is enabled for items matching this policy.
 * If true, the owning GMI will be consulted before taking the lifecycle action.
 * @property {number} [timeoutMs=30000] - Timeout in milliseconds for waiting for a GMI's response
 * during negotiation.
 * @property {LifecycleAction} [defaultActionOnTimeout='ALLOW_ACTION'] - The action to take if the GMI negotiation times out
 * or if the GMI instance cannot be resolved or fails to respond.
 * @property {string[]} [criticalMetadataFields] - List of metadata fields that, if present and matching certain criteria
 * (not defined here, but could be used by GMI), might make an item critical.
 */
export interface GMINegotiationConfig {
  enabled: boolean;
  timeoutMs?: number;
  defaultActionOnTimeout?: LifecycleAction;
  criticalMetadataFields?: string[];
}

/**
 * Defines a single memory lifecycle policy.
 *
 * @interface MemoryLifecyclePolicy
 * @property {string} policyId - A unique identifier for this policy (e.g., "user-notes-retention-90d").
 * @property {string} [description] - A human-readable description of the policy's purpose.
 * @property {boolean} [isEnabled=true] - Whether this policy is currently active.
 * @property {object} appliesTo - Criteria defining which data items this policy applies to.
 * @property {RagMemoryCategory[]} [appliesTo.categories] - Logical RAG memory categories.
 * @property {string[]} [appliesTo.dataSourceIds] - Specific RAG Data Source IDs.
 * @property {MetadataFilter} [appliesTo.metadataFilter] - Filter based on document metadata.
 * Policy applies if an item matches ANY of the categories, dataSourceIds, OR the metadataFilter if specified.
 * If multiple are specified, it's typically an OR unless an explicit AND structure is introduced.
 * For simplicity, let's assume if multiple fields in `appliesTo` are set, an item must satisfy conditions from each set field (implicit AND).
 * E.g., category 'X' AND dataSourceId 'Y'. Or, this needs a more complex structure like an array of condition groups.
 * Let's refine: an item matches if it belongs to *any* of the specified categories (if categories are present)
 * AND belongs to *any* of the specified dataSourceIds (if dataSourceIds are present)
 * AND matches the metadataFilter (if metadataFilter is present).
 * If a field (categories, dataSourceIds, metadataFilter) is omitted, it's not considered for matching for that field.
 * @property {PolicyTriggerCondition} [trigger] - Conditions that trigger the policy check.
 * If not provided, `retentionDays` might be the primary trigger.
 * @property {PolicyAction} action - The action to take when the policy applies and conditions are met.
 * @property {number} [retentionDays] - If positive, items older than this many days are subject to the policy's action.
 * This is a primary condition for many policies. `0` or undefined might mean no age-based retention by this policy.
 * @property {'lru' | 'lfu' | 'oldest_first' | 'lowest_importance' | 'custom'} [evictionStrategy] - Strategy for selecting items
 * when a storage threshold is met. `custom` would require a pluggable component.
 * `lowest_importance` implies items have an `importance` score in their metadata.
 * @property {GMINegotiationConfig} [gmiNegotiation] - Configuration for how to negotiate with an owning GMI
 * before applying the action.
 * @property {number} [priority=0] - Execution priority of this policy (lower numbers run first if policies conflict or overlap).
 */
export interface MemoryLifecyclePolicy {
  policyId: string;
  description?: string;
  isEnabled?: boolean;
  appliesTo: {
    categories?: RagMemoryCategory[];
    dataSourceIds?: string[];
    metadataFilter?: MetadataFilter; // Matches if item satisfies all present filter parts
    gmiOwnerId?: string; // Apply only to items owned by a specific GMI
    personaOwnerId?: string; // Apply only to items associated with a specific persona
  };
  trigger?: PolicyTriggerCondition; // If not specified, retentionDays might be the sole trigger.
  action: PolicyAction;
  retentionDays?: number;
  evictionStrategy?: 'lru' | 'lfu' | 'oldest_first' | 'lowest_importance' | 'custom';
  gmiNegotiation?: GMINegotiationConfig;
  priority?: number;
}

/**
 * Top-level configuration for the MemoryLifecycleManager.
 *
 * @interface MemoryLifecycleManagerConfig
 * @property {string} managerId - A unique identifier for this manager instance.
 * @property {MemoryLifecyclePolicy[]} policies - An array of lifecycle policies to be enforced.
 * @property {string} [defaultCheckInterval="PT6H"] - Default interval (ISO 8601 duration format, e.g., "PT6H" for 6 hours)
 * for periodic policy checks if a policy itself doesn't define one.
 * @property {number} [defaultGMINegotiationTimeoutMs=30000] - Global default timeout for GMI negotiations.
 * @property {string} [defaultArchiveStoreId] - Default target ID for 'archive' actions if not specified in the policy.
 * This could be a specific RAG data source ID configured for archival.
 * @property {boolean} [dryRunMode=false] - If true, the manager will log actions it would take but not actually
 * execute them (e.g., no actual deletions or archival). Useful for testing policies.
 * @property {number} [maxConcurrentOperations=5] - Maximum number of concurrent lifecycle operations (e.g., item deletions).
 * @property {string} [gmiOwnerIdMetadataField="gmiOwnerId"] - The metadata field name in vector documents
 * that stores the ID of the owning GMI.
 * @property {string} [personaOwnerIdMetadataField="personaOwnerId"] - The metadata field name for the owning Persona.
 * @property {string} [itemTimestampMetadataField="creationTimestamp"] - The metadata field used to determine item age for retention.
 * Should store an ISO 8601 date string.
 */
export interface MemoryLifecycleManagerConfig {
  managerId: string;
  policies: MemoryLifecyclePolicy[];
  defaultCheckInterval?: string; // e.g., "PT6H"
  defaultGMINegotiationTimeoutMs?: number;
  defaultArchiveStoreId?: string;
  defaultSummarizationModelId?: string;
  dryRunMode?: boolean;
  maxConcurrentOperations?: number;
  gmiOwnerIdMetadataField?: string;
  personaOwnerIdMetadataField?: string;
  itemTimestampMetadataField?: string;
}

// Example Configuration:
/*
const exampleMLMConfig: MemoryLifecycleManagerConfig = {
  managerId: "mlm-main-01",
  defaultCheckInterval: "PT1H", // Check hourly by default
  defaultGMINegotiationTimeoutMs: 20000,
  dryRunMode: false,
  gmiOwnerIdMetadataField: "gmiInstanceId", // Field in RAG metadata
  itemTimestampMetadataField: "doc_creation_date", // Field in RAG metadata
  policies: [
    {
      policyId: "delete-old-episodic-logs",
      description: "Delete episodic context logs older than 7 days.",
      isEnabled: true,
      appliesTo: {
        categories: [RagMemoryCategory.EPISODIC_CONTEXT],
      },
      retentionDays: 7,
      action: { type: 'delete' },
      gmiNegotiation: { enabled: false }, // No negotiation for simple logs
      priority: 10,
    },
    {
      policyId: "archive-user-memory-over-1yr",
      description: "Archive user explicit memory older than 1 year, with GMI negotiation.",
      isEnabled: true,
      appliesTo: {
        categories: [RagMemoryCategory.USER_EXPLICIT_MEMORY],
      },
      retentionDays: 365,
      action: { type: 'archive', archiveTargetId: 'cold-storage-user-memory' },
      gmiNegotiation: { enabled: true, timeoutMs: 60000, defaultActionOnTimeout: 'ARCHIVE' },
      priority: 50,
    },
    {
        policyId: "summarize-gmi-experience",
        description: "Summarize and delete very old GMI personal experiences (older than 180 days).",
        isEnabled: true,
        appliesTo: {
            categories: [RagMemoryCategory.PERSONAL_LLM_EXPERIENCE],
        },
        retentionDays: 180,
        action: {
            type: 'summarize_and_delete',
            summaryDataSourceId: 'gmi_experience_summaries', // Store summary in a different RAG source
            deleteOriginalAfterSummary: true,
        },
        gmiNegotiation: { enabled: true, defaultActionOnTimeout: 'SUMMARIZE_AND_DELETE' },
        priority: 30,
    }
  ],
};
*/
