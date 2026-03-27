/**
 * @fileoverview Qdrant target adapter for the migration engine.
 * @module rag/migration/adapters/QdrantTargetAdapter
 *
 * Writes vector data to Qdrant collections and non-vector data
 * to a sidecar SQLite file. Creates collections with appropriate
 * vector configuration on first write.
 */

import type { IMigrationTarget } from '../types.js';

/** Tables that go into Qdrant as point collections. */
const QDRANT_COLLECTIONS = new Set(['memory_traces', 'document_chunks']);

export class QdrantTargetAdapter implements IMigrationTarget {
  private createdCollections = new Set<string>();
  private sidecarDb: any = null; // For non-vector tables

  /**
   * @param url    - Qdrant base URL.
   * @param apiKey - Optional API key for cloud instances.
   */
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
  ) {}

  /** Build fetch headers. */
  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  /**
   * Ensure a Qdrant collection exists with the correct vector configuration.
   * For non-vector tables, ensures the sidecar SQLite file has the table.
   */
  async ensureTable(table: string, sampleRow: Record<string, unknown>): Promise<void> {
    if (this.createdCollections.has(table)) return;

    if (QDRANT_COLLECTIONS.has(table)) {
      // Determine vector dimensions from sample row.
      const embedding = sampleRow['embedding'];
      const dim = Array.isArray(embedding)
        ? embedding.length
        : (embedding instanceof Buffer ? embedding.byteLength / 4 : 1536);

      // Check if collection already exists.
      const checkRes = await fetch(`${this.url}/collections/${table}`, {
        headers: this._headers(),
      });

      if (!checkRes.ok) {
        // Create the collection with cosine distance.
        await fetch(`${this.url}/collections/${table}`, {
          method: 'PUT',
          headers: this._headers(),
          body: JSON.stringify({
            vectors: { size: dim, distance: 'Cosine' },
          }),
        });
      }

      this.createdCollections.add(table);
    }
    // Non-vector tables would go to sidecar SQLite — not implemented here.
    // TODO: Wire sidecar SQLite for graph/document metadata tables.
  }

  /**
   * Write a batch of rows as Qdrant points.
   * Extracts `id` and `embedding` fields; everything else becomes payload.
   */
  async writeBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (rows.length === 0) return 0;

    if (QDRANT_COLLECTIONS.has(table)) {
      // Convert rows to Qdrant point format.
      const points = rows.map(row => {
        const { id, embedding, ...payload } = row;
        // Convert Buffer embedding to number[] if needed.
        let vector: number[];
        if (embedding instanceof Buffer) {
          const f32 = new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4);
          vector = Array.from(f32);
        } else if (Array.isArray(embedding)) {
          vector = embedding as number[];
        } else {
          vector = []; // Fallback — shouldn't happen.
        }

        return {
          id: String(id),
          vector,
          payload,
        };
      });

      // Upsert points in a single batch request.
      const res = await fetch(`${this.url}/collections/${table}/points`, {
        method: 'PUT',
        headers: this._headers(),
        body: JSON.stringify({ points }),
      });

      return res.ok ? points.length : 0;
    }

    // Non-vector tables: would write to sidecar SQLite.
    // TODO: Implement sidecar write for graph/metadata tables.
    return 0;
  }

  /** Close connections. */
  async close(): Promise<void> {
    if (this.sidecarDb) {
      this.sidecarDb.close();
      this.sidecarDb = null;
    }
  }
}
