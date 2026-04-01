/**
 * @fileoverview Defines configuration structures for the RetrievalAugmentor.
 * This includes how different RAG memory categories are handled, default
 * behaviors for ingestion and retrieval, and other operational parameters for
 * the core RAG orchestration service.
 *
 * The configurations here rely on data contract types (like options and results
 * for retrieval/ingestion) defined in `../rag/IRetrievalAugmentor.ts`.
 *
 * @module backend/agentos/config/RetrievalAugmentorConfiguration
 * @see ../rag/IRetrievalAugmentor.ts for operational data contracts.
 * @see ../rag/RetrievalAugmentor.ts for the concrete implementation using this config.
 */
export {};
// Example of how categoryBehaviors might be configured:
/*
const exampleRetrievalAugmentorServiceConfig: RetrievalAugmentorServiceConfig = {
  categoryBehaviors: [
    {
      category: RagMemoryCategory.SHARED_KNOWLEDGE_BASE,
      targetDataSourceIds: ['global_wiki_main', 'global_faq_secondary'],
      defaultRetrievalOptions: { topK: 5, strategyParams: { mmrLambda: 0.7 } },
      defaultIngestionOptions: { chunkingStrategy: { type: 'recursive_character', chunkSize: 1000, chunkOverlap: 100 } },
      queryPriority: 10,
    },
    {
      category: RagMemoryCategory.USER_EXPLICIT_MEMORY,
      targetDataSourceIds: ['user_private_notes_vector_store'],
      isUserSpecific: true,
      defaultRetrievalOptions: { topK: 3 },
      queryPriority: 100, // High priority for personal user memory
      retentionDays: 365, // User notes kept for a year by default
    },
    {
      category: RagMemoryCategory.PERSONAL_LLM_EXPERIENCE,
      targetDataSourceIds: ['gmi_self_learnings_collection'],
      isPersonaSpecific: true, // Or combination of user & persona
      defaultRetrievalOptions: { topK: 2, strategyParams: { mmrLambda: 0.5 } },
      queryPriority: 50,
    }
  ],
  globalDefaultRetrievalOptions: { topK: 3, strategy: 'similarity' },
  maxCharsForAugmentedPrompt: 3000,
  contextJoinSeparator: "\n\n[SOURCE]\n",
};
*/
//# sourceMappingURL=RetrievalAugmentorConfiguration.js.map