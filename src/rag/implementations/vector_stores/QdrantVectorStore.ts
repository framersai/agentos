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
 * @module @framers/agentos/rag/implementations/vector_stores/QdrantVectorStore
 * @see ../../IVectorStore.ts for the interface definition.
 */

import type {
  IVectorStore,
  VectorStoreProviderConfig,
  VectorDocument,
  RetrievedVectorDocument,
  QueryOptions,
  QueryResult,
  UpsertOptions,
  UpsertResult,
  DeleteOptions,
  DeleteResult,
  CreateCollectionOptions,
  MetadataFilter,
  MetadataFieldCondition,
  MetadataScalarValue,
  MetadataValue,
} from '../../IVectorStore.js';
import { GMIError, GMIErrorCode } from '../../../utils/errors.js';
import { uuidv4 } from '../../../utils/uuid.js';

// ============================================================================
// Configuration Types
// ============================================================================

export interface QdrantVectorStoreConfig extends VectorStoreProviderConfig {
  type: 'qdrant';
  /** Base URL, e.g. `http://localhost:6333` or Qdrant Cloud endpoint. */
  url: string;
  /** Optional API key for Qdrant Cloud or secured self-host deployments. */
  apiKey?: string;
  /** Request timeout in milliseconds. Default: 15_000. */
  timeoutMs?: number;

  /** Named dense vector field. Default: `dense`. */
  denseVectorName?: string;
  /** Named BM25 sparse vector field. Default: `bm25`. */
  bm25VectorName?: string;

  /** Store BM25 sparse vectors and enable `hybridSearch()`. Default: true. */
  enableBm25?: boolean;

  /** Optional custom fetch implementation (testing/edge). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

// ============================================================================
// Qdrant HTTP Types (minimal subset)
// ============================================================================

type QdrantOkResponse<T> = {
  result: T;
  status?: 'ok';
  time?: number;
};

type QdrantPointId = string | number;

type QdrantScoredPoint = {
  id: QdrantPointId;
  score?: number;
  payload?: Record<string, unknown> | null;
  vector?: unknown;
};

type QdrantQueryResult = {
  points: QdrantScoredPoint[];
};

type QdrantCollectionInfo = {
  points_count?: number;
  indexed_vectors_count?: number;
  status?: string;
  optimizer_status?: string;
};

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DENSE_VECTOR_NAME = 'dense';
const DEFAULT_BM25_VECTOR_NAME = 'bm25';
const DEFAULT_BM25_MODEL_ID = 'qdrant/bm25';
const RESERVED_TEXT_PAYLOAD_KEY = '__text';

const coerceBaseUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

const toDistance = (
  metric: NonNullable<CreateCollectionOptions['similarityMetric']>,
): 'Cosine' | 'Euclid' | 'Dot' => {
  if (metric === 'euclidean') return 'Euclid';
  if (metric === 'dotproduct') return 'Dot';
  return 'Cosine';
};

const safeStringId = (id: QdrantPointId): string => (typeof id === 'string' ? id : String(id));

const isScalar = (value: unknown): value is MetadataScalarValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const sanitizeMetadataValue = (value: unknown): MetadataValue | undefined => {
  if (value === null || value === undefined) return undefined;
  if (isScalar(value)) return value;
  if (Array.isArray(value)) {
    const items: MetadataScalarValue[] = [];
    for (const item of value) {
      if (item === null || item === undefined) continue;
      if (isScalar(item)) items.push(item);
      else items.push(JSON.stringify(item));
    }
    return items;
  }
  // Fall back to JSON string to keep payload filterable/serializable.
  return JSON.stringify(value);
};

const buildPayload = (doc: VectorDocument): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (doc.textContent !== undefined) {
    payload[RESERVED_TEXT_PAYLOAD_KEY] = doc.textContent;
  }
  if (doc.metadata) {
    for (const [key, rawValue] of Object.entries(doc.metadata)) {
      const value = sanitizeMetadataValue(rawValue);
      if (value === undefined) continue;
      payload[key] = value as any;
    }
  }
  return payload;
};

type QdrantFilter = {
  must?: any[];
  must_not?: any[];
  should?: any[];
  min_should?: number;
};

const buildQdrantFilter = (filter: MetadataFilter | undefined): QdrantFilter | undefined => {
  if (!filter) return undefined;

  const must: any[] = [];
  const must_not: any[] = [];

  const addEq = (key: string, value: MetadataScalarValue) => {
    must.push({ key, match: { value } });
  };

  const addNe = (key: string, value: MetadataScalarValue) => {
    must_not.push({ key, match: { value } });
  };

  const addAny = (key: string, values: MetadataScalarValue[]) => {
    if (values.length === 0) return;
    must.push({ key, match: { any: values } });
  };

  const addNotAny = (key: string, values: MetadataScalarValue[]) => {
    if (values.length === 0) return;
    must_not.push({ key, match: { any: values } });
  };

  const addRange = (key: string, range: { gt?: number; gte?: number; lt?: number; lte?: number }) => {
    const normalized: any = {};
    if (typeof range.gt === 'number') normalized.gt = range.gt;
    if (typeof range.gte === 'number') normalized.gte = range.gte;
    if (typeof range.lt === 'number') normalized.lt = range.lt;
    if (typeof range.lte === 'number') normalized.lte = range.lte;
    if (Object.keys(normalized).length === 0) return;
    must.push({ key, range: normalized });
  };

  for (const [key, rawCondition] of Object.entries(filter)) {
    // Implicit equality
    if (isScalar(rawCondition)) {
      addEq(key, rawCondition);
      continue;
    }

    const condition = rawCondition as MetadataFieldCondition;
    if (isScalar(condition.$eq)) addEq(key, condition.$eq);
    if (isScalar(condition.$ne)) addNe(key, condition.$ne);
    if (Array.isArray(condition.$in)) addAny(key, condition.$in.filter(isScalar));
    if (Array.isArray(condition.$nin)) addNotAny(key, condition.$nin.filter(isScalar));

    addRange(key, {
      gt: condition.$gt,
      gte: condition.$gte,
      lt: condition.$lt,
      lte: condition.$lte,
    });

    // Best-effort: `$contains` works for array payloads in Qdrant (any element equals).
    if (isScalar(condition.$contains)) addEq(key, condition.$contains);
  }

  if (must.length === 0 && must_not.length === 0) return undefined;
  const qFilter: QdrantFilter = {};
  if (must.length > 0) qFilter.must = must;
  if (must_not.length > 0) qFilter.must_not = must_not;
  return qFilter;
};

export class QdrantVectorStore implements IVectorStore {
  private config!: QdrantVectorStoreConfig;
  private isInitialized: boolean = false;
  private readonly providerId: string = `qdrant-${uuidv4().slice(0, 8)}`;

  private baseUrl: string = '';
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private denseVectorName: string = DEFAULT_DENSE_VECTOR_NAME;
  private bm25VectorName: string = DEFAULT_BM25_VECTOR_NAME;
  private enableBm25: boolean = true;
  private fetchImpl!: typeof fetch;
  private headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  public async initialize(config: VectorStoreProviderConfig): Promise<void> {
    if (this.isInitialized) {
      console.warn(`[QdrantVectorStore:${this.providerId}] Re-initializing.`);
    }

    this.config = config as QdrantVectorStoreConfig;

    const baseUrl = coerceBaseUrl(this.config.url ?? '');
    if (!baseUrl) {
      throw new GMIError(
        'QdrantVectorStore requires a non-empty `url`.',
        GMIErrorCode.CONFIG_ERROR,
        { providerId: this.config.id, type: this.config.type },
        'QdrantVectorStore',
      );
    }

    const fetchImpl = this.config.fetch ?? (globalThis as any).fetch;
    if (typeof fetchImpl !== 'function') {
      throw new GMIError(
        'QdrantVectorStore requires `fetch` (Node 18+ / browser) or a `fetch` implementation in config.',
        GMIErrorCode.DEPENDENCY_ERROR,
        { providerId: this.config.id, type: this.config.type },
        'QdrantVectorStore',
      );
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

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new GMIError(
        'QdrantVectorStore is not initialized. Call initialize() first.',
        GMIErrorCode.NOT_INITIALIZED,
        { provider: this.providerId },
        'QdrantVectorStore',
      );
    }
  }

  private async requestJson<T>(input: {
    method: string;
    path: string;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ status: number; data: T; rawText?: string }> {
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
      const parsed = isJson && text ? (JSON.parse(text) as T) : ((text as any) as T);

      if (!resp.ok) {
        throw new GMIError(
          `Qdrant request failed (${resp.status}) for ${input.method} ${input.path}`,
          GMIErrorCode.PROVIDER_ERROR,
          { status: resp.status, body: text?.slice(0, 2_000) },
          'QdrantVectorStore',
        );
      }

      return { status: resp.status, data: parsed, rawText: text };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new GMIError(
          `Qdrant request timed out after ${this.timeoutMs}ms: ${input.method} ${input.path}`,
          GMIErrorCode.TIMEOUT,
          { timeoutMs: this.timeoutMs, method: input.method, path: input.path },
          'QdrantVectorStore',
        );
      }
      if (GMIError.isGMIError?.(err)) throw err;
      throw new GMIError(
        `Qdrant request error: ${String(err?.message ?? err)}`,
        GMIErrorCode.PROVIDER_ERROR,
        { method: input.method, path: input.path },
        'QdrantVectorStore',
        undefined,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  public async checkHealth(): Promise<{ isHealthy: boolean; details?: any }> {
    if (!this.isInitialized) {
      return { isHealthy: false, details: 'Not initialized' };
    }

    try {
      // `/healthz` is supported by Qdrant. Use it first (no auth required).
      const resp = await this.fetchImpl(`${this.baseUrl}/healthz`, { method: 'GET' });
      if (resp.ok) {
        return { isHealthy: true, details: await resp.text().catch(() => undefined) };
      }
    } catch {
      // ignore and fall back
    }

    try {
      // Fallback: hit collections list endpoint (may require API key).
      await this.requestJson<QdrantOkResponse<any>>({ method: 'GET', path: '/collections' });
      return { isHealthy: true };
    } catch (err: any) {
      return { isHealthy: false, details: err?.message ?? String(err) };
    }
  }

  public async shutdown(): Promise<void> {
    // No persistent connections.
    this.isInitialized = false;
  }

  public async collectionExists(collectionName: string): Promise<boolean> {
    this.ensureInitialized();
    const encoded = encodeURIComponent(collectionName);
    try {
      await this.requestJson<QdrantOkResponse<{ collection: QdrantCollectionInfo }>>({
        method: 'GET',
        path: `/collections/${encoded}`,
      });
      return true;
    } catch (err: any) {
      const status = (err as any)?.details?.status;
      if (status === 404) return false;
      // Provider errors can be thrown as GMIError with details.status.
      if (typeof status === 'number' && status === 404) return false;
      // Unknown: treat as error
      throw err;
    }
  }

  public async createCollection(
    collectionName: string,
    dimension: number,
    options?: CreateCollectionOptions,
  ): Promise<void> {
    this.ensureInitialized();
    if (!Number.isFinite(dimension) || dimension <= 0) {
      throw new GMIError(
        `Invalid embedding dimension for collection '${collectionName}': ${dimension}`,
        GMIErrorCode.INVALID_ARGUMENT,
        { collectionName, dimension },
        'QdrantVectorStore',
      );
    }

    const encoded = encodeURIComponent(collectionName);
    const similarityMetric = options?.similarityMetric ?? 'cosine';
    const distance = toDistance(similarityMetric);

    const exists = await (this.collectionExists ? this.collectionExists(collectionName) : Promise.resolve(false));
    if (exists) {
      if (options?.overwriteIfExists) {
        if (this.deleteCollection) await this.deleteCollection(collectionName);
      } else {
        return;
      }
    }

    const body: any = {
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

    await this.requestJson<QdrantOkResponse<boolean>>({
      method: 'PUT',
      path: `/collections/${encoded}`,
      body,
    });
  }

  public async deleteCollection(collectionName: string): Promise<void> {
    this.ensureInitialized();
    const encoded = encodeURIComponent(collectionName);
    await this.requestJson<QdrantOkResponse<boolean>>({
      method: 'DELETE',
      path: `/collections/${encoded}`,
    });
  }

  public async getStats(collectionName?: string): Promise<Record<string, any>> {
    this.ensureInitialized();
    if (!collectionName) {
      const resp = await this.requestJson<QdrantOkResponse<{ collections: Array<{ name: string }> }>>({
        method: 'GET',
        path: '/collections',
      });
      return resp.data;
    }

    const encoded = encodeURIComponent(collectionName);
    const resp = await this.requestJson<QdrantOkResponse<{ collection: QdrantCollectionInfo }>>({
      method: 'GET',
      path: `/collections/${encoded}`,
    });
    return resp.data;
  }

  public async upsert(
    collectionName: string,
    documents: VectorDocument[],
    options?: UpsertOptions,
  ): Promise<UpsertResult> {
    this.ensureInitialized();
    const encoded = encodeURIComponent(collectionName);

    if (!Array.isArray(documents) || documents.length === 0) {
      return { upsertedCount: 0, failedCount: 0, upsertedIds: [] };
    }

    const batchSize = options?.batchSize ?? 64;
    const upsertedIds: string[] = [];
    const errors: Array<{ id: string; message: string; details?: any }> = [];

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const points = batch.map((doc) => {
        const payload = buildPayload(doc);
        const vector: any = {
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
        await this.requestJson<QdrantOkResponse<{ operation_id?: number }>>({
          method: 'PUT',
          path: `/collections/${encoded}/points?wait=true`,
          body: { points },
        });
        for (const doc of batch) upsertedIds.push(doc.id);
      } catch (err: any) {
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

  private toRetrievedDocs(points: QdrantScoredPoint[], options?: QueryOptions): RetrievedVectorDocument[] {
    const includeEmbedding = Boolean(options?.includeEmbedding);
    const includeMetadata = options?.includeMetadata !== false; // default true
    const includeText = Boolean(options?.includeTextContent);

    const docs: RetrievedVectorDocument[] = [];
    for (const p of points) {
      const payload = (p.payload ?? undefined) as any;
      const textContent =
        includeText && payload && typeof payload[RESERVED_TEXT_PAYLOAD_KEY] === 'string'
          ? (payload[RESERVED_TEXT_PAYLOAD_KEY] as string)
          : undefined;

      let metadata: Record<string, MetadataValue> | undefined;
      if (includeMetadata && payload && typeof payload === 'object') {
        metadata = {};
        for (const [key, value] of Object.entries(payload)) {
          if (key === RESERVED_TEXT_PAYLOAD_KEY) continue;
          const sanitized = sanitizeMetadataValue(value);
          if (sanitized === undefined) continue;
          (metadata as any)[key] = sanitized;
        }
      }

      let embedding: number[] | undefined;
      if (includeEmbedding && p.vector) {
        const vec: any = p.vector as any;
        if (Array.isArray(vec)) embedding = vec as number[];
        else if (vec && typeof vec === 'object' && Array.isArray(vec[this.denseVectorName])) {
          embedding = vec[this.denseVectorName] as number[];
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

  public async query(
    collectionName: string,
    queryEmbedding: number[],
    options?: QueryOptions,
  ): Promise<QueryResult> {
    this.ensureInitialized();
    const encoded = encodeURIComponent(collectionName);
    const topK = options?.topK ?? 10;

    const qFilter = buildQdrantFilter(options?.filter);
    const withPayload = Boolean(options?.includeMetadata !== false) || Boolean(options?.includeTextContent);

    const body: any = {
      query: queryEmbedding,
      using: this.denseVectorName,
      limit: topK,
      with_payload: withPayload,
      with_vector: Boolean(options?.includeEmbedding),
    };

    if (qFilter) body.filter = qFilter;
    if (typeof options?.minSimilarityScore === 'number') body.score_threshold = options.minSimilarityScore;

    const resp = await this.requestJson<QdrantOkResponse<QdrantQueryResult>>({
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

  public async hybridSearch(
    collectionName: string,
    queryEmbedding: number[],
    queryText: string,
    options?: QueryOptions & {
      alpha?: number;
      fusion?: 'rrf' | 'weighted';
      rrfK?: number;
      lexicalTopK?: number;
    },
  ): Promise<QueryResult> {
    this.ensureInitialized();
    const topK = options?.topK ?? 10;
    const qText = queryText?.trim() ?? '';

    if (!this.enableBm25 || !qText) {
      return this.query(collectionName, queryEmbedding, options);
    }

    const alphaRaw = options?.alpha ?? 0.7;
    const alpha = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 0.7;
    const fusion = options?.fusion ?? 'rrf';
    const rrfK = Number.isFinite(options?.rrfK) ? Math.max(1, Math.floor(options!.rrfK!)) : 60;
    const lexicalTopK = options?.lexicalTopK ?? Math.max(topK * 6, 50);
    const denseTopK = Math.max(topK * 6, 50);

    const qFilter = buildQdrantFilter(options?.filter);
    const withPayload = Boolean(options?.includeMetadata !== false) || Boolean(options?.includeTextContent);

    const encoded = encodeURIComponent(collectionName);

    // Fast path: server-side fusion (RRF). Note: Qdrant supports parameterized RRF in newer versions.
    if (fusion === 'rrf') {
      const queryField: any =
        typeof options?.rrfK === 'number'
          ? { rrf: { k: rrfK } } // Qdrant v1.16+
          : { fusion: 'rrf' };   // legacy

      const body: any = {
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
      if (qFilter) body.filter = qFilter;
      if (typeof options?.minSimilarityScore === 'number') body.score_threshold = options.minSimilarityScore;

      try {
        const resp = await this.requestJson<QdrantOkResponse<QdrantQueryResult>>({
          method: 'POST',
          path: `/collections/${encoded}/points/query`,
          body,
        });

        const points = resp.data?.result?.points ?? [];
        return {
          documents: this.toRetrievedDocs(points, options),
          stats: resp.data?.time ? { time: resp.data.time } : undefined,
        };
      } catch (err: any) {
        // If the server doesn't support parameterized RRF, retry once with legacy fusion field.
        if (typeof options?.rrfK === 'number') {
          const fallbackBody = { ...body, query: { fusion: 'rrf' } };
          const resp = await this.requestJson<QdrantOkResponse<QdrantQueryResult>>({
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
    const denseResp = await this.requestJson<QdrantOkResponse<QdrantQueryResult>>({
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

    const bm25Resp = await this.requestJson<QdrantOkResponse<QdrantQueryResult>>({
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

    const byId = new Map<string, { point: QdrantScoredPoint; score: number }>();

    const addRankScores = (points: QdrantScoredPoint[], weight: number) => {
      points.forEach((p, idx) => {
        const id = safeStringId(p.id);
        const rank = idx + 1;
        const rankScore = 1 / (rrfK + rank);
        const existing = byId.get(id);
        const nextScore = (existing?.score ?? 0) + weight * rankScore;
        // Prefer keeping richer payload/vector if present.
        const chosenPoint =
          existing?.point?.payload || existing?.point?.vector ? existing.point : p;
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

  public async delete(
    collectionName: string,
    ids?: string[],
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    this.ensureInitialized();
    const encoded = encodeURIComponent(collectionName);

    if (options?.deleteAll) {
      // Deleting everything efficiently depends on the deployment.
      // Prefer `deleteCollection()` for destructive full wipe.
      throw new GMIError(
        "QdrantVectorStore.delete(deleteAll=true) is not supported. Use deleteCollection() instead.",
        GMIErrorCode.NOT_SUPPORTED,
        { collectionName },
        'QdrantVectorStore',
      );
    }

    const qFilter = buildQdrantFilter(options?.filter);
    if ((!ids || ids.length === 0) && !qFilter) {
      return { deletedCount: 0, failedCount: 0 };
    }

    const body: any = {};
    if (ids && ids.length > 0) body.points = ids;
    if (qFilter) body.filter = qFilter;

    try {
      await this.requestJson<QdrantOkResponse<{ operation_id?: number }>>({
        method: 'POST',
        path: `/collections/${encoded}/points/delete?wait=true`,
        body,
      });
      return { deletedCount: ids?.length ?? 0, failedCount: 0 };
    } catch (err: any) {
      return {
        deletedCount: 0,
        failedCount: ids?.length ?? 1,
        errors: [{ message: err?.message ?? String(err) }],
      };
    }
  }
}
