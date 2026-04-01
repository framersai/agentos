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
 * @see ../memory/lifecycle/IMemoryLifecycleManager.ts
 * @see ../rag/IRetrievalAugmentor.ts for RagMemoryCategory
 * @see ../core/vector-store/IVectorStore.ts for MetadataFilter
 */
export {};
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
//# sourceMappingURL=MemoryLifecycleManagerConfiguration.js.map