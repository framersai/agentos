/**
 * @fileoverview Defines configuration structures for vector store providers
 * and the overall VectorStoreManager. This allows for flexible setup of
 * different vector database backends (e.g., Pinecone, Weaviate, local, in-memory options)
 * and logical RAG collections that map to these physical stores.
 *
 * @module backend/agentos/config/VectorStoreConfiguration
 * @see ../core/vector-store/IVectorStore.ts for `VectorStoreProviderConfig` and related types.
 * @see ../core/vector-store/IVectorStoreManager.ts for the manager interface using this config.
 */
export {};
// Example of how this configuration might be structured in a main system config file:
/*
const systemRagDataLayerConfig: RagDataLayerConfig = {
  vectorStoreManager: {
    managerId: 'main-vsm',
    defaultProviderId: 'pinecone_main_prod',
    defaultEmbeddingDimension: 1536, // System-wide default if not specified lower
    providers: [
      {
        id: 'pinecone_main_prod', // Matches VectorStoreProviderConfig.id
        type: 'pinecone',
        apiKey: process.env.PINECONE_API_KEY!,
        environment: process.env.PINECONE_ENVIRONMENT!,
        defaultEmbeddingDimension: 1536, // Provider-level default
      } as PineconeVectorStoreConfig,
      {
        id: 'in_memory_dev_store',
        type: 'in_memory',
        defaultEmbeddingDimension: 384, // For a smaller local/dev model
      } as InMemoryVectorStoreConfig,
    ],
  },
  dataSources: [
    {
      dataSourceId: 'global_company_wiki',
      displayName: 'Global Company Wiki',
      description: 'Shared knowledge base for all company agents and employees.',
      vectorStoreProviderId: 'pinecone_main_prod',
      actualNameInProvider: 'company-wiki-prod-v2', // e.g., Pinecone index name
      embeddingDimension: 1536, // Specific to this data source's content
      isDefaultQuerySource: true,
      metadataSchema: { "department": "string", "lastReviewed": "date" }
    },
    {
      dataSourceId: 'user_personal_notes_main',
      displayName: 'User Personal Notes (Encrypted)',
      description: 'Personal notes and memories for individual users. Data segregated by user ID in metadata filters.',
      vectorStoreProviderId: 'pinecone_main_prod',
      actualNameInProvider: 'user-notes-prod-encrypted',
      embeddingDimension: 1536,
      // This collection would typically be queried with a strong `userId` metadata filter.
    }
  ],
  defaultEmbeddingModelIdForSystem: "text-embedding-3-large", // Hint for new unconfigured parts of system
  defaultEmbeddingDimensionForSystem: 1536,
};
*/
//# sourceMappingURL=VectorStoreConfiguration.js.map