/**
 * @fileoverview SQL-backed Vector Store Implementation
 *
 * Implements `IVectorStore` using `@framers/sql-storage-adapter` for persistence.
 * This allows vector storage to work across all platforms supported by the storage
 * adapter (SQLite, PostgreSQL, IndexedDB, Capacitor, etc.).
 *
 * **Key Features:**
 * - Cross-platform persistence using sql-storage-adapter
 * - Storage-feature-aware SQL, FTS, and blob encoding
 * - Hybrid search (vector similarity + keyword matching)
 * - Automatic schema management
 * - Portable embedding storage across SQLite, PostgreSQL, IndexedDB, etc.
 *
 * **Architecture:**
 * ```
 * AgentOS RAG System (RetrievalAugmentor)
 *          ↓
 *   VectorStoreManager
 *          ↓
 *   SqlVectorStore (this file)
 *          ↓
 *   @framers/sql-storage-adapter
 *          ↓
 *   Database (SQLite/PostgreSQL/IndexedDB/etc.)
 * ```
 *
 * @module @framers/agentos/rag/vector_stores/SqlVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 * @see @framers/sql-storage-adapter for storage abstraction.
 */
import { resolveStorageAdapter, createStorageFeatures, } from '@framers/sql-storage-adapter';
import { cosineSimilarity as vecCosineSimilarity, dotProduct as vecDotProduct, euclideanDistance as vecEuclideanDistance, } from '../utils/vectorMath.js';
import { GMIError, GMIErrorCode } from '../../core/utils/errors.js';
import { uuidv4 } from '../../core/utils/uuid.js';
import { getNaturalStopWords } from '../../nlp/filters/StopWordFilter.js';
// ============================================================================
// SQL Vector Store Implementation
// ============================================================================
/**
 * SQL-backed vector store implementation.
 *
 * Uses `@framers/sql-storage-adapter` for cross-platform persistence.
 * Stores embeddings as base64-encoded Float32 payloads and computes similarity
 * in application code.
 *
 * @class SqlVectorStore
 * @implements {IVectorStore}
 *
 * @example
 * ```typescript
 * const store = new SqlVectorStore();
 *
 * await store.initialize({
 *   id: 'sql-vector-store',
 *   type: 'sql',
 *   storage: {
 *     filePath: './vectors.db',
 *     priority: ['better-sqlite3', 'sqljs']
 *   },
 *   enableFullTextSearch: true
 * });
 *
 * // Create a collection
 * await store.createCollection('documents', 1536);
 *
 * // Upsert documents
 * await store.upsert('documents', [{
 *   id: 'doc-1',
 *   embedding: [...], // 1536-dim vector
 *   textContent: 'Example document content',
 *   metadata: { author: 'Alice', category: 'tech' }
 * }]);
 *
 * // Query by similarity
 * const results = await store.query('documents', queryEmbedding, { topK: 5 });
 * ```
 */
export class SqlVectorStore {
    /**
     * Constructs a SqlVectorStore instance.
     * The store is not operational until `initialize()` is called.
     */
    constructor() {
        this.ownsAdapter = false; // Whether we created the adapter
        this.isInitialized = false;
        this.tablePrefix = 'agentos_rag_';
        /** Per-collection HNSW sidecars for accelerated vector search. */
        this.sidecars = new Map();
        this.providerId = `sql-vector-store-${uuidv4()}`;
    }
    /**
     * Initializes the vector store with the provided configuration.
     *
     * Creates necessary tables and indexes if they don't exist.
     *
     * @param {VectorStoreProviderConfig} config - Configuration object
     * @throws {GMIError} If configuration is invalid or initialization fails
     */
    async initialize(config) {
        if (this.isInitialized) {
            console.warn(`SqlVectorStore (ID: ${this.providerId}) already initialized. Re-initializing.`);
            await this.shutdown();
        }
        if (config.type !== 'sql') {
            throw new GMIError(`Invalid configuration type for SqlVectorStore: ${config.type}. Expected 'sql'.`, GMIErrorCode.CONFIG_ERROR, { providedType: config.type });
        }
        this.config = config;
        this.tablePrefix = this.config.tablePrefix ?? 'agentos_rag_';
        // Initialize storage adapter
        if (this.config.adapter) {
            this.adapter = this.config.adapter;
            this.ownsAdapter = false;
        }
        else if (this.config.storage) {
            this.adapter = await resolveStorageAdapter(this.config.storage);
            this.ownsAdapter = true;
        }
        else {
            // Default to sql.js (in-memory when no file path provided)
            this.adapter = await resolveStorageAdapter({ priority: ['sqljs'] });
            this.ownsAdapter = true;
            console.warn(`SqlVectorStore (ID: ${this.providerId}): No storage config provided, using sql.js (in-memory).`);
        }
        this.features = createStorageFeatures(this.adapter);
        // Create schema
        await this.createSchema();
        // Store pipeline reference
        this.pipeline = this.config.pipeline;
        this.sidecars.clear();
        this.hnswSidecarClass = undefined;
        this.isInitialized = true;
        console.log(`SqlVectorStore (ID: ${this.providerId}, Config ID: ${this.config.id}) initialized successfully.`);
    }
    /**
     * Creates the database schema for vector storage.
     * @private
     */
    async createSchema() {
        // Collections metadata table
        await this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}collections (
        name TEXT PRIMARY KEY,
        dimension INTEGER NOT NULL,
        similarity_metric TEXT NOT NULL DEFAULT 'cosine',
        document_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
        // Documents table - stores vectors as base64-encoded binary blobs
        await this.adapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tablePrefix}documents (
        id TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        embedding_blob TEXT NOT NULL,
        text_content TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection_name, id),
        FOREIGN KEY (collection_name) REFERENCES ${this.tablePrefix}collections(name) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}docs_collection 
        ON ${this.tablePrefix}documents(collection_name);
      
      CREATE INDEX IF NOT EXISTS idx_${this.tablePrefix}docs_updated 
        ON ${this.tablePrefix}documents(updated_at);
    `);
        // Full-text search index
        if (this.config.enableFullTextSearch !== false) {
            try {
                await this.adapter.exec(this.features.fts.createIndex({
                    table: `${this.tablePrefix}documents_fts`,
                    columns: ['id', 'collection_name', 'text_content'],
                    contentTable: `${this.tablePrefix}documents`,
                    tokenizer: 'porter ascii',
                }));
                console.log(`SqlVectorStore (ID: ${this.providerId}): search index created.`);
            }
            catch (error) {
                console.warn(`SqlVectorStore (ID: ${this.providerId}): search index not available: ${error.message}`);
            }
        }
    }
    /**
     * Ensures the store is initialized before operations.
     * @private
     */
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GMIError(`SqlVectorStore (ID: ${this.providerId}) is not initialized. Call initialize() first.`, GMIErrorCode.NOT_INITIALIZED);
        }
    }
    /**
     * Creates a new collection for storing vectors.
     *
     * @param {string} collectionName - Unique name for the collection
     * @param {number} dimension - Vector embedding dimension
     * @param {CreateCollectionOptions} [options] - Creation options
     */
    async createCollection(collectionName, dimension, options) {
        this.ensureInitialized();
        if (dimension <= 0) {
            throw new GMIError(`Invalid dimension for collection '${collectionName}': ${dimension}. Must be positive.`, GMIErrorCode.VALIDATION_ERROR, { dimension });
        }
        const exists = await this.collectionExists(collectionName);
        if (exists) {
            if (options?.overwriteIfExists) {
                await this.deleteCollection(collectionName);
            }
            else {
                throw new GMIError(`Collection '${collectionName}' already exists.`, GMIErrorCode.ALREADY_EXISTS, { collectionName });
            }
        }
        const now = Date.now();
        const metric = options?.similarityMetric ?? this.config.similarityMetric ?? 'cosine';
        await this.adapter.run(`INSERT INTO ${this.tablePrefix}collections 
       (name, dimension, similarity_metric, document_count, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`, [collectionName, dimension, metric, now, now]);
        console.log(`SqlVectorStore (ID: ${this.providerId}): Collection '${collectionName}' created (dim=${dimension}, metric=${metric}).`);
    }
    /**
     * Checks if a collection exists.
     *
     * @param {string} collectionName - Collection name to check
     * @returns {Promise<boolean>} True if collection exists
     */
    async collectionExists(collectionName) {
        this.ensureInitialized();
        const row = await this.adapter.get(`SELECT COUNT(*) as count FROM ${this.tablePrefix}collections WHERE name = ?`, [collectionName]);
        return (row?.count ?? 0) > 0;
    }
    /**
     * Deletes a collection and all its documents.
     *
     * @param {string} collectionName - Collection to delete
     */
    async deleteCollection(collectionName) {
        this.ensureInitialized();
        // Delete documents first (due to foreign key)
        await this.adapter.run(`DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
        // Delete collection metadata
        await this.adapter.run(`DELETE FROM ${this.tablePrefix}collections WHERE name = ?`, [collectionName]);
        const sidecar = this.sidecars.get(collectionName);
        if (sidecar) {
            await sidecar.shutdown();
            this.sidecars.delete(collectionName);
        }
        console.log(`SqlVectorStore (ID: ${this.providerId}): Collection '${collectionName}' deleted.`);
    }
    /**
     * Gets collection metadata.
     * @private
     */
    async getCollectionMetadata(collectionName) {
        const row = await this.adapter.get(`SELECT * FROM ${this.tablePrefix}collections WHERE name = ?`, [collectionName]);
        if (!row) {
            throw new GMIError(`Collection '${collectionName}' not found.`, GMIErrorCode.NOT_FOUND, { collectionName });
        }
        return {
            name: row.name,
            dimension: row.dimension,
            similarityMetric: row.similarity_metric,
            documentCount: row.document_count,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    /**
     * Upserts documents into a collection.
     *
     * @param {string} collectionName - Target collection
     * @param {VectorDocument[]} documents - Documents to upsert
     * @param {UpsertOptions} [options] - Upsert options
     * @returns {Promise<UpsertResult>} Result of the upsert operation
     */
    async upsert(collectionName, documents, options) {
        this.ensureInitialized();
        const collection = await this.getCollectionMetadata(collectionName);
        const upsertedIds = [];
        const errors = [];
        const now = Date.now();
        for (const doc of documents) {
            // Validate dimension
            if (doc.embedding.length !== collection.dimension) {
                errors.push({
                    id: doc.id,
                    message: `Embedding dimension ${doc.embedding.length} does not match collection dimension ${collection.dimension}.`,
                    details: { expected: collection.dimension, got: doc.embedding.length }
                });
                continue;
            }
            try {
                // Check if document exists
                const existing = await this.adapter.get(`SELECT id FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id = ?`, [collectionName, doc.id]);
                const embeddingBlob = this.encodeEmbedding(doc.embedding);
                const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;
                if (existing && options?.overwrite === false) {
                    errors.push({
                        id: doc.id,
                        message: `Document '${doc.id}' already exists and overwrite is disabled.`,
                        details: { reason: 'NO_OVERWRITE' }
                    });
                    continue;
                }
                if (existing) {
                    // Update existing document
                    await this.adapter.run(`UPDATE ${this.tablePrefix}documents 
             SET embedding_blob = ?, text_content = ?, metadata_json = ?, updated_at = ?
             WHERE collection_name = ? AND id = ?`, [embeddingBlob, doc.textContent ?? null, metadataJson, now, collectionName, doc.id]);
                }
                else {
                    // Insert new document
                    await this.adapter.run(`INSERT INTO ${this.tablePrefix}documents 
             (id, collection_name, embedding_blob, text_content, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [doc.id, collectionName, embeddingBlob, doc.textContent ?? null, metadataJson, now, now]);
                }
                upsertedIds.push(doc.id);
            }
            catch (error) {
                errors.push({
                    id: doc.id,
                    message: `Failed to upsert document: ${error.message}`,
                    details: error
                });
            }
        }
        // Update collection document count
        const countResult = await this.adapter.get(`SELECT COUNT(*) as count FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
        await this.adapter.run(`UPDATE ${this.tablePrefix}collections SET document_count = ?, updated_at = ? WHERE name = ?`, [countResult?.count ?? 0, now, collectionName]);
        // ── HNSW sidecar: add upserted vectors + check threshold ──────────
        const sidecar = await this.getOrCreateSidecar(collection);
        if (sidecar?.isAvailable() && upsertedIds.length > 0) {
            const docsWithEmbeddings = documents
                .filter(d => upsertedIds.includes(d.id) && d.embedding?.length > 0)
                .map(d => ({ id: d.id, embedding: d.embedding }));
            if (sidecar.isActive()) {
                await sidecar.upsertBatch(docsWithEmbeddings);
            }
            else {
                // Check if we just crossed the activation threshold
                const docCount = countResult?.count ?? 0;
                const threshold = this.config.hnswThreshold ?? 1000;
                if (docCount >= threshold) {
                    // Load ALL embeddings from SQLite and rebuild the HNSW index
                    const allRows = await this.adapter.all(`SELECT id, embedding_blob FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
                    const allItems = allRows
                        .map(row => ({
                        id: row.id,
                        embedding: this.decodeStoredEmbedding(row.embedding_blob),
                    }))
                        .filter(item => item.embedding.length > 0);
                    await sidecar.rebuildFromData(allItems);
                }
            }
        }
        return {
            upsertedCount: upsertedIds.length,
            upsertedIds,
            failedCount: errors.length,
            errors: errors.length > 0 ? errors : undefined,
        };
    }
    /**
     * Queries a collection for similar documents.
     *
     * @param {string} collectionName - Collection to query
     * @param {number[]} queryEmbedding - Query vector
     * @param {QueryOptions} [options] - Query options
     * @returns {Promise<QueryResult>} Query results sorted by similarity
     */
    async query(collectionName, queryEmbedding, options) {
        this.ensureInitialized();
        const collection = await this.getCollectionMetadata(collectionName);
        const topK = options?.topK ?? 10;
        // Validate query embedding dimension
        if (queryEmbedding.length !== collection.dimension) {
            throw new GMIError(`Query embedding dimension ${queryEmbedding.length} does not match collection dimension ${collection.dimension}.`, GMIErrorCode.VALIDATION_ERROR, { expected: collection.dimension, got: queryEmbedding.length });
        }
        // ── HNSW fast path ─────────────────────────────────────────────────
        // When the sidecar is active, use O(log n) ANN search to get top
        // candidates by ID, then fetch full documents from SQLite. Falls through
        // to brute-force when the sidecar is inactive or unavailable.
        const sidecar = await this.getOrCreateSidecar(collection);
        if (sidecar?.isActive()) {
            const hnswCandidates = await sidecar.search(queryEmbedding, topK * 3);
            if (hnswCandidates.length > 0) {
                const candidateIds = hnswCandidates.map(c => c.id);
                const placeholders = candidateIds.map(() => '?').join(',');
                let hnswQuery = `SELECT * FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id IN (${placeholders})`;
                const hnswParams = [collectionName, ...candidateIds];
                if (options?.filter) {
                    const filterSQL = this.buildMetadataFilterSQL(options.filter);
                    hnswQuery += filterSQL.clause;
                    hnswParams.push(...filterSQL.params);
                }
                const rows = await this.adapter.all(hnswQuery, hnswParams);
                const scoreMap = new Map(hnswCandidates.map(c => [c.id, c.score]));
                const candidates = rows.map(row => {
                    const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;
                    if (options?.filter && !this.matchesFilter(metadata, options.filter)) {
                        return null;
                    }
                    const embedding = options?.includeEmbedding
                        ? this.decodeStoredEmbedding(row.embedding_blob)
                        : [];
                    const doc = {
                        id: row.id,
                        embedding,
                        similarityScore: scoreMap.get(row.id) ?? 0,
                    };
                    if (options?.includeMetadata !== false && metadata)
                        doc.metadata = metadata;
                    if (options?.includeTextContent && row.text_content)
                        doc.textContent = row.text_content;
                    return doc;
                }).filter((d) => {
                    if (!d)
                        return false;
                    return options?.minSimilarityScore === undefined || d.similarityScore >= options.minSimilarityScore;
                });
                candidates.sort((a, b) => b.similarityScore - a.similarityScore);
                const results = candidates.slice(0, topK);
                const requiresExactFallback = (options?.filter !== undefined || options?.minSimilarityScore !== undefined)
                    && results.length < topK;
                if (results.length > 0 && !requiresExactFallback) {
                    return {
                        documents: results,
                        queryId: `sql-hnsw-query-${uuidv4()}`,
                        stats: { totalCandidates: hnswCandidates.length, filteredCandidates: candidates.length, returnedCount: results.length },
                    };
                }
            }
        }
        // ── Brute-force fallback ──────────────────────────────────────────
        // Pre-filter in SQL, then apply exact JS filter semantics for any
        // operators the SQL fragment cannot fully express.
        let query = `SELECT * FROM ${this.tablePrefix}documents WHERE collection_name = ?`;
        const params = [collectionName];
        // Push metadata filters into SQL WHERE clauses — avoids loading unmatched rows
        if (options?.filter) {
            const filterSQL = this.buildMetadataFilterSQL(options.filter);
            query += filterSQL.clause;
            params.push(...filterSQL.params);
        }
        const rows = await this.adapter.all(query, params);
        // Compute similarities on the (now pre-filtered) result set
        const candidates = [];
        for (const row of rows) {
            const embedding = this.decodeStoredEmbedding(row.embedding_blob);
            const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;
            if (options?.filter && !this.matchesFilter(metadata, options.filter)) {
                continue;
            }
            // Compute similarity
            let similarityScore;
            switch (collection.similarityMetric) {
                case 'euclidean':
                    similarityScore = -vecEuclideanDistance(queryEmbedding, embedding); // Negate for "higher is better"
                    break;
                case 'dotproduct':
                    similarityScore = vecDotProduct(queryEmbedding, embedding);
                    break;
                case 'cosine':
                default:
                    similarityScore = vecCosineSimilarity(queryEmbedding, embedding);
                    break;
            }
            // Apply minimum similarity threshold
            if (options?.minSimilarityScore !== undefined && similarityScore < options.minSimilarityScore) {
                continue;
            }
            // Build result document
            const retrievedDoc = {
                id: row.id,
                embedding: options?.includeEmbedding ? embedding : [],
                similarityScore,
            };
            if (options?.includeMetadata !== false && metadata) {
                retrievedDoc.metadata = metadata;
            }
            if (options?.includeTextContent && row.text_content) {
                retrievedDoc.textContent = row.text_content;
            }
            candidates.push(retrievedDoc);
        }
        // Sort by similarity (descending) and take topK
        candidates.sort((a, b) => b.similarityScore - a.similarityScore);
        const results = candidates.slice(0, topK);
        return {
            documents: results,
            queryId: `sql-query-${uuidv4()}`,
            stats: {
                totalCandidates: rows.length,
                filteredCandidates: candidates.length,
                returnedCount: results.length,
            },
        };
    }
    /**
     * Performs hybrid search combining vector similarity with keyword matching.
     *
     * @param {string} collectionName - Collection to search
     * @param {number[]} queryEmbedding - Query vector for semantic search
     * @param {string} queryText - Text query for keyword search
     * @param {QueryOptions & { alpha?: number }} [options] - Search options
     * @returns {Promise<QueryResult>} Combined search results
     *
     * @example
     * ```typescript
     * const results = await store.hybridSearch(
     *   'documents',
     *   queryEmbedding,
     *   'machine learning tutorial',
     *   { topK: 10, alpha: 0.7 } // 70% vector, 30% keyword
     * );
     * ```
     */
    async hybridSearch(collectionName, queryEmbedding, queryText, options) {
        this.ensureInitialized();
        const alphaRaw = options?.alpha ?? 0.7;
        const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.7;
        const topK = options?.topK ?? 10;
        const fusion = options?.fusion === 'weighted' ? 'weighted' : 'rrf';
        const rrfK = Number.isFinite(options?.rrfK) ? Math.max(1, options.rrfK) : 60;
        const lexicalTopK = Number.isFinite(options?.lexicalTopK) ? Math.max(1, options.lexicalTopK) : topK * 3;
        const denseTopK = topK * 3;
        const collection = await this.getCollectionMetadata(collectionName);
        if (queryEmbedding.length !== collection.dimension) {
            throw new GMIError(`Query embedding dimension ${queryEmbedding.length} does not match collection dimension ${collection.dimension}.`, GMIErrorCode.VALIDATION_ERROR, { expected: collection.dimension, got: queryEmbedding.length });
        }
        // Load documents with SQL-level metadata filtering (avoids loading unmatched rows).
        let hybridQuery = `SELECT * FROM ${this.tablePrefix}documents WHERE collection_name = ?`;
        const hybridParams = [collectionName];
        if (options?.filter) {
            const filterSQL = this.buildMetadataFilterSQL(options.filter);
            hybridQuery += filterSQL.clause;
            hybridParams.push(...filterSQL.params);
        }
        const rows = await this.adapter.all(hybridQuery, hybridParams);
        const tokenize = (text) => {
            /* Use pluggable pipeline when configured */
            if (this.pipeline)
                return this.pipeline.processToStrings(text);
            /* Fallback: built-in regex tokenizer with natural's 170-word stop word list */
            const stopWords = getNaturalStopWords();
            return text.toLowerCase().split(/[^a-z0-9_]+/g).filter((t) => t.length > 2 && !stopWords.has(t));
        };
        const queryTerms = tokenize(queryText);
        const queryTermSet = new Set(queryTerms);
        const scored = [];
        const termDocFreq = new Map(); // df per term
        let totalDocLength = 0;
        // First pass: dense score + collect BM25 stats (doc length + df for query terms)
        for (const row of rows) {
            const embedding = this.decodeStoredEmbedding(row.embedding_blob);
            const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;
            // SQL pre-filter narrows the candidate set; JS post-filter keeps the
            // full MetadataFilter semantics for array and mixed-type operators.
            if (options?.filter && !this.matchesFilter(metadata, options.filter)) {
                continue;
            }
            let denseScore;
            switch (collection.similarityMetric) {
                case 'euclidean':
                    denseScore = -vecEuclideanDistance(queryEmbedding, embedding);
                    break;
                case 'dotproduct':
                    denseScore = vecDotProduct(queryEmbedding, embedding);
                    break;
                case 'cosine':
                default:
                    denseScore = vecCosineSimilarity(queryEmbedding, embedding);
                    break;
            }
            // Allow dense thresholding without suppressing lexical-only matches.
            if (options?.minSimilarityScore !== undefined && denseScore < options.minSimilarityScore) {
                denseScore = Number.NEGATIVE_INFINITY;
            }
            const textContent = row.text_content ?? undefined;
            let docLength = 0;
            let uniqueTermsInDoc = null;
            if (textContent && queryTermSet.size > 0) {
                const tokens = tokenize(textContent);
                docLength = tokens.length;
                totalDocLength += docLength;
                uniqueTermsInDoc = new Set();
                for (const token of tokens) {
                    if (queryTermSet.has(token))
                        uniqueTermsInDoc.add(token);
                }
                for (const term of uniqueTermsInDoc) {
                    termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
                }
            }
            scored.push({
                id: row.id,
                embedding,
                textContent,
                metadata: options?.includeMetadata !== false ? metadata : undefined,
                denseScore,
                bm25Score: 0,
            });
        }
        const N = scored.length;
        const avgdl = N > 0 ? totalDocLength / Math.max(1, N) : 0;
        const k1 = 1.2;
        const b = 0.75;
        // Second pass: compute BM25 for query terms
        if (queryTerms.length > 0 && N > 0 && avgdl > 0) {
            const idfCache = new Map();
            for (const term of queryTermSet) {
                const df = termDocFreq.get(term) ?? 0;
                const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
                idfCache.set(term, idf);
            }
            for (const doc of scored) {
                if (!doc.textContent)
                    continue;
                const tokens = tokenize(doc.textContent);
                const dl = tokens.length;
                if (dl === 0)
                    continue;
                const tf = new Map();
                for (const token of tokens) {
                    if (queryTermSet.has(token))
                        tf.set(token, (tf.get(token) ?? 0) + 1);
                }
                let score = 0;
                for (const term of queryTermSet) {
                    const f = tf.get(term) ?? 0;
                    if (f === 0)
                        continue;
                    const idf = idfCache.get(term) ?? 0;
                    const denom = f + k1 * (1 - b + b * (dl / avgdl));
                    score += idf * ((f * (k1 + 1)) / denom);
                }
                doc.bm25Score = score;
            }
        }
        // Build ranked lists for fusion.
        const denseRanked = scored
            .filter((d) => Number.isFinite(d.denseScore) && d.denseScore !== Number.NEGATIVE_INFINITY)
            .sort((a, b) => b.denseScore - a.denseScore)
            .slice(0, denseTopK);
        const lexicalRanked = scored
            .filter((d) => d.bm25Score > 0)
            .sort((a, b) => b.bm25Score - a.bm25Score)
            .slice(0, lexicalTopK);
        const denseRank = new Map();
        denseRanked.forEach((d, idx) => denseRank.set(d.id, idx + 1));
        const lexRank = new Map();
        lexicalRanked.forEach((d, idx) => lexRank.set(d.id, idx + 1));
        const candidateIds = new Set();
        denseRanked.forEach((d) => candidateIds.add(d.id));
        lexicalRanked.forEach((d) => candidateIds.add(d.id));
        const docById = new Map();
        scored.forEach((d) => docById.set(d.id, d));
        const fused = [];
        if (fusion === 'weighted') {
            const denseScores = denseRanked.map((d) => d.denseScore);
            const lexScores = lexicalRanked.map((d) => d.bm25Score);
            const denseMin = denseScores.length ? Math.min(...denseScores) : 0;
            const denseMax = denseScores.length ? Math.max(...denseScores) : 1;
            const lexMax = lexScores.length ? Math.max(...lexScores) : 1;
            for (const id of candidateIds) {
                const doc = docById.get(id);
                if (!doc)
                    continue;
                const dense = denseRank.has(id)
                    ? (doc.denseScore - denseMin) / Math.max(1e-9, denseMax - denseMin)
                    : 0;
                const lex = lexRank.has(id) ? doc.bm25Score / Math.max(1e-9, lexMax) : 0;
                fused.push({ doc, fusedScore: alpha * dense + (1 - alpha) * lex });
            }
        }
        else {
            for (const id of candidateIds) {
                const doc = docById.get(id);
                if (!doc)
                    continue;
                const dr = denseRank.get(id);
                const lr = lexRank.get(id);
                const dense = dr ? alpha * (1 / (rrfK + dr)) : 0;
                const lex = lr ? (1 - alpha) * (1 / (rrfK + lr)) : 0;
                fused.push({ doc, fusedScore: dense + lex });
            }
        }
        fused.sort((a, b) => b.fusedScore - a.fusedScore);
        const documents = fused.slice(0, topK).map(({ doc, fusedScore }) => {
            const out = {
                id: doc.id,
                embedding: options?.includeEmbedding ? doc.embedding : [],
                similarityScore: fusedScore,
            };
            if (options?.includeTextContent && doc.textContent) {
                out.textContent = doc.textContent;
            }
            if (options?.includeMetadata !== false && doc.metadata) {
                out.metadata = doc.metadata;
            }
            return out;
        });
        return {
            documents,
            queryId: `sql-hybrid-${uuidv4()}`,
            stats: {
                fusion,
                vectorWeight: alpha,
                lexicalWeight: 1 - alpha,
                rrfK: fusion === 'rrf' ? rrfK : undefined,
                queryTerms: queryTerms.length,
                corpusSize: N,
                denseCandidates: denseRanked.length,
                lexicalCandidates: lexicalRanked.length,
                returnedCount: documents.length,
            },
        };
    }
    /**
     * Deletes documents from a collection.
     *
     * @param {string} collectionName - Collection to delete from
     * @param {string[]} [ids] - Specific document IDs to delete
     * @param {DeleteOptions} [options] - Delete options (filter, deleteAll)
     * @returns {Promise<DeleteResult>} Deletion result
     */
    async delete(collectionName, ids, options) {
        this.ensureInitialized();
        const collection = await this.getCollectionMetadata(collectionName);
        let deletedCount = 0;
        let deletedIds = [];
        const errors = [];
        if (options?.deleteAll && !ids && !options.filter) {
            // Delete all documents in collection
            const rows = await this.adapter.all(`SELECT id FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
            deletedIds = rows.map(row => row.id);
            const result = await this.adapter.run(`DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
            deletedCount = result.changes;
            console.warn(`SqlVectorStore (ID: ${this.providerId}): All ${deletedCount} documents deleted from '${collectionName}'.`);
        }
        else if (ids && ids.length > 0) {
            // Delete specific IDs
            deletedIds = [...ids];
            const placeholders = ids.map(() => '?').join(',');
            const result = await this.adapter.run(`DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id IN (${placeholders})`, [collectionName, ...ids]);
            deletedCount = result.changes;
        }
        else if (options?.filter) {
            // Delete by filter (fetch matching docs first, then delete)
            const rows = await this.adapter.all(`SELECT id, metadata_json FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
            const idsToDelete = [];
            for (const row of rows) {
                const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;
                if (this.matchesFilter(metadata, options.filter)) {
                    idsToDelete.push(row.id);
                }
            }
            if (idsToDelete.length > 0) {
                deletedIds = idsToDelete;
                const placeholders = idsToDelete.map(() => '?').join(',');
                const result = await this.adapter.run(`DELETE FROM ${this.tablePrefix}documents WHERE collection_name = ? AND id IN (${placeholders})`, [collectionName, ...idsToDelete]);
                deletedCount = result.changes;
            }
        }
        // Update collection document count
        const now = Date.now();
        const countResult = await this.adapter.get(`SELECT COUNT(*) as count FROM ${this.tablePrefix}documents WHERE collection_name = ?`, [collectionName]);
        await this.adapter.run(`UPDATE ${this.tablePrefix}collections SET document_count = ?, updated_at = ? WHERE name = ?`, [countResult?.count ?? 0, now, collectionName]);
        const sidecar = await this.getOrCreateSidecar(collection);
        if (sidecar?.isActive() && deletedIds.length > 0) {
            await sidecar.removeBatch(deletedIds);
        }
        return {
            deletedCount,
            failedCount: errors.length > 0 ? errors.length : undefined,
            errors: errors.length > 0 ? errors : undefined,
        };
    }
    /**
     * Checks the health of the vector store.
     *
     * @returns {Promise<{ isHealthy: boolean; details?: any }>} Health status
     */
    async checkHealth() {
        try {
            this.ensureInitialized();
            // Simple health check query
            const collections = await this.adapter.all(`SELECT name, document_count FROM ${this.tablePrefix}collections`);
            const totalDocuments = collections.reduce((sum, c) => sum + c.document_count, 0);
            return {
                isHealthy: true,
                details: {
                    providerId: this.providerId,
                    configId: this.config.id,
                    type: 'sql',
                    collectionCount: collections.length,
                    totalDocuments,
                    collections: collections.map(c => ({ name: c.name, documentCount: c.document_count })),
                },
            };
        }
        catch (error) {
            return {
                isHealthy: false,
                details: {
                    providerId: this.providerId,
                    error: error.message,
                },
            };
        }
    }
    /**
     * Gracefully shuts down the vector store.
     */
    async shutdown() {
        if (!this.isInitialized) {
            return;
        }
        for (const sidecar of this.sidecars.values()) {
            await sidecar.shutdown();
        }
        this.sidecars.clear();
        this.hnswSidecarClass = undefined;
        if (this.ownsAdapter && this.adapter) {
            await this.adapter.close();
        }
        this.isInitialized = false;
        console.log(`SqlVectorStore (ID: ${this.providerId}) shut down.`);
    }
    /**
     * Gets statistics for a collection or the entire store.
     *
     * @param {string} [collectionName] - Specific collection, or all if omitted
     * @returns {Promise<Record<string, any>>} Statistics
     */
    async getStats(collectionName) {
        this.ensureInitialized();
        if (collectionName) {
            const collection = await this.getCollectionMetadata(collectionName);
            return {
                collectionName: collection.name,
                dimension: collection.dimension,
                similarityMetric: collection.similarityMetric,
                documentCount: collection.documentCount,
                createdAt: collection.createdAt,
                updatedAt: collection.updatedAt,
            };
        }
        const collections = await this.adapter.all(`SELECT * FROM ${this.tablePrefix}collections`);
        return {
            providerId: this.providerId,
            configId: this.config.id,
            type: 'sql',
            collectionCount: collections.length,
            totalDocuments: collections.reduce((sum, c) => sum + c.document_count, 0),
            collections: collections.map((c) => ({
                name: c.name,
                dimension: c.dimension,
                documentCount: c.document_count,
            })),
        };
    }
    // ============================================================================
    // Private Helper Methods
    // ============================================================================
    /**
     * Lazily load the HNSW sidecar class once for this store instance.
     */
    async loadHnswSidecarClass() {
        if (this.config.hnswThreshold === Infinity) {
            return null;
        }
        if (this.hnswSidecarClass !== undefined) {
            return this.hnswSidecarClass;
        }
        try {
            const { HnswIndexSidecar } = await import('../vector-search/HnswIndexSidecar.js');
            this.hnswSidecarClass = HnswIndexSidecar;
        }
        catch {
            this.hnswSidecarClass = null;
        }
        return this.hnswSidecarClass;
    }
    /**
     * Get or create the HNSW sidecar for a specific collection.
     *
     * Sidecars are collection-scoped so dimensions, metrics, and document IDs
     * stay isolated between collections.
     */
    async getOrCreateSidecar(collection) {
        const existing = this.sidecars.get(collection.name);
        if (existing) {
            return existing;
        }
        const sidecar = this.config.hnswSidecarFactory
            ? this.config.hnswSidecarFactory()
            : await (async () => {
                const HnswSidecarClass = await this.loadHnswSidecarClass();
                return HnswSidecarClass ? new HnswSidecarClass() : null;
            })();
        if (!sidecar) {
            return null;
        }
        await sidecar.initialize({
            indexPath: this.getSidecarIndexPath(collection.name),
            dimensions: this.config.hnswDimensions ?? collection.dimension,
            metric: collection.similarityMetric,
            activationThreshold: this.config.hnswThreshold ?? 1000,
        });
        if (!sidecar.isAvailable()) {
            this.hnswSidecarClass = null;
            return null;
        }
        this.sidecars.set(collection.name, sidecar);
        return sidecar;
    }
    /**
     * Derive a stable per-collection sidecar path from the configured SQL store.
     */
    getSidecarIndexPath(collectionName) {
        const storageConfig = this.config.storage;
        const storagePath = storageConfig?.filePath ?? storageConfig?.database;
        const safeCollectionName = collectionName.replace(/[^a-z0-9._-]+/gi, '_');
        return storagePath
            ? `${storagePath}.${safeCollectionName}.hnsw`
            : `/tmp/agentos-rag-${this.providerId}-${safeCollectionName}.hnsw`;
    }
    /**
     * Translate a MetadataFilter into dialect-aware SQL WHERE clauses.
     * Pushes the easy scalar predicates into SQL so fewer rows are loaded into JS.
     * Exact semantics are enforced by `matchesFilter()` after row hydration.
     *
     * @param filter   - The metadata filter to translate.
     * @param column   - The JSON column name (default: 'metadata_json').
     * @returns Object with `clause` (SQL fragment) and `params` (bind values).
     */
    buildMetadataFilterSQL(filter, column = 'metadata_json') {
        const conditions = [];
        const params = [];
        for (const [field, condition] of Object.entries(filter)) {
            const path = this.features.dialect.jsonExtract(column, `$.${field}`);
            // Direct scalar match (implicit $eq)
            if (typeof condition !== 'object' || condition === null) {
                conditions.push(`${path} = ?`);
                params.push(condition);
                continue;
            }
            const cond = condition;
            if (cond.$eq !== undefined) {
                conditions.push(`${path} = ?`);
                params.push(cond.$eq);
            }
            if (cond.$ne !== undefined) {
                conditions.push(`${path} != ?`);
                params.push(cond.$ne);
            }
            if (cond.$gt !== undefined) {
                conditions.push(`${path} > ?`);
                params.push(cond.$gt);
            }
            if (cond.$gte !== undefined) {
                conditions.push(`${path} >= ?`);
                params.push(cond.$gte);
            }
            if (cond.$lt !== undefined) {
                conditions.push(`${path} < ?`);
                params.push(cond.$lt);
            }
            if (cond.$lte !== undefined) {
                conditions.push(`${path} <= ?`);
                params.push(cond.$lte);
            }
            if (cond.$in !== undefined && Array.isArray(cond.$in)) {
                const placeholders = cond.$in.map(() => '?').join(', ');
                conditions.push(`${path} IN (${placeholders})`);
                params.push(...cond.$in);
            }
            if (cond.$nin !== undefined && Array.isArray(cond.$nin)) {
                const placeholders = cond.$nin.map(() => '?').join(', ');
                conditions.push(`${path} NOT IN (${placeholders})`);
                params.push(...cond.$nin);
            }
            if (cond.$exists !== undefined) {
                conditions.push(cond.$exists ? `${path} IS NOT NULL` : `${path} IS NULL`);
            }
            if (cond.$contains !== undefined) {
                // For string fields: LIKE %value%. For JSON arrays: json_each check.
                conditions.push(`${path} LIKE ?`);
                params.push(`%${cond.$contains}%`);
            }
            if (cond.$textSearch !== undefined) {
                conditions.push(`${path} LIKE ?`);
                params.push(`%${cond.$textSearch}%`);
            }
        }
        return {
            clause: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
            params,
        };
    }
    encodeEmbedding(embedding) {
        return this.bytesToBase64(this.features.blobCodec.encode(embedding));
    }
    decodeStoredEmbedding(value) {
        if (typeof value === 'string') {
            if (this.isLegacyJsonEmbedding(value)) {
                return JSON.parse(value);
            }
            return this.features.blobCodec.decode(this.base64ToBytes(value));
        }
        const bytes = this.asBinaryBytes(value);
        return bytes ? this.features.blobCodec.decode(bytes) : [];
    }
    isLegacyJsonEmbedding(value) {
        return value.trimStart().startsWith('[');
    }
    asBinaryBytes(value) {
        if (value == null)
            return null;
        if (value instanceof Uint8Array)
            return value;
        if (value instanceof ArrayBuffer)
            return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        }
        return null;
    }
    bytesToBase64(bytes) {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('base64');
        }
        const btoaFn = globalThis.btoa;
        if (!btoaFn) {
            throw new Error('No base64 encoder available in this runtime.');
        }
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoaFn(binary);
    }
    base64ToBytes(encoded) {
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(encoded, 'base64'));
        }
        const atobFn = globalThis.atob;
        if (!atobFn) {
            throw new Error('No base64 decoder available in this runtime.');
        }
        const binary = atobFn(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    // Distance methods removed — now imported from rag/utils/vectorMath.ts
    /**
     * Checks if metadata matches a filter.
     * @private
     */
    matchesFilter(metadata, filter) {
        if (!metadata) {
            // Check if filter only has $exists: false conditions
            for (const key in filter) {
                const condition = filter[key];
                if (typeof condition === 'object' && condition !== null && condition.$exists === false) {
                    continue;
                }
                return false;
            }
            return true;
        }
        for (const key in filter) {
            const docValue = metadata[key];
            const filterValue = filter[key];
            if (typeof filterValue === 'object' && filterValue !== null) {
                if (!this.evaluateCondition(docValue, filterValue)) {
                    return false;
                }
            }
            else {
                // Direct equality check
                if (Array.isArray(docValue)) {
                    if (!docValue.includes(filterValue)) {
                        return false;
                    }
                }
                else if (docValue !== filterValue) {
                    return false;
                }
            }
        }
        return true;
    }
    /**
     * Evaluates a single filter condition.
     * @private
     */
    evaluateCondition(docValue, condition) {
        if (condition.$exists !== undefined) {
            return condition.$exists === (docValue !== undefined);
        }
        if (docValue === undefined)
            return false;
        if (condition.$eq !== undefined && docValue !== condition.$eq)
            return false;
        if (condition.$ne !== undefined && docValue === condition.$ne)
            return false;
        if (typeof docValue === 'number') {
            if (condition.$gt !== undefined && !(docValue > condition.$gt))
                return false;
            if (condition.$gte !== undefined && !(docValue >= condition.$gte))
                return false;
            if (condition.$lt !== undefined && !(docValue < condition.$lt))
                return false;
            if (condition.$lte !== undefined && !(docValue <= condition.$lte))
                return false;
        }
        if (condition.$in !== undefined) {
            if (Array.isArray(docValue)) {
                if (!docValue.some(val => condition.$in.includes(val)))
                    return false;
            }
            else {
                if (!condition.$in.includes(docValue))
                    return false;
            }
        }
        if (condition.$nin !== undefined) {
            if (Array.isArray(docValue)) {
                if (docValue.some(val => condition.$nin.includes(val)))
                    return false;
            }
            else {
                if (condition.$nin.includes(docValue))
                    return false;
            }
        }
        if (Array.isArray(docValue)) {
            if (condition.$contains !== undefined && !docValue.includes(condition.$contains))
                return false;
            if (condition.$all !== undefined && !condition.$all.every(item => docValue.includes(item)))
                return false;
        }
        else if (typeof docValue === 'string' && condition.$contains !== undefined) {
            if (!docValue.includes(String(condition.$contains)))
                return false;
        }
        if (condition.$textSearch !== undefined && typeof docValue === 'string') {
            if (!docValue.toLowerCase().includes(condition.$textSearch.toLowerCase()))
                return false;
        }
        return true;
    }
}
//# sourceMappingURL=SqlVectorStore.js.map