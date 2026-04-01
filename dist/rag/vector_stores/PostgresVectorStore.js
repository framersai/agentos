/**
 * @fileoverview Postgres + pgvector Vector Store Implementation.
 * @module rag/vector_stores/PostgresVectorStore
 *
 * Implements `IVectorStore` using Postgres with the pgvector extension
 * for native HNSW-indexed approximate nearest neighbor search. Supports:
 *
 * - Dense vector search via pgvector `<=>` (cosine), `<->` (L2), `<#>` (inner product)
 * - Full-text search via tsvector + GIN indexes
 * - Hybrid search combining both with RRF fusion in a single SQL query
 * - JSONB metadata filtering with GIN indexes
 * - Connection pooling via pg.Pool
 *
 * Scaling target: 500K → 10M vectors with multi-tenant schema isolation.
 *
 * @see ../../IVectorStore.ts for the interface definition.
 */
// ---------------------------------------------------------------------------
// PostgresVectorStore
// ---------------------------------------------------------------------------
export class PostgresVectorStore {
    constructor(config) {
        this.pool = null; // pg.Pool
        this.isInitialized = false;
        this.config = config;
        this.prefix = config.tablePrefix ?? '';
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    /**
     * Initialize the connection pool, ensure pgvector extension exists,
     * and create the collections metadata table.
     */
    async initialize() {
        if (this.isInitialized)
            return;
        const pg = await import('pg');
        this.pool = new pg.default.Pool({
            connectionString: this.config.connectionString,
            max: this.config.poolSize ?? 10,
        });
        // Ensure pgvector extension is installed.
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        // Create collections metadata table.
        await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this._t('_collections')} (
        name TEXT PRIMARY KEY,
        dimension INTEGER NOT NULL,
        metric TEXT NOT NULL DEFAULT 'cosine',
        created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
      )
    `);
        this.isInitialized = true;
    }
    /** Close the connection pool. */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.isInitialized = false;
        }
    }
    /** Gracefully shut down the store (alias for close). */
    async shutdown() {
        await this.close();
    }
    /**
     * Health check — verifies connection and pgvector availability.
     * @returns True if Postgres + pgvector is reachable.
     */
    async healthCheck() {
        try {
            await this._ensureInit();
            const result = await this.pool.query('SELECT 1 AS ok');
            return result.rows[0]?.ok === 1;
        }
        catch {
            return false;
        }
    }
    /** IVectorStore-compliant health check. */
    async checkHealth() {
        const isHealthy = await this.healthCheck();
        return { isHealthy };
    }
    // =========================================================================
    // Collection Management
    // =========================================================================
    /**
     * Create a new collection (Postgres table) with pgvector HNSW index.
     */
    async createCollection(name, dimension, options) {
        await this._ensureInit();
        const dim = dimension ?? this.config.defaultDimension ?? 1536;
        const metric = (options?.similarityMetric ?? this.config.similarityMetric ?? 'cosine');
        const table = this._t(name);
        // Create the documents table with pgvector embedding column.
        await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        embedding vector(${dim}),
        metadata_json JSONB,
        text_content TEXT,
        created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        updated_at BIGINT
      )
    `);
        // Create HNSW index for ANN search.
        const opsClass = metric === 'cosine' ? 'vector_cosine_ops'
            : metric === 'euclidean' ? 'vector_l2_ops'
                : 'vector_ip_ops';
        await this.pool.query(`CREATE INDEX IF NOT EXISTS ${table}_hnsw ON ${table} USING hnsw (embedding ${opsClass})`);
        // Create GIN index for JSONB metadata filtering.
        await this.pool.query(`CREATE INDEX IF NOT EXISTS ${table}_metadata ON ${table} USING gin (metadata_json)`);
        // Create tsvector column + GIN index for full-text search.
        // Use a try-catch because the column may already exist.
        try {
            await this.pool.query(`ALTER TABLE ${table} ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text_content, ''))) STORED`);
            await this.pool.query(`CREATE INDEX IF NOT EXISTS ${table}_fts ON ${table} USING gin (tsv)`);
        }
        catch {
            // Column already exists — fine.
        }
        // Register in collections metadata.
        await this.pool.query(`INSERT INTO ${this._t('_collections')} (name, dimension, metric) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`, [name, dim, metric]);
    }
    /** Drop a collection table. */
    async dropCollection(name) {
        await this._ensureInit();
        await this.pool.query(`DROP TABLE IF EXISTS ${this._t(name)} CASCADE`);
        await this.pool.query(`DELETE FROM ${this._t('_collections')} WHERE name = $1`, [name]);
    }
    // =========================================================================
    // Upsert
    // =========================================================================
    /**
     * Upsert documents into a collection.
     * Uses INSERT ... ON CONFLICT (id) DO UPDATE for idempotent writes.
     */
    async upsert(collectionName, documents, _options) {
        await this._ensureInit();
        const table = this._t(collectionName);
        const now = Date.now();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const doc of documents) {
                // Convert embedding to pgvector string format: '[0.1,0.2,...]'
                const vecStr = `[${doc.embedding.join(',')}]`;
                const metaJson = doc.metadata ? JSON.stringify(doc.metadata) : null;
                const text = doc.textContent ?? null;
                await client.query(`INSERT INTO ${table} (id, embedding, metadata_json, text_content, created_at, updated_at)
           VALUES ($1, $2::vector, $3::jsonb, $4, $5, $5)
           ON CONFLICT (id) DO UPDATE SET
             embedding = EXCLUDED.embedding,
             metadata_json = EXCLUDED.metadata_json,
             text_content = EXCLUDED.text_content,
             updated_at = EXCLUDED.updated_at`, [doc.id, vecStr, metaJson, text, now]);
            }
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
        return {
            upsertedCount: documents.length,
            upsertedIds: documents.map(d => d.id),
            failedCount: 0,
        };
    }
    // =========================================================================
    // Query (Dense Vector Search)
    // =========================================================================
    /**
     * Query for top-K nearest neighbors using pgvector operators.
     * Uses HNSW index for O(log n) approximate search.
     */
    async query(collectionName, queryEmbedding, options) {
        await this._ensureInit();
        const table = this._t(collectionName);
        const topK = options?.topK ?? 10;
        const vecStr = `[${queryEmbedding.join(',')}]`;
        // Determine distance operator based on collection metric.
        const meta = await this._getCollectionMeta(collectionName);
        const op = meta?.metric === 'euclidean' ? '<->'
            : meta?.metric === 'dotproduct' ? '<#>'
                : '<=>'; // cosine (default)
        // Build query with optional JSONB metadata filtering.
        let sql = `SELECT id, embedding::text, metadata_json, text_content,
               (embedding ${op} $1::vector) AS distance
               FROM ${table}`;
        const params = [vecStr];
        let paramIdx = 2;
        // Apply metadata filters.
        if (options?.filter) {
            const { clause, filterParams } = this._buildMetadataFilter(options.filter, paramIdx);
            if (clause) {
                sql += ` WHERE ${clause}`;
                params.push(...filterParams);
                paramIdx += filterParams.length;
            }
        }
        sql += ` ORDER BY embedding ${op} $1::vector LIMIT $${paramIdx}`;
        params.push(topK);
        const result = await this.pool.query(sql, params);
        // Convert rows to RetrievedVectorDocument.
        const documents = result.rows.map((row) => {
            const doc = {
                id: row.id,
                // Cosine distance → similarity: 1 - distance. L2: negate. IP: negate.
                similarityScore: op === '<=>' ? 1 - row.distance : -row.distance,
                embedding: options?.includeEmbedding ? this._parseVectorString(row.embedding) : [],
            };
            if (options?.includeMetadata !== false && row.metadata_json) {
                doc.metadata = row.metadata_json;
            }
            if (options?.includeTextContent && row.text_content) {
                doc.textContent = row.text_content;
            }
            return doc;
        });
        return {
            documents,
            queryId: `pg-${Date.now()}`,
            stats: {
                totalCandidates: result.rowCount ?? 0,
                filteredCandidates: documents.length,
                returnedCount: documents.length,
            },
        };
    }
    // =========================================================================
    // Hybrid Search (Dense + Lexical with RRF)
    // =========================================================================
    /**
     * Hybrid search combining pgvector ANN and tsvector BM25 in a single
     * SQL query with Reciprocal Rank Fusion.
     *
     * This runs as one query with two CTEs — no application-level fusion needed.
     */
    async hybridSearch(collectionName, queryEmbedding, queryText, options) {
        await this._ensureInit();
        const table = this._t(collectionName);
        const topK = options?.topK ?? 10;
        const rrfK = options?.rrfK ?? 60;
        const candidatePool = topK * 3;
        const vecStr = `[${queryEmbedding.join(',')}]`;
        const meta = await this._getCollectionMeta(collectionName);
        const op = meta?.metric === 'euclidean' ? '<->'
            : meta?.metric === 'dotproduct' ? '<#>'
                : '<=>';
        // RRF hybrid query: two CTEs (dense + lexical) merged with reciprocal rank fusion.
        const sql = `
      WITH dense AS (
        SELECT id, (embedding ${op} $1::vector) AS distance,
               ROW_NUMBER() OVER (ORDER BY embedding ${op} $1::vector) AS rank
        FROM ${table}
        ORDER BY embedding ${op} $1::vector
        LIMIT $3
      ),
      lexical AS (
        SELECT id, ts_rank(tsv, plainto_tsquery('english', $2)) AS score,
               ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery('english', $2)) DESC) AS rank
        FROM ${table}
        WHERE tsv @@ plainto_tsquery('english', $2)
        LIMIT $3
      ),
      fused AS (
        SELECT COALESCE(d.id, l.id) AS id,
               (1.0 / ($4 + COALESCE(d.rank, 10000))) + (1.0 / ($4 + COALESCE(l.rank, 10000))) AS rrf_score
        FROM dense d
        FULL OUTER JOIN lexical l ON d.id = l.id
        ORDER BY rrf_score DESC
        LIMIT $5
      )
      SELECT f.id, f.rrf_score, t.embedding::text, t.metadata_json, t.text_content
      FROM fused f
      JOIN ${table} t ON t.id = f.id
      ORDER BY f.rrf_score DESC
    `;
        const result = await this.pool.query(sql, [vecStr, queryText, candidatePool, rrfK, topK]);
        const documents = result.rows.map((row) => {
            const doc = {
                id: row.id,
                similarityScore: row.rrf_score,
                embedding: options?.includeEmbedding ? this._parseVectorString(row.embedding) : [],
            };
            if (options?.includeMetadata !== false && row.metadata_json) {
                doc.metadata = row.metadata_json;
            }
            if (options?.includeTextContent && row.text_content) {
                doc.textContent = row.text_content;
            }
            return doc;
        });
        return {
            documents,
            queryId: `pg-hybrid-${Date.now()}`,
            stats: {
                totalCandidates: candidatePool,
                filteredCandidates: documents.length,
                returnedCount: documents.length,
            },
        };
    }
    // =========================================================================
    // Delete
    // =========================================================================
    /** Delete documents by ID. */
    async delete(collectionName, ids, options) {
        await this._ensureInit();
        const table = this._t(collectionName);
        if (ids && ids.length > 0) {
            const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
            const result = await this.pool.query(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);
            return { deletedCount: result.rowCount ?? 0 };
        }
        if (options?.deleteAll) {
            const result = await this.pool.query(`DELETE FROM ${table}`);
            return { deletedCount: result.rowCount ?? 0 };
        }
        return { deletedCount: 0 };
    }
    // =========================================================================
    // Internals
    // =========================================================================
    /** Ensure the store is initialized before any operation. */
    async _ensureInit() {
        if (!this.isInitialized)
            await this.initialize();
    }
    /** Prefix a table name for multi-tenancy. */
    _t(name) {
        return this.prefix ? `"${this.prefix}${name}"` : `"${name}"`;
    }
    /** Get collection metadata. */
    async _getCollectionMeta(name) {
        const result = await this.pool.query(`SELECT name, dimension, metric FROM ${this._t('_collections')} WHERE name = $1`, [name]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        return {
            name: row.name,
            dimension: row.dimension,
            metric: row.metric,
            documentCount: 0, // Lazy — count not tracked here.
        };
    }
    /**
     * Parse pgvector string format '[0.1,0.2,0.3]' to number[].
     */
    _parseVectorString(str) {
        if (!str)
            return [];
        // pgvector returns format: [0.1,0.2,0.3]
        return str
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(Number);
    }
    /**
     * Build JSONB metadata filter SQL clauses.
     * Uses Postgres JSONB operators for efficient GIN-indexed filtering.
     *
     * @param filter   - MetadataFilter to translate.
     * @param startIdx - Starting parameter index ($N).
     * @returns SQL WHERE clause and parameter values.
     */
    _buildMetadataFilter(filter, startIdx) {
        const conditions = [];
        const params = [];
        let idx = startIdx;
        for (const [field, condition] of Object.entries(filter)) {
            const path = `metadata_json->>'${field}'`;
            // Direct scalar match (implicit $eq).
            if (typeof condition !== 'object' || condition === null) {
                conditions.push(`${path} = $${idx}`);
                params.push(String(condition));
                idx++;
                continue;
            }
            const cond = condition;
            if (cond.$eq !== undefined) {
                conditions.push(`${path} = $${idx}`);
                params.push(String(cond.$eq));
                idx++;
            }
            if (cond.$ne !== undefined) {
                conditions.push(`${path} != $${idx}`);
                params.push(String(cond.$ne));
                idx++;
            }
            if (cond.$gt !== undefined) {
                conditions.push(`(${path})::numeric > $${idx}`);
                params.push(cond.$gt);
                idx++;
            }
            if (cond.$gte !== undefined) {
                conditions.push(`(${path})::numeric >= $${idx}`);
                params.push(cond.$gte);
                idx++;
            }
            if (cond.$lt !== undefined) {
                conditions.push(`(${path})::numeric < $${idx}`);
                params.push(cond.$lt);
                idx++;
            }
            if (cond.$lte !== undefined) {
                conditions.push(`(${path})::numeric <= $${idx}`);
                params.push(cond.$lte);
                idx++;
            }
            if (cond.$in !== undefined && Array.isArray(cond.$in)) {
                const placeholders = cond.$in.map(() => { const p = `$${idx}`; idx++; return p; }).join(', ');
                conditions.push(`${path} IN (${placeholders})`);
                params.push(...cond.$in.map(String));
            }
            if (cond.$exists !== undefined) {
                conditions.push(cond.$exists ? `metadata_json ? '${field}'` : `NOT (metadata_json ? '${field}')`);
            }
            if (cond.$contains !== undefined) {
                conditions.push(`${path} LIKE $${idx}`);
                params.push(`%${cond.$contains}%`);
                idx++;
            }
        }
        return {
            clause: conditions.length > 0 ? conditions.join(' AND ') : '',
            filterParams: params,
        };
    }
}
//# sourceMappingURL=PostgresVectorStore.js.map