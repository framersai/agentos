/**
 * @fileoverview Qdrant-backed Vector Store Implementation
 *
 * Implements `IVectorStore` using Qdrant's HTTP API. Designed to work with both:
 * - Self-hosted Qdrant (Docker, bare metal)
 * - Managed Qdrant Cloud (remote URL + API key)
 *
 * Features:
 * - Dense vector search (client-provided embeddings)
 * - Optional BM25 lexical retrieval via Qdrant's built-in `qdrant/bm25` sparse vectors
 * - Hybrid search via server-side RRF fusion (or client-side weighted fusion)
 * - Metadata filtering via Qdrant payload filters
 *
 * Notes:
 * - This implementation uses `fetch` for runtime portability (Node 18+, browser, edge runtimes).
 * - Text content is stored in payload under a reserved key to support `includeTextContent`.
 *
 * @module @framers/agentos/rag/vector_stores/QdrantVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 */
import { GMIError, GMIErrorCode } from '../../core/utils/errors.js';
import { uuidv4 } from '../../core/utils/uuid.js';
// ============================================================================
// Implementation
// ============================================================================
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_DENSE_VECTOR_NAME = 'dense';
const DEFAULT_BM25_VECTOR_NAME = 'bm25';
const DEFAULT_BM25_MODEL_ID = 'qdrant/bm25';
const RESERVED_TEXT_PAYLOAD_KEY = '__text';
const coerceBaseUrl = (url) => {
    const trimmed = url.trim();
    if (!trimmed)
        return '';
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};
const toDistance = (metric) => {
    if (metric === 'euclidean')
        return 'Euclid';
    if (metric === 'dotproduct')
        return 'Dot';
    return 'Cosine';
};
const safeStringId = (id) => (typeof id === 'string' ? id : String(id));
const isScalar = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const sanitizeMetadataValue = (value) => {
    if (value === null || value === undefined)
        return undefined;
    if (isScalar(value))
        return value;
    if (Array.isArray(value)) {
        const items = [];
        for (const item of value) {
            if (item === null || item === undefined)
                continue;
            if (isScalar(item))
                items.push(item);
            else
                items.push(JSON.stringify(item));
        }
        return items;
    }
    // Fall back to JSON string to keep payload filterable/serializable.
    return JSON.stringify(value);
};
const buildPayload = (doc) => {
    const payload = {};
    if (doc.textContent !== undefined) {
        payload[RESERVED_TEXT_PAYLOAD_KEY] = doc.textContent;
    }
    if (doc.metadata) {
        for (const [key, rawValue] of Object.entries(doc.metadata)) {
            const value = sanitizeMetadataValue(rawValue);
            if (value === undefined)
                continue;
            payload[key] = value;
        }
    }
    return payload;
};
const buildQdrantFilter = (filter) => {
    if (!filter)
        return undefined;
    const must = [];
    const must_not = [];
    const addEq = (key, value) => {
        must.push({ key, match: { value } });
    };
    const addNe = (key, value) => {
        must_not.push({ key, match: { value } });
    };
    const addAny = (key, values) => {
        if (values.length === 0)
            return;
        must.push({ key, match: { any: values } });
    };
    const addNotAny = (key, values) => {
        if (values.length === 0)
            return;
        must_not.push({ key, match: { any: values } });
    };
    const addRange = (key, range) => {
        const normalized = {};
        if (typeof range.gt === 'number')
            normalized.gt = range.gt;
        if (typeof range.gte === 'number')
            normalized.gte = range.gte;
        if (typeof range.lt === 'number')
            normalized.lt = range.lt;
        if (typeof range.lte === 'number')
            normalized.lte = range.lte;
        if (Object.keys(normalized).length === 0)
            return;
        must.push({ key, range: normalized });
    };
    for (const [key, rawCondition] of Object.entries(filter)) {
        // Implicit equality
        if (isScalar(rawCondition)) {
            addEq(key, rawCondition);
            continue;
        }
        const condition = rawCondition;
        if (isScalar(condition.$eq))
            addEq(key, condition.$eq);
        if (isScalar(condition.$ne))
            addNe(key, condition.$ne);
        if (Array.isArray(condition.$in))
            addAny(key, condition.$in.filter(isScalar));
        if (Array.isArray(condition.$nin))
            addNotAny(key, condition.$nin.filter(isScalar));
        addRange(key, {
            gt: condition.$gt,
            gte: condition.$gte,
            lt: condition.$lt,
            lte: condition.$lte,
        });
        // Best-effort: `$contains` works for array payloads in Qdrant (any element equals).
        if (isScalar(condition.$contains))
            addEq(key, condition.$contains);
    }
    if (must.length === 0 && must_not.length === 0)
        return undefined;
    const qFilter = {};
    if (must.length > 0)
        qFilter.must = must;
    if (must_not.length > 0)
        qFilter.must_not = must_not;
    return qFilter;
};
export class QdrantVectorStore {
    constructor() {
        this.isInitialized = false;
        this.providerId = `qdrant-${uuidv4().slice(0, 8)}`;
        this.baseUrl = '';
        this.timeoutMs = DEFAULT_TIMEOUT_MS;
        this.denseVectorName = DEFAULT_DENSE_VECTOR_NAME;
        this.bm25VectorName = DEFAULT_BM25_VECTOR_NAME;
        this.enableBm25 = true;
        this.headers = {
            'content-type': 'application/json',
        };
    }
    async initialize(config) {
        if (this.isInitialized) {
            console.warn(`[QdrantVectorStore:${this.providerId}] Re-initializing.`);
        }
        this.config = config;
        const baseUrl = coerceBaseUrl(this.config.url ?? '');
        if (!baseUrl) {
            throw new GMIError('QdrantVectorStore requires a non-empty `url`.', GMIErrorCode.CONFIG_ERROR, { providerId: this.config.id, type: this.config.type }, 'QdrantVectorStore');
        }
        const fetchImpl = this.config.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new GMIError('QdrantVectorStore requires `fetch` (Node 18+ / browser) or a `fetch` implementation in config.', GMIErrorCode.DEPENDENCY_ERROR, { providerId: this.config.id, type: this.config.type }, 'QdrantVectorStore');
        }
        this.baseUrl = baseUrl;
        this.timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.denseVectorName = this.config.denseVectorName ?? DEFAULT_DENSE_VECTOR_NAME;
        this.bm25VectorName = this.config.bm25VectorName ?? DEFAULT_BM25_VECTOR_NAME;
        this.enableBm25 = this.config.enableBm25 ?? true;
        this.fetchImpl = fetchImpl;
        const apiKey = this.config.apiKey?.trim();
        if (apiKey) {
            this.headers = {
                ...this.headers,
                // Qdrant uses `api-key` header for API keys.
                'api-key': apiKey,
            };
        }
        this.isInitialized = true;
    }
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new GMIError('QdrantVectorStore is not initialized. Call initialize() first.', GMIErrorCode.NOT_INITIALIZED, { provider: this.providerId }, 'QdrantVectorStore');
        }
    }
    async requestJson(input) {
        this.ensureInitialized();
        const url = `${this.baseUrl}${input.path.startsWith('/') ? '' : '/'}${input.path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const signal = input.signal ?? controller.signal;
        try {
            const resp = await this.fetchImpl(url, {
                method: input.method,
                headers: this.headers,
                body: input.body === undefined ? undefined : JSON.stringify(input.body),
                signal,
            });
            const contentType = resp.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');
            const text = await resp.text();
            const parsed = isJson && text ? JSON.parse(text) : text;
            if (!resp.ok) {
                throw new GMIError(`Qdrant request failed (${resp.status}) for ${input.method} ${input.path}`, GMIErrorCode.PROVIDER_ERROR, { status: resp.status, body: text?.slice(0, 2000) }, 'QdrantVectorStore');
            }
            return { status: resp.status, data: parsed, rawText: text };
        }
        catch (err) {
            if (err?.name === 'AbortError') {
                throw new GMIError(`Qdrant request timed out after ${this.timeoutMs}ms: ${input.method} ${input.path}`, GMIErrorCode.TIMEOUT, { timeoutMs: this.timeoutMs, method: input.method, path: input.path }, 'QdrantVectorStore');
            }
            if (GMIError.isGMIError?.(err))
                throw err;
            throw new GMIError(`Qdrant request error: ${String(err?.message ?? err)}`, GMIErrorCode.PROVIDER_ERROR, { method: input.method, path: input.path }, 'QdrantVectorStore', undefined, err);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async checkHealth() {
        if (!this.isInitialized) {
            return { isHealthy: false, details: 'Not initialized' };
        }
        try {
            // `/healthz` is supported by Qdrant. Use it first (no auth required).
            const resp = await this.fetchImpl(`${this.baseUrl}/healthz`, { method: 'GET' });
            if (resp.ok) {
                return { isHealthy: true, details: await resp.text().catch(() => undefined) };
            }
        }
        catch {
            // ignore and fall back
        }
        try {
            // Fallback: hit collections list endpoint (may require API key).
            await this.requestJson({ method: 'GET', path: '/collections' });
            return { isHealthy: true };
        }
        catch (err) {
            return { isHealthy: false, details: err?.message ?? String(err) };
        }
    }
    async shutdown() {
        // No persistent connections.
        this.isInitialized = false;
    }
    async collectionExists(collectionName) {
        this.ensureInitialized();
        const encoded = encodeURIComponent(collectionName);
        try {
            await this.requestJson({
                method: 'GET',
                path: `/collections/${encoded}`,
            });
            return true;
        }
        catch (err) {
            const status = err?.details?.status;
            if (status === 404)
                return false;
            // Provider errors can be thrown as GMIError with details.status.
            if (typeof status === 'number' && status === 404)
                return false;
            // Unknown: treat as error
            throw err;
        }
    }
    async createCollection(collectionName, dimension, options) {
        this.ensureInitialized();
        if (!Number.isFinite(dimension) || dimension <= 0) {
            throw new GMIError(`Invalid embedding dimension for collection '${collectionName}': ${dimension}`, GMIErrorCode.INVALID_ARGUMENT, { collectionName, dimension }, 'QdrantVectorStore');
        }
        const encoded = encodeURIComponent(collectionName);
        const similarityMetric = options?.similarityMetric ?? 'cosine';
        const distance = toDistance(similarityMetric);
        const exists = await (this.collectionExists ? this.collectionExists(collectionName) : Promise.resolve(false));
        if (exists) {
            if (options?.overwriteIfExists) {
                if (this.deleteCollection)
                    await this.deleteCollection(collectionName);
            }
            else {
                return;
            }
        }
        const body = {
            vectors: {
                [this.denseVectorName]: {
                    size: dimension,
                    distance,
                },
            },
        };
        if (this.enableBm25) {
            body.sparse_vectors = {
                [this.bm25VectorName]: {
                    modifier: 'idf',
                },
            };
        }
        await this.requestJson({
            method: 'PUT',
            path: `/collections/${encoded}`,
            body,
        });
    }
    async deleteCollection(collectionName) {
        this.ensureInitialized();
        const encoded = encodeURIComponent(collectionName);
        await this.requestJson({
            method: 'DELETE',
            path: `/collections/${encoded}`,
        });
    }
    async getStats(collectionName) {
        this.ensureInitialized();
        if (!collectionName) {
            const resp = await this.requestJson({
                method: 'GET',
                path: '/collections',
            });
            return resp.data;
        }
        const encoded = encodeURIComponent(collectionName);
        const resp = await this.requestJson({
            method: 'GET',
            path: `/collections/${encoded}`,
        });
        return resp.data;
    }
    async upsert(collectionName, documents, options) {
        this.ensureInitialized();
        const encoded = encodeURIComponent(collectionName);
        if (!Array.isArray(documents) || documents.length === 0) {
            return { upsertedCount: 0, failedCount: 0, upsertedIds: [] };
        }
        const batchSize = options?.batchSize ?? 64;
        const upsertedIds = [];
        const errors = [];
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const points = batch.map((doc) => {
                const payload = buildPayload(doc);
                const vector = {
                    [this.denseVectorName]: doc.embedding,
                };
                if (this.enableBm25 && typeof doc.textContent === 'string' && doc.textContent.trim()) {
                    vector[this.bm25VectorName] = {
                        text: doc.textContent,
                        model: DEFAULT_BM25_MODEL_ID,
                    };
                }
                return {
                    id: doc.id,
                    vector,
                    payload,
                };
            });
            try {
                await this.requestJson({
                    method: 'PUT',
                    path: `/collections/${encoded}/points?wait=true`,
                    body: { points },
                });
                for (const doc of batch)
                    upsertedIds.push(doc.id);
            }
            catch (err) {
                for (const doc of batch) {
                    errors.push({ id: doc.id, message: err?.message ?? String(err) });
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
    toRetrievedDocs(points, options) {
        const includeEmbedding = Boolean(options?.includeEmbedding);
        const includeMetadata = options?.includeMetadata !== false; // default true
        const includeText = Boolean(options?.includeTextContent);
        const docs = [];
        for (const p of points) {
            const payload = (p.payload ?? undefined);
            const textContent = includeText && payload && typeof payload[RESERVED_TEXT_PAYLOAD_KEY] === 'string'
                ? payload[RESERVED_TEXT_PAYLOAD_KEY]
                : undefined;
            let metadata;
            if (includeMetadata && payload && typeof payload === 'object') {
                metadata = {};
                for (const [key, value] of Object.entries(payload)) {
                    if (key === RESERVED_TEXT_PAYLOAD_KEY)
                        continue;
                    const sanitized = sanitizeMetadataValue(value);
                    if (sanitized === undefined)
                        continue;
                    metadata[key] = sanitized;
                }
            }
            let embedding;
            if (includeEmbedding && p.vector) {
                const vec = p.vector;
                if (Array.isArray(vec))
                    embedding = vec;
                else if (vec && typeof vec === 'object' && Array.isArray(vec[this.denseVectorName])) {
                    embedding = vec[this.denseVectorName];
                }
            }
            docs.push({
                id: safeStringId(p.id),
                embedding: embedding ?? [],
                metadata,
                textContent,
                similarityScore: typeof p.score === 'number' ? p.score : 0,
            });
        }
        return docs;
    }
    async query(collectionName, queryEmbedding, options) {
        this.ensureInitialized();
        const encoded = encodeURIComponent(collectionName);
        const topK = options?.topK ?? 10;
        const qFilter = buildQdrantFilter(options?.filter);
        const withPayload = Boolean(options?.includeMetadata !== false) || Boolean(options?.includeTextContent);
        const body = {
            query: queryEmbedding,
            using: this.denseVectorName,
            limit: topK,
            with_payload: withPayload,
            with_vector: Boolean(options?.includeEmbedding),
        };
        if (qFilter)
            body.filter = qFilter;
        if (typeof options?.minSimilarityScore === 'number')
            body.score_threshold = options.minSimilarityScore;
        const resp = await this.requestJson({
            method: 'POST',
            path: `/collections/${encoded}/points/query`,
            body,
        });
        const points = resp.data?.result?.points ?? [];
        return {
            documents: this.toRetrievedDocs(points, options),
            stats: resp.data?.time ? { time: resp.data.time } : undefined,
        };
    }
    async hybridSearch(collectionName, queryEmbedding, queryText, options) {
        this.ensureInitialized();
        const topK = options?.topK ?? 10;
        const qText = queryText?.trim() ?? '';
        if (!this.enableBm25 || !qText) {
            return this.query(collectionName, queryEmbedding, options);
        }
        const alphaRaw = options?.alpha ?? 0.7;
        const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.7;
        const fusion = options?.fusion ?? 'rrf';
        const rrfK = Number.isFinite(options?.rrfK) ? Math.max(1, Math.floor(options.rrfK)) : 60;
        const lexicalTopK = options?.lexicalTopK ?? Math.max(topK * 6, 50);
        const denseTopK = Math.max(topK * 6, 50);
        const qFilter = buildQdrantFilter(options?.filter);
        const withPayload = Boolean(options?.includeMetadata !== false) || Boolean(options?.includeTextContent);
        const encoded = encodeURIComponent(collectionName);
        // Fast path: server-side fusion (RRF). Note: Qdrant supports parameterized RRF in newer versions.
        if (fusion === 'rrf') {
            const queryField = typeof options?.rrfK === 'number'
                ? { rrf: { k: rrfK } } // Qdrant v1.16+
                : { fusion: 'rrf' }; // legacy
            const body = {
                prefetch: [
                    {
                        query: queryEmbedding,
                        using: this.denseVectorName,
                        limit: denseTopK,
                        with_payload: false,
                        with_vector: false,
                        ...(qFilter ? { filter: qFilter } : {}),
                    },
                    {
                        query: { text: qText, model: DEFAULT_BM25_MODEL_ID },
                        using: this.bm25VectorName,
                        limit: lexicalTopK,
                        with_payload: false,
                        with_vector: false,
                        ...(qFilter ? { filter: qFilter } : {}),
                    },
                ],
                query: queryField,
                limit: topK,
                with_payload: withPayload,
                with_vector: Boolean(options?.includeEmbedding),
            };
            if (qFilter)
                body.filter = qFilter;
            if (typeof options?.minSimilarityScore === 'number')
                body.score_threshold = options.minSimilarityScore;
            try {
                const resp = await this.requestJson({
                    method: 'POST',
                    path: `/collections/${encoded}/points/query`,
                    body,
                });
                const points = resp.data?.result?.points ?? [];
                return {
                    documents: this.toRetrievedDocs(points, options),
                    stats: resp.data?.time ? { time: resp.data.time } : undefined,
                };
            }
            catch (err) {
                // If the server doesn't support parameterized RRF, retry once with legacy fusion field.
                if (typeof options?.rrfK === 'number') {
                    const fallbackBody = { ...body, query: { fusion: 'rrf' } };
                    const resp = await this.requestJson({
                        method: 'POST',
                        path: `/collections/${encoded}/points/query`,
                        body: fallbackBody,
                    });
                    const points = resp.data?.result?.points ?? [];
                    return {
                        documents: this.toRetrievedDocs(points, options),
                        stats: resp.data?.time ? { time: resp.data.time } : undefined,
                    };
                }
                throw err;
            }
        }
        // Weighted fusion (client-side): two queries + weighted rank fusion.
        const denseResp = await this.requestJson({
            method: 'POST',
            path: `/collections/${encoded}/points/query`,
            body: {
                query: queryEmbedding,
                using: this.denseVectorName,
                limit: denseTopK,
                with_payload: withPayload,
                with_vector: Boolean(options?.includeEmbedding),
                ...(qFilter ? { filter: qFilter } : {}),
            },
        });
        const bm25Resp = await this.requestJson({
            method: 'POST',
            path: `/collections/${encoded}/points/query`,
            body: {
                query: { text: qText, model: DEFAULT_BM25_MODEL_ID },
                using: this.bm25VectorName,
                limit: lexicalTopK,
                with_payload: withPayload,
                with_vector: false,
                ...(qFilter ? { filter: qFilter } : {}),
            },
        });
        const densePoints = denseResp.data?.result?.points ?? [];
        const bm25Points = bm25Resp.data?.result?.points ?? [];
        const byId = new Map();
        const addRankScores = (points, weight) => {
            points.forEach((p, idx) => {
                const id = safeStringId(p.id);
                const rank = idx + 1;
                const rankScore = 1 / (rrfK + rank);
                const existing = byId.get(id);
                const nextScore = (existing?.score ?? 0) + weight * rankScore;
                // Prefer keeping richer payload/vector if present.
                const chosenPoint = existing?.point?.payload || existing?.point?.vector ? existing.point : p;
                byId.set(id, { point: chosenPoint, score: nextScore });
            });
        };
        addRankScores(densePoints, alpha);
        addRankScores(bm25Points, 1 - alpha);
        const fused = Array.from(byId.values());
        fused.sort((a, b) => b.score - a.score);
        const top = fused.slice(0, topK).map((entry) => ({
            ...entry.point,
            score: entry.score,
        }));
        return {
            documents: this.toRetrievedDocs(top, options),
            stats: {
                fusion: 'weighted_rank',
                alpha,
                rrfK,
            },
        };
    }
    async delete(collectionName, ids, options) {
        this.ensureInitialized();
        const encoded = encodeURIComponent(collectionName);
        if (options?.deleteAll) {
            // Deleting everything efficiently depends on the deployment.
            // Prefer `deleteCollection()` for destructive full wipe.
            throw new GMIError("QdrantVectorStore.delete(deleteAll=true) is not supported. Use deleteCollection() instead.", GMIErrorCode.NOT_SUPPORTED, { collectionName }, 'QdrantVectorStore');
        }
        const qFilter = buildQdrantFilter(options?.filter);
        if ((!ids || ids.length === 0) && !qFilter) {
            return { deletedCount: 0, failedCount: 0 };
        }
        const body = {};
        if (ids && ids.length > 0)
            body.points = ids;
        if (qFilter)
            body.filter = qFilter;
        try {
            await this.requestJson({
                method: 'POST',
                path: `/collections/${encoded}/points/delete?wait=true`,
                body,
            });
            return { deletedCount: ids?.length ?? 0, failedCount: 0 };
        }
        catch (err) {
            return {
                deletedCount: 0,
                failedCount: ids?.length ?? 1,
                errors: [{ message: err?.message ?? String(err) }],
            };
        }
    }
}
//# sourceMappingURL=QdrantVectorStore.js.map