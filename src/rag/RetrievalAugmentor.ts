/**
 * @fileoverview Implements the RetrievalAugmentor, the core orchestrator for the
 * AgentOS Retrieval Augmented Generation (RAG) system. It adheres to the
 * `IRetrievalAugmentor` interface.
 *
 * This class is responsible for:
 * - Ingesting documents: Involves chunking, embedding generation via `IEmbeddingManager`,
 * and storage into vector databases via `IVectorStoreManager`.
 * - Retrieving context: Embeds queries, searches relevant vector stores for similar
 * chunks, optionally re-ranks, and formats the results into a context string suitable
 * for augmenting LLM prompts.
 * - Managing document lifecycle (delete, update).
 * - Providing health checks and graceful shutdown.
 *
 * @module backend/agentos/rag/RetrievalAugmentor
 * @see ./IRetrievalAugmentor.ts for the interface definition.
 * @see ../config/RetrievalAugmentorConfiguration.ts for `RetrievalAugmentorServiceConfig`.
 * @see ./IEmbeddingManager.ts
 * @see ./IVectorStoreManager.ts
 */

import { v4 as uuidv4 } from 'uuid';
import {
  IRetrievalAugmentor,
  RagDocumentInput,
  RagIngestionOptions,
  RagIngestionResult,
  RagRetrievalOptions,
  RagRetrievalResult,
  RagRetrievedChunk,
  RagMemoryCategory,
} from './IRetrievalAugmentor';
import { RetrievalAugmentorServiceConfig, RagCategoryBehavior } from '../config/RetrievalAugmentorConfiguration';
import { IEmbeddingManager, EmbeddingRequest } from './IEmbeddingManager';
import { IVectorStoreManager } from './IVectorStoreManager';
import { VectorDocument, QueryOptions as VectorStoreQueryOptions, MetadataFilter, MetadataValue } from './IVectorStore';
import { GMIError, GMIErrorCode } from '@agentos/core/utils/errors';

const DEFAULT_CONTEXT_JOIN_SEPARATOR = "\n\n---\n\n";
const DEFAULT_MAX_CHARS_FOR_AUGMENTED_PROMPT = 4000;
const DEFAULT_CHUNK_SIZE = 512; // Default characters for basic chunking
const DEFAULT_CHUNK_OVERLAP = 64;  // Default character overlap for basic chunking
const DEFAULT_TOP_K = 5;

/**
 * @class RetrievalAugmentor
 * @implements {IRetrievalAugmentor}
 * Orchestrates the RAG pipeline including ingestion, retrieval, and document management.
 */
export class RetrievalAugmentor implements IRetrievalAugmentor {
  public readonly augmenterId: string;
  private config!: RetrievalAugmentorServiceConfig;
  private embeddingManager!: IEmbeddingManager;
  private vectorStoreManager!: IVectorStoreManager;
  private isInitialized: boolean = false;

  /**
   * Constructs a RetrievalAugmentor instance.
   * It is not operational until `initialize` is successfully called.
   */
  constructor() {
    this.augmenterId = `rag-augmentor-${uuidv4()}`;
  }

  /**
   * @inheritdoc
   */
  public async initialize(
    config: RetrievalAugmentorServiceConfig,
    embeddingManager: IEmbeddingManager,
    vectorStoreManager: IVectorStoreManager,
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}) already initialized. Re-initializing.`);
      // Consider if dependencies need to be reset or if this is an error.
    }

    if (!config) {
      throw new GMIError('RetrievalAugmentorServiceConfig cannot be null or undefined.', GMIErrorCode.CONFIG_ERROR, { augmenterId: this.augmenterId });
    }
    if (!embeddingManager) {
      throw new GMIError('IEmbeddingManager dependency cannot be null or undefined.', GMIErrorCode.DEPENDENCY_ERROR, { augmenterId: this.augmenterId, dependency: 'IEmbeddingManager' });
    }
    if (!vectorStoreManager) {
      throw new GMIError('IVectorStoreManager dependency cannot be null or undefined.', GMIErrorCode.DEPENDENCY_ERROR, { augmenterId: this.augmenterId, dependency: 'IVectorStoreManager' });
    }

    this.config = config;
    this.embeddingManager = embeddingManager;
    this.vectorStoreManager = vectorStoreManager;

    // Validate category behaviors - ensure targetDataSourceIds exist if specified in mapping
    for (const behavior of this.config.categoryBehaviors) {
        for (const dsId of behavior.targetDataSourceIds) {
            try {
                // This is a conceptual check; actual store existence is up to VSM init.
                // Here, we just check if VSM knows about this dataSourceId mapping.
                if(!this.vectorStoreManager.listDataSourceIds().includes(dsId)){
                     console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): Category behavior for '${behavior.category}' references dataSourceId '${dsId}' which is not declared in VectorStoreManager's dataSourceConfigs. Retrieval for this category might fail for this source.`);
                }
            } catch (e) {
                // If listDataSourceIds itself fails, VSM might not be initialized.
                // This assumes VSM is initialized before or alongside RA.
                 console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Error while validating dataSourceId '${dsId}' for category '${behavior.category}'. VectorStoreManager might not be ready.`, e);
            }
        }
    }


    this.isInitialized = true;
    console.log(`RetrievalAugmentor (ID: ${this.augmenterId}) initialized successfully.`);
  }

  /**
   * Ensures that the augmenter has been initialized.
   * @private
   * @throws {GMIError} If not initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        `RetrievalAugmentor (ID: ${this.augmenterId}) is not initialized. Call initialize() first.`,
        GMIErrorCode.NOT_INITIALIZED,
      );
    }
  }

  /**
   * @inheritdoc
   */
  public async ingestDocuments(
    documents: RagDocumentInput | RagDocumentInput[],
    options?: RagIngestionOptions,
  ): Promise<RagIngestionResult> {
    this.ensureInitialized();
    const docsArray = Array.isArray(documents) ? documents : [documents];
    if (docsArray.length === 0) {
      return { processedCount: 0, failedCount: 0, ingestedIds: [], errors: [] };
    }

    // For now, synchronous processing. Async requires a job queue.
    if (options?.processAsync) {
      console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): Asynchronous processing requested but not yet fully implemented. Processing synchronously.`);
    }

    const ingestedDocIds = new Set<string>();
    const effectiveDataSourceIds = new Set<string>();
    const results: RagIngestionResult = {
      processedCount: docsArray.length,
      failedCount: 0,
      ingestedIds: [],
      errors: [],
    };

    const batchSize = options?.batchSize || 32; // Define a reasonable default

    for (let i = 0; i < docsArray.length; i += batchSize) {
      const docBatch = docsArray.slice(i, i + batchSize);
      try {
        await this.processDocumentBatch(docBatch, options, results, ingestedDocIds, effectiveDataSourceIds);
      } catch (batchError: any) {
        console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Critical error processing document batch starting at index ${i}. Batch skipped. Error: ${batchError.message}`, batchError);
        docBatch.forEach(doc => {
          results.errors?.push({
            documentId: doc.id,
            message: `Batch processing failed: ${batchError.message}`,
            details: batchError instanceof GMIError ? batchError.details : batchError.toString(),
          });
          results.failedCount++;
        });
      }
    }

    results.ingestedIds = Array.from(ingestedDocIds);
    results.effectiveDataSourceIds = Array.from(effectiveDataSourceIds);
    return results;
  }

  /**
   * Processes a batch of documents for ingestion.
   * @private
   */
  private async processDocumentBatch(
    docBatch: RagDocumentInput[],
    options: RagIngestionOptions | undefined,
    overallResults: RagIngestionResult,
    ingestedDocIds: Set<string>,
    effectiveDataSourceIds: Set<string>,
  ): Promise<void> {
    const vectorDocumentsToUpsert: VectorDocument[] = [];
    const docIdToChunkCount: Record<string, number> = {};

    for (const doc of docBatch) {
      docIdToChunkCount[doc.id] = 0;
      try {
        const targetDataSourceId = options?.targetDataSourceId || doc.dataSourceId || this.config.defaultDataSourceId;
        if (!targetDataSourceId) {
          throw new GMIError(`No targetDataSourceId specified for document '${doc.id}' and no default configured.`, GMIErrorCode.VALIDATION_ERROR, { documentId: doc.id });
        }
        effectiveDataSourceIds.add(targetDataSourceId);

        const chunks = this.chunkDocument(doc, options);
        docIdToChunkCount[doc.id] = chunks.length;

        const chunkContents = chunks.map(c => c.content);
        let embeddings: number[][] = [];

        if (chunks.length > 0 && doc.embedding && doc.embeddingModelId && chunks.length === 1 && chunks[0].content === doc.content) {
            // Use pre-computed embedding if document is not chunked (or effectively one chunk)
            embeddings = [doc.embedding];
            // Basic validation
            const modelDim = await this.embeddingManager.getEmbeddingDimension(doc.embeddingModelId);
            if(doc.embedding.length !== modelDim) {
                throw new GMIError(`Pre-computed embedding for doc '${doc.id}' has dimension ${doc.embedding.length}, but model '${doc.embeddingModelId}' expects ${modelDim}.`, GMIErrorCode.VALIDATION_ERROR);
            }
        } else if (chunkContents.length > 0) {
            const embeddingModelId = options?.embeddingModelId || this.config.defaultEmbeddingModelId;
            if (!embeddingModelId) {
                throw new GMIError(`No embeddingModelId specified for document '${doc.id}' and no default configured for ingestion.`, GMIErrorCode.CONFIG_ERROR, { documentId: doc.id });
            }
            const embeddingResponse = await this.embeddingManager.generateEmbeddings({
                texts: chunkContents,
                modelId: embeddingModelId, // Could be further refined by category behavior later
                userId: options?.userId,
            });

            // Handle partial failures from embedding manager
            if (embeddingResponse.errors && embeddingResponse.errors.length > 0) {
                embeddingResponse.errors.forEach(err => {
                    const failedChunkOriginalDocId = chunks[err.textIndex].originalDocumentId;
                    overallResults.errors?.push({
                        documentId: failedChunkOriginalDocId,
                        chunkId: chunks[err.textIndex].id,
                        message: `Embedding generation failed: ${err.message}`,
                        details: err.details,
                    });
                });
            }
            embeddings = embeddingResponse.embeddings; // This array corresponds to chunkContents
        }


        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j];
          const chunkEmbedding = embeddings[j];

          if (!chunkEmbedding || chunkEmbedding.length === 0) {
             // Error for this chunk was already added by embeddingResponse error handling, or if pre-computed was invalid.
             // Ensure this chunk isn't added to vectorDocumentsToUpsert.
             console.warn(`Skipping chunk '${chunk.id}' due to missing or invalid embedding.`);
             continue;
          }

          const chunkMetadata: Record<string, MetadataValue> = {
            ...(doc.metadata ?? {}),
            originalDocumentId: doc.id,
            chunkSequence: j,
          };
          if (doc.source) {
            chunkMetadata.source = doc.source;
          }
          if (doc.language) {
            chunkMetadata.language = doc.language;
          }

          vectorDocumentsToUpsert.push({
            id: chunk.id, // Chunk ID
            embedding: chunkEmbedding,
            metadata: chunkMetadata,
            textContent: chunk.content, // Store chunk content
          });
        }
      } catch (error: any) {
        console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Failed to process document '${doc.id}' for ingestion. Error: ${error.message}`, error);
        overallResults.errors?.push({
          documentId: doc.id,
          message: `Document processing failed: ${error.message}`,
          details: error instanceof GMIError ? error.details : error.toString(),
        });
        overallResults.failedCount++;
      }
    } // End loop over docBatch

    if (vectorDocumentsToUpsert.length > 0) {
      // Determine the target data source for this batch (assuming batch goes to one source for simplicity here)
      // A more complex scenario might group by targetDataSourceId if docs in batch can vary.
      const firstDocTargetDataSourceId = options?.targetDataSourceId || docBatch[0]?.dataSourceId || this.config.defaultDataSourceId;
      if (!firstDocTargetDataSourceId) {
           console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): No targetDataSourceId for upserting processed chunks. Batch skipped.`);
           docBatch.forEach(doc => {
                if (!overallResults.errors?.find(e => e.documentId === doc.id)) {
                    overallResults.errors?.push({ documentId: doc.id, message: "Target data source ID could not be determined for upsert." });
                    overallResults.failedCount++;
                }
           });
           return;
      }

      try {
        const { store, collectionName } = await this.vectorStoreManager.getStoreForDataSource(firstDocTargetDataSourceId);
        const upsertResult = await store.upsert(collectionName, vectorDocumentsToUpsert, {
            overwrite: options?.duplicateHandling !== 'skip' && options?.duplicateHandling !== 'error', // Approx
        });

        upsertResult.upsertedIds?.forEach(upsertedChunkId => {
          const originalDocId = vectorDocumentsToUpsert.find(vd => vd.id === upsertedChunkId)?.metadata?.originalDocumentId as string;
          if (originalDocId) {
            ingestedDocIds.add(originalDocId);
          }
        });
        // This count is tricky. If a doc is chunked into 5, and all 5 upsert, is that 1 or 5?
        // Let's count original documents whose chunks were attempted for upsert and had no prior critical error.
        // A doc is "successfully ingested" if all its generated chunks were upserted without error.
        const successfullyProcessedDocIdsInBatch = new Set<string>();
        vectorDocumentsToUpsert.forEach(vd => {
          if (upsertResult.upsertedIds?.includes(vd.id) && vd.metadata?.originalDocumentId) {
            successfullyProcessedDocIdsInBatch.add(vd.metadata.originalDocumentId as string);
          }
        });
        
        // Refined success/failure count based on document-level success
        docBatch.forEach(doc => {
            const numChunks = docIdToChunkCount[doc.id] || 0;
            if (numChunks === 0 && !overallResults.errors?.find(e => e.documentId === doc.id)) {
                // Document produced no chunks (e.g. empty content), or failed before chunking.
                // If no specific error recorded yet, mark as failed.
                // This depends on if empty content doc is an error or just 0 chunks. Assume error if not processed.
                // overallResults.failedCount++; Let prior errors handle this.
                return;
            }
            
            let docChunksAllUpserted = true;
            if (numChunks > 0) {
                for (let k=0; k < numChunks; ++k) {
                    const chunkId = `${doc.id}_chunk_${k}`; // Assuming this naming convention from chunkDocument
                    const chunkInBatchAttempt = vectorDocumentsToUpsert.find(vd => vd.id === chunkId);
                    if (chunkInBatchAttempt) { // Was this chunk part of the upsert attempt?
                        if (!upsertResult.upsertedIds?.includes(chunkId)) {
                            docChunksAllUpserted = false;
                            // Find or add error for this specific chunk if not already present from embedding.
                            if (!overallResults.errors?.find(e => e.chunkId === chunkId)) {
                                const storeError = upsertResult.errors?.find(e => e.id === chunkId);
                                overallResults.errors?.push({
                                    documentId: doc.id,
                                    chunkId: chunkId,
                                    message: storeError?.message || "Chunk failed to upsert into vector store.",
                                    details: storeError?.details,
                                });
                            }
                        }
                    } else {
                        // Chunk was filtered out before upsert (e.g. embedding failed)
                        docChunksAllUpserted = false;
                    }
                }
            } else if (!successfullyProcessedDocIdsInBatch.has(doc.id) && !overallResults.errors?.find((e: any) => e.documentId === doc.id)) {
                // No chunks, wasn't marked successful, no prior error: means it failed pre-chunking or was empty.
                docChunksAllUpserted = false;
                 overallResults.errors?.push({ documentId: doc.id, message: "Document yielded no processable chunks or failed prior to chunking."});
            }


            if (docChunksAllUpserted && numChunks > 0) {
              ingestedDocIds.add(doc.id);
            } else {
              // If not already counted as failed due to pre-chunking error
              const alreadyFailed = overallResults.errors?.some((e: any) => e.documentId === doc.id && e.chunkId === undefined);
              if (!alreadyFailed) {
                overallResults.failedCount++;
              }
            }
        });


        if (upsertResult.errors && upsertResult.errors.length > 0) {
            // These are errors from the vector store for specific chunk IDs
            upsertResult.errors.forEach((storeErr: any) => {
                const originalDocId = vectorDocumentsToUpsert.find(vd => vd.id === storeErr.id)?.metadata?.originalDocumentId as string;
                if (!overallResults.errors?.find((e: any) => e.chunkId === storeErr.id)) { // Avoid duplicate error messages
                    overallResults.errors?.push({
                        documentId: originalDocId || 'Unknown Original Document',
                        chunkId: storeErr.id,
                        message: `Vector store upsert failed: ${storeErr.message}`,
                        details: storeErr.details,
                    });
                }
            });
        }
      } catch (storeError: any) {
        console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Failed to upsert batch to data source '${firstDocTargetDataSourceId}'. Error: ${storeError.message}`, storeError);
        // All docs in this sub-batch for this store are considered failed at this point
        docBatch.forEach(doc => {
          const alreadyFailed = overallResults.errors?.some((e: any) => e.documentId === doc.id && e.chunkId === undefined);
          if (!alreadyFailed) {
            overallResults.failedCount++;
          }
          overallResults.errors?.push({
            documentId: doc.id,
            message: `Failed to upsert to store: ${storeError.message}`,
            details: storeError instanceof GMIError ? storeError.details : storeError.toString(),
          });
        });
      }
    }
  }


  /**
   * Chunks a single document based on the provided or default strategy.
   * @private
   */
  private chunkDocument(doc: RagDocumentInput, options?: RagIngestionOptions): Array<{ id: string; content: string; originalDocumentId: string; sequence: number }> {
    const strategy = options?.chunkingStrategy || this.config.defaultChunkingStrategy || { type: 'none' as const };

    if (strategy.type === 'none') {
      return [{ id: `${doc.id}_chunk_0`, content: doc.content, originalDocumentId: doc.id, sequence: 0 }];
    }

    if (strategy.type === 'recursive_character' || strategy.type === 'fixed_size') {
      // Basic character-based fixed size splitter
      const chunkSize = strategy.chunkSize || DEFAULT_CHUNK_SIZE;
      const chunkOverlap = strategy.chunkOverlap || DEFAULT_CHUNK_OVERLAP;
      const chunks: Array<{ id: string; content: string; originalDocumentId: string; sequence: number }> = [];
      let i = 0;
      let sequence = 0;
      while (i < doc.content.length) {
        const end = Math.min(i + chunkSize, doc.content.length);
        chunks.push({
          id: `${doc.id}_chunk_${sequence}`,
          content: doc.content.substring(i, end),
          originalDocumentId: doc.id,
          sequence: sequence,
        });
        sequence++;
        if (end === doc.content.length) break;
        i += (chunkSize - chunkOverlap);
        if (i >= doc.content.length) break; // Avoid creating empty chunk if overlap is large
      }
      return chunks.length > 0 ? chunks : [{ id: `${doc.id}_chunk_0`, content: doc.content, originalDocumentId: doc.id, sequence: 0 }]; // Ensure at least one chunk if content exists
    }

    if (strategy.type === 'semantic') {
      console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): Semantic chunking for doc '${doc.id}' requested but not yet implemented. Falling back to 'none'.`);
      return [{ id: `${doc.id}_chunk_0`, content: doc.content, originalDocumentId: doc.id, sequence: 0 }];
    }

    console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): Unknown chunking strategy '${strategy.type}' for doc '${doc.id}'. Using 'none'.`);
    return [{ id: `${doc.id}_chunk_0`, content: doc.content, originalDocumentId: doc.id, sequence: 0 }];
  }

  /**
   * @inheritdoc
   */
  public async retrieveContext(
    queryText: string,
    options?: RagRetrievalOptions,
  ): Promise<RagRetrievalResult> {
    this.ensureInitialized();
    const diagnostics: RagRetrievalResult['diagnostics'] = { messages: [] };
    const startTime = Date.now();

    // 1. Determine Embedding Model
    const embeddingInfo = await this.embeddingManager.getEmbeddingModelInfo();
    const queryEmbeddingModelId =
      options?.queryEmbeddingModelId ||
      this.config.defaultQueryEmbeddingModelId ||
      embeddingInfo?.modelId;

    if (!queryEmbeddingModelId) {
      throw new GMIError("Could not determine query embedding model ID.", GMIErrorCode.CONFIG_ERROR, { augmenterId: this.augmenterId });
    }

    // 2. Embed Query
    const embeddingStartTime = Date.now();
    const queryEmbeddingResponse = await this.embeddingManager.generateEmbeddings({
      texts: queryText,
      modelId: queryEmbeddingModelId,
      userId: options?.userId,
    });
    diagnostics.embeddingTimeMs = Date.now() - embeddingStartTime;

    if (!queryEmbeddingResponse.embeddings || queryEmbeddingResponse.embeddings.length === 0 || !queryEmbeddingResponse.embeddings[0] || queryEmbeddingResponse.embeddings[0].length === 0) {
      diagnostics.messages?.push("Failed to generate query embedding or embedding was empty.");
      return {
        queryText,
        retrievedChunks: [],
        augmentedContext: "",
        diagnostics,
      };
    }
    const queryEmbedding = queryEmbeddingResponse.embeddings[0];

    // 3. Determine Target Data Sources
    const effectiveDataSourceIds = new Set<string>();
    if (options?.targetDataSourceIds && options.targetDataSourceIds.length > 0) {
      options.targetDataSourceIds.forEach((id: string) => effectiveDataSourceIds.add(id));
    }
    if (options?.targetMemoryCategories && options.targetMemoryCategories.length > 0) {
      options.targetMemoryCategories.forEach((category: string) => {
        const behavior = this.config.categoryBehaviors.find((b: any) => b.category === category);
        behavior?.targetDataSourceIds.forEach((id: string) => effectiveDataSourceIds.add(id));
      });
    }
    if (effectiveDataSourceIds.size === 0) {
      // Fallback to default data source if specified in general config, or all if none
      if (this.config.defaultDataSourceId) {
        effectiveDataSourceIds.add(this.config.defaultDataSourceId);
      } else {
        // Or query all known data sources if no targets and no default
         this.vectorStoreManager.listDataSourceIds().forEach((id: string) => effectiveDataSourceIds.add(id));
         if(effectiveDataSourceIds.size > 0) {
            diagnostics.messages?.push("No specific data sources or categories targeted; querying all available sources.");
         }
      }
    }
     if (effectiveDataSourceIds.size === 0) {
      diagnostics.messages?.push("No target data sources could be determined for the query.");
      return { queryText, retrievedChunks: [], augmentedContext: "", queryEmbedding, diagnostics };
    }
    diagnostics.effectiveDataSourceIds = Array.from(effectiveDataSourceIds);


    // 4. Query Vector Stores
    diagnostics.retrievalTimeMs = 0; // Sum up individual query times
    let allRetrievedChunks: RagRetrievedChunk[] = [];
    diagnostics.dataSourceHits = {};

    for (const dsId of effectiveDataSourceIds) {
      try {
        const { store, collectionName, dimension } = await this.vectorStoreManager.getStoreForDataSource(dsId);
        if (dimension && queryEmbedding.length !== dimension) {
            diagnostics.messages?.push(`Query embedding dimension (${queryEmbedding.length}) mismatches data source '${dsId}' dimension (${dimension}). Skipping this source.`);
            console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): Query embedding dim ${queryEmbedding.length} vs data source '${dsId}' dim ${dimension}.`);
            continue;
        }

        const categoryBehavior = this.config.categoryBehaviors.find((b: any) => b.targetDataSourceIds.includes(dsId));
        const retrievalOptsFromCat = categoryBehavior?.defaultRetrievalOptions || {};
        const globalRetrievalOpts = this.config.globalDefaultRetrievalOptions || {};

        const finalQueryOptions: VectorStoreQueryOptions = {
            topK: options?.topK ?? retrievalOptsFromCat.topK ?? globalRetrievalOpts.topK ?? DEFAULT_TOP_K,
            filter: options?.metadataFilter ?? retrievalOptsFromCat.metadataFilter ?? globalRetrievalOpts.metadataFilter, // Ensure MetadataFilter type compatibility
            includeEmbedding: options?.includeEmbeddings ?? retrievalOptsFromCat.includeEmbeddings ?? globalRetrievalOpts.includeEmbeddings,
            includeMetadata: true, // Usually needed
            includeTextContent: true, // Usually needed for context
            minSimilarityScore: options?.strategyParams?.custom?.minSimilarityScore, // Example, specific to options
            // Map other options as needed
        };
        
        const dsQueryStartTime = Date.now();
        const queryResult = await store.query(collectionName, queryEmbedding, finalQueryOptions);
        diagnostics.retrievalTimeMs += (Date.now() - dsQueryStartTime);

        if(diagnostics.dataSourceHits) diagnostics.dataSourceHits[dsId] = queryResult.documents.length;

        queryResult.documents.forEach((doc: any) => {
          allRetrievedChunks.push({
            id: doc.id,
            content: doc.textContent || "",
            originalDocumentId: doc.metadata?.originalDocumentId as string || doc.id,
            dataSourceId: dsId,
            source: doc.metadata?.source as string,
            metadata: doc.metadata,
            relevanceScore: doc.similarityScore,
            embedding: doc.embedding,
          });
        });
      } catch (error: any) {
        console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Error querying data source '${dsId}'. Error: ${error.message}`, error);
        diagnostics.messages?.push(`Error querying data source '${dsId}': ${error.message}`);
      }
    }

    // 5. Sort, (Optionally Re-rank: MMR, Cross-Encoder - Future Enhancement)
    // For now, simple sort by relevance score (descending)
    allRetrievedChunks.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    
    // Apply topK again after merging, if different from store-level topK or if specified in general options
    const overallTopK = options?.topK ?? this.config.globalDefaultRetrievalOptions?.topK ?? DEFAULT_TOP_K;
    let processedChunks = allRetrievedChunks.slice(0, overallTopK * effectiveDataSourceIds.size); // Take more initially if merging from many
    processedChunks.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    processedChunks = processedChunks.slice(0, overallTopK);


    // Placeholder for re-ranking step
    if (options?.rerankerConfig?.enabled) {
      diagnostics.messages?.push("Re-ranking step configured but not fully implemented in this version.");
      // Re-ranking logic would go here using options.rerankerConfig
      // const rerankStartTime = Date.now();
      // processedChunks = await this._applyReranking(queryText, processedChunks, options.rerankerConfig);
      // diagnostics.rerankingTimeMs = Date.now() - rerankStartTime;
    }
    diagnostics.strategyUsed = options?.strategy || 'similarity';


    // 6. Format Context
    const joinSeparator = this.config.contextJoinSeparator ?? DEFAULT_CONTEXT_JOIN_SEPARATOR;
    const maxChars = options?.tokenBudgetForContext /* (if tokens, convert) */ ?? this.config.maxCharsForAugmentedPrompt ?? DEFAULT_MAX_CHARS_FOR_AUGMENTED_PROMPT;
    
    let augmentedContext = "";
    let currentChars = 0;
    for (const chunk of processedChunks) {
      if (!chunk.content) continue;
      const potentialContent = (augmentedContext.length > 0 ? joinSeparator : "") + chunk.content;
      if (currentChars + potentialContent.length <= maxChars) {
        augmentedContext += potentialContent;
        currentChars += potentialContent.length;
      } else {
        // Try to add a partial chunk if it makes sense or just break
        const remainingChars = maxChars - currentChars - (augmentedContext.length > 0 ? joinSeparator.length : 0);
        if (remainingChars > 50) { // Arbitrary minimum to add partial content
            augmentedContext += (augmentedContext.length > 0 ? joinSeparator : "") + chunk.content.substring(0, remainingChars) + "...";
        }
        break;
      }
    }
    diagnostics.totalTokensInContext = augmentedContext.length; // Approximation if not tokenizing

    diagnostics.messages?.push(`Total retrieval pipeline took ${Date.now() - startTime}ms.`);

    return {
      queryText,
      retrievedChunks: processedChunks,
      augmentedContext,
      queryEmbedding,
      diagnostics,
    };
  }

  /**
   * @inheritdoc
   */
  public async deleteDocuments(
    documentIds: string[],
    dataSourceId?: string,
    options?: { ignoreNotFound?: boolean },
  ): Promise<{
    successCount: number;
    failureCount: number;
    errors?: Array<{ documentId: string; message: string; details?: any }>;
  }> {
    this.ensureInitialized();
    if (!documentIds || documentIds.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: Array<{ documentId: string; message: string; details?: any }> = [];

    const targetDsIds = new Set<string>();
    if (dataSourceId) {
        targetDsIds.add(dataSourceId);
    } else {
        // If no specific dataSourceId, try to delete from all. This might be slow or undesirable.
        // A better approach would be to require dataSourceId or have a mapping.
        // For now, let's assume if no dataSourceId, we iterate through all known sources. This is a placeholder.
        console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): deleteDocuments called without dataSourceId. This behavior might be inefficient or refined in future versions. Attempting delete across all known data sources.`);
        this.vectorStoreManager.listDataSourceIds().forEach((id: string) => targetDsIds.add(id));
        if (targetDsIds.size === 0) {
            documentIds.forEach(docId => {
                errors.push({ documentId: docId, message: "No data sources available to delete from."});
                failureCount++;
            });
            return { successCount, failureCount, errors };
        }
    }
    
    for (const dsId of targetDsIds) {
        try {
            const { store, collectionName } = await this.vectorStoreManager.getStoreForDataSource(dsId);
            // Note: Deleting by document ID might delete multiple chunks if chunks inherit/are prefixed by doc ID.
            // The IVectorStore.delete interface takes IDs which are expected to be chunk IDs.
            // This requires a way to find all chunk IDs for a given original document ID.
            // This is a simplification: assuming documentIds are actually chunk/vector IDs for now.
            // TODO: Enhance to find all chunks for a doc ID and delete them.
            const deleteResult = await store.delete(collectionName, documentIds);
            successCount += deleteResult.deletedCount;
            if (deleteResult.errors) {
                deleteResult.errors.forEach((err: any) => {
                    errors.push({ documentId: err.id || 'unknown', message: `Failed to delete from ${dsId}: ${err.message}`, details: err.details});
                    failureCount++;
                });
            }
        } catch (error: any) {
            documentIds.forEach(docId => {
                 errors.push({ documentId: docId, message: `Error deleting from data source '${dsId}': ${error.message}`, details: error });
                 failureCount++;
            });
        }
    }
    // This success/failure count is based on chunk IDs if documentIds are chunk IDs.
    // If documentIds are original doc IDs, true success is more complex.

    return { successCount, failureCount, errors };
  }

  /**
   * @inheritdoc
   */
  public async updateDocuments(
    documents: RagDocumentInput | RagDocumentInput[],
    options?: RagIngestionOptions,
  ): Promise<RagIngestionResult> {
    this.ensureInitialized();
    const docsArray = Array.isArray(documents) ? documents : [documents];
    const docIdsToUpdate = docsArray.map(doc => doc.id);

    // Simplistic implementation: delete then ingest.
    // This assumes doc.id in RagDocumentInput is the original document ID.
    // The deleteDocuments currently expects chunk IDs or needs enhancement.
    // For a true update, need to ensure all old chunks of a doc are deleted.
    // This is a placeholder for a more sophisticated update.
    console.warn(`RetrievalAugmentor (ID: ${this.augmenterId}): updateDocuments is currently a best-effort delete-then-ingest. Deletion targets document IDs, which might not map directly to all chunks without further logic.`);

    try {
      // This delete is problematic if docIdsToUpdate are original doc IDs and deleteDocuments expects chunk IDs.
      // Assuming for now a conceptual deletion of the "document" entry.
      // A proper implementation would first query for all chunks associated with docIdsToUpdate and delete those.
      // await this.deleteDocuments(docIdsToUpdate, options?.targetDataSourceId, { ignoreNotFound: true });
      // For now, a more robust update would require managing mapping of doc ID to chunk IDs.
      // So, we directly proceed to ingest with overwrite capability.
    } catch (deleteError: any) {
      console.error(`RetrievalAugmentor (ID: ${this.augmenterId}): Error during delete phase of update for documents [${docIdsToUpdate.join(', ')}]. Ingest will still be attempted. Error: ${deleteError.message}`);
    }

    const ingestionOptionsWithOverwrite = {
      ...options,
      duplicateHandling: 'overwrite' as 'overwrite', // Force overwrite for update
    };

    return this.ingestDocuments(documents, ingestionOptionsWithOverwrite);
  }

  /**
   * @inheritdoc
   */
  public async checkHealth(): Promise<{ isHealthy: boolean; details?: Record<string, unknown> }> {
    if (!this.isInitialized) {
      return { isHealthy: false, details: { message: `RetrievalAugmentor (ID: ${this.augmenterId}) not initialized.` } };
    }

    const embManagerHealth = await this.embeddingManager.checkHealth();
    const vecStoreManagerHealth = await this.vectorStoreManager.checkHealth();

    const isHealthy = embManagerHealth.isHealthy && vecStoreManagerHealth.isOverallHealthy;

    return {
      isHealthy,
      details: {
        augmenterId: this.augmenterId,
        status: this.isInitialized ? 'Initialized' : 'Not Initialized',
        embeddingManager: embManagerHealth,
        vectorStoreManager: vecStoreManagerHealth,
        configSummary: {
          defaultDataSourceId: this.config.defaultDataSourceId,
          defaultQueryEmbeddingModelId: this.config.defaultQueryEmbeddingModelId,
          categoryBehaviorCount: this.config.categoryBehaviors.length,
        },
      },
    };
  }

  /**
   * @inheritdoc
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      console.log(`RetrievalAugmentor (ID: ${this.augmenterId}): Shutdown called but not initialized.`);
      return;
    }
    console.log(`RetrievalAugmentor (ID: ${this.augmenterId}): Shutting down...`);
    // Assuming EmbeddingManager and VectorStoreManager are shared and their lifecycle managed externally,
    // or if this Augmentor "owns" them, it should shut them down.
    // For now, let's assume they are managed externally or have their own robust shutdown.
    // If they were created by this augmenter, it would be:
    // await this.embeddingManager.shutdown?.();
    // await this.vectorStoreManager.shutdownAllProviders?.();
    this.isInitialized = false;
    console.log(`RetrievalAugmentor (ID: ${this.augmenterId}) shut down.`);
  }
}
