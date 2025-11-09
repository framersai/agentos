/**
 * @fileoverview Defines configuration structures for vector store providers
 * and the overall VectorStoreManager. This allows for flexible setup of
 * different vector database backends (e.g., Pinecone, Weaviate, local, in-memory options)
 * and logical RAG collections that map to these physical stores.
 *
 * @module backend/agentos/config/VectorStoreConfiguration
 * @see ../rag/IVectorStore.ts for `VectorStoreProviderConfig` and related types.
 * @see ../rag/IVectorStoreManager.ts for the manager interface using this config.
 */

// This import is crucial. VectorStoreProviderConfig is the base for all specific provider configs.
// It will be defined in `../rag/IVectorStore.ts`.
import { VectorStoreProviderConfig } from '../rag/IVectorStore';

/**
 * Specific configuration for an InMemoryVectorStore.
 * Suitable for development, testing, or scenarios where data persistence is not required
 * or is handled externally.
 *
 * @interface InMemoryVectorStoreConfig
 * @extends VectorStoreProviderConfig
 * @property {'in_memory'} type - Identifier for the in-memory provider type.
 * @property {string} [persistPath] - Optional file path for persisting the in-memory store's state
 * on shutdown and reloading on startup. If not provided, data is purely ephemeral.
 * @property {'cosine' | 'euclidean' | 'dotproduct'} [similarityMetric='cosine'] - The similarity metric to use
 * for vector comparisons if the implementation supports it directly.
 * @property {number} [defaultEmbeddingDimension] - The embedding dimension this store expects.
 * Crucial if not globally defined or if the store needs explicit dimensioning.
 */
export interface InMemoryVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'in_memory';
  persistPath?: string;
  similarityMetric?: 'cosine' | 'euclidean' | 'dotproduct';
  defaultEmbeddingDimension?: number;
}

/**
 * Specific configuration for a local, file-based, or embedded VectorStore.
 * This can represent stores like SQLite with vector extensions (e.g., VSS), LanceDB,
 * or local instances of ChromaDB.
 *
 * @interface LocalFileVectorStoreConfig
 * @extends VectorStoreProviderConfig
 * @property {'local_file_vss' | 'lancedb' | 'chromadb_local'} type - Specific local provider type.
 * @property {string} databasePath - Path to the database file or directory.
 * @property {number} [defaultEmbeddingDimension] - The embedding dimension this store expects.
 * @property {Record<string, any>} [connectionParams] - Additional parameters specific to the chosen
 * local database (e.g., table names, read/write modes).
 */
export interface LocalFileVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'local_file_vss' | 'lancedb' | 'chromadb_local'; // Example local provider types
  databasePath: string;
  defaultEmbeddingDimension?: number;
  connectionParams?: Record<string, any>;
}

/**
 * Specific configuration for a Pinecone vector store.
 *
 * @interface PineconeVectorStoreConfig
 * @extends VectorStoreProviderConfig
 * @property {'pinecone'} type - Identifier for the Pinecone provider type.
 * @property {string} apiKey - Pinecone API key. Ensure this is securely managed (e.g., via environment variables).
 * @property {string} environment - Pinecone environment (e.g., 'gcp-starter', 'us-east-1-aws').
 * @property {number} [defaultEmbeddingDimension] - Default embedding dimension for collections created
 * or managed by this provider instance if not specified per collection.
 * @property {'cosine' | 'euclidean' | 'dotproduct'} [similarityMetric='cosine'] - Default similarity metric for new Pinecone indexes
 * created through this configuration, if applicable.
 */
export interface PineconeVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'pinecone';
  apiKey: string; // Should be sourced from environment variables
  environment: string;
  defaultEmbeddingDimension?: number;
  similarityMetric?: 'cosine' | 'euclidean' | 'dotproduct';
}

/**
 * Specific configuration for a Weaviate vector store.
 *
 * @interface WeaviateVectorStoreConfig
 * @extends VectorStoreProviderConfig
 * @property {'weaviate'} type - Identifier for the Weaviate provider type.
 * @property {string} scheme - Connection scheme, typically 'http' or 'https'.
 * @property {string} host - Weaviate instance host and port (e.g., 'localhost:8080' or a cloud endpoint like 'your-cluster.weaviate.network').
 * @property {string} [apiKey] - Optional API key, e.g., for Weaviate Cloud Services (WCS) or API key-secured instances.
 * @property {number} [defaultEmbeddingDimension] - Default embedding dimension for collections (classes)
 * created or managed by this provider instance.
 * @property {Record<string, string>} [headers] - Optional additional HTTP headers for the connection (e.g., for custom authentication).
 * @property {string} [grpcHost] - Optional gRPC host and port for performance-sensitive operations, if supported and configured.
 */
export interface WeaviateVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'weaviate';
  scheme: 'http' | 'https';
  host: string;
  apiKey?: string; // For WCS or auth-enabled instances
  defaultEmbeddingDimension?: number;
  headers?: Record<string, string>;
  grpcHost?: string;
}

/**
 * A union type representing configuration for any supported vector store provider.
 * When adding support for a new vector store, define its specific configuration interface
 * (extending `VectorStoreProviderConfig`) and include it in this union.
 */
export type AnyVectorStoreProviderConfig =
  | InMemoryVectorStoreConfig
  | LocalFileVectorStoreConfig
  | PineconeVectorStoreConfig
  | WeaviateVectorStoreConfig
  // Example: | QdrantVectorStoreConfig
  // Example: | MilvusVectorStoreConfig
  | VectorStoreProviderConfig; // Fallback for generic or user-defined providers not yet typed explicitly.

/**
 * Configuration for the VectorStoreManager.
 * The manager is responsible for initializing and providing access to various
 * vector store instances based on these configurations.
 *
 * @interface VectorStoreManagerConfig
 * @property {string} managerId - A unique identifier for this manager instance, useful if multiple managers exist.
 * @property {AnyVectorStoreProviderConfig[]} providers - An array of configurations for each vector store provider
 * instance to be initialized and managed.
 * @property {string} [defaultProviderId] - The `id` (from `VectorStoreProviderConfig.id`) of the vector store provider
 * to use by default if an operation does not specify one. If not set, the first provider in the
 * `providers` list might be used, or an error might be thrown if a default is required.
 * @property {number} [defaultEmbeddingDimension] - A system-wide default embedding dimension. This can be
 * used by providers or collections if they don't have a specific dimension defined, ensuring
 * consistency with embedding models.
 */
export interface VectorStoreManagerConfig {
  managerId: string;
  providers: AnyVectorStoreProviderConfig[];
  defaultProviderId?: string;
  defaultEmbeddingDimension?: number;
}

/**
 * Configuration for a logical RAG Data Source (often called a "collection" or "index").
 * This structure defines how a logical unit of data within the RAG system maps to a
 * physical collection in a specific vector store provider and its associated behaviors.
 *
 * @interface RagDataSourceConfig
 * @property {string} dataSourceId - A unique identifier for this RAG data source (e.g., "global_wiki", "gmi_xyz_personal_notes").
 * This ID is used by `RetrievalAugmentor`'s `RagCategoryBehavior` to map logical categories to these sources.
 * @property {string} displayName - A user-friendly name for the data source.
 * @property {string} [description] - An optional description of the data source's purpose or content.
 * @property {string} vectorStoreProviderId - The `id` of the `VectorStoreProviderConfig` (from `VectorStoreManagerConfig.providers`)
 * that this data source will use for storage and retrieval.
 * @property {string} actualNameInProvider - The actual name of the index, class, or collection in the underlying
 * vector database (e.g., "agentos-main-kb" in Pinecone, "KnowledgeItem" class in Weaviate). This is provider-specific.
 * @property {number} [embeddingDimension] - The embedding dimension expected for documents stored in this data source.
 * This should match the embedding models used to populate it. Overrides provider/manager defaults.
 * @property {boolean} [isDefaultQuerySource=false] - If true, this data source might be queried by default if no specific
 * source is targeted in a retrieval request.
 * @property {boolean} [isDefaultIngestionSource=false] - If true, new data might be ingested into this source by default.
 * @property {string[]} [relevantPersonaIds] - Optional list of persona IDs that primarily use or are relevant to this data source.
 * Can be used for access control or context-aware routing.
 * @property {string[]} [authorizedUserRoles] - Optional list of user roles authorized to access or contribute to this
 * data source (e.g., ['admin', 'editor', 'user_tier_premium']).
 * @property {Record<string, any>} [providerSpecificSettings] - Any additional settings specific to the
 * underlying vector store provider for this particular data source (e.g., custom indexing parameters for Pinecone,
 * schema details for Weaviate).
 * @property {object} [metadataSchema] - Optional: A simple schema defining expected metadata fields and their types
 * for documents within this data source, aiding in validation and consistent querying.
 * Example: `{ "author": "string", "creationDate": "date", "version": "number" }`
 */
export interface RagDataSourceConfig {
  dataSourceId: string;
  displayName: string;
  description?: string;
  vectorStoreProviderId: string;
  actualNameInProvider: string;
  embeddingDimension?: number;
  isDefaultQuerySource?: boolean;
  isDefaultIngestionSource?: boolean;
  relevantPersonaIds?: string[];
  authorizedUserRoles?: string[];
  providerSpecificSettings?: Record<string, any>;
  metadataSchema?: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]'>;
}

/**
 * Overall configuration for the entire RAG system's data persistence and retrieval layer.
 * This top-level configuration object would typically be part of a larger application configuration.
 *
 * @interface RagDataLayerConfig
 * @property {VectorStoreManagerConfig} vectorStoreManager - Configuration for the `VectorStoreManager`,
 * which includes all physical vector store provider setups.
 * @property {RagDataSourceConfig[]} dataSources - An array defining all logical RAG data sources (collections)
 * available in the system, mapping them to the configured vector store providers.
 * @property {string} [defaultEmbeddingModelIdForSystem] - An optional global default embedding model ID for the RAG data layer.
 * This can inform choices if `EmbeddingManager` needs a hint or if data sources don't specify.
 * @property {number} [defaultEmbeddingDimensionForSystem] - An optional global default embedding dimension,
 * further ensuring consistency if not specified at lower levels.
 */
export interface RagDataLayerConfig {
  vectorStoreManager: VectorStoreManagerConfig;
  dataSources: RagDataSourceConfig[];
  defaultEmbeddingModelIdForSystem?: string;
  defaultEmbeddingDimensionForSystem?: number;
}

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