/**
 * @fileoverview Qdrant source adapter for the migration engine.
 * @module rag/migration/adapters/QdrantSourceAdapter
 *
 * Reads vectors from Qdrant collections using the scroll API.
 * Non-vector data (knowledge graph, documents, etc.) is read from
 * the sidecar SQLite file that accompanies Qdrant deployments.
 */

import type { IMigrationSource } from '../types.js';

/** Tables stored as Qdrant collections (vector data). */
const QDRANT_COLLECTIONS = ['memory_traces', 'document_chunks'];

/** Tables stored in the sidecar SQLite file (non-vector data). */
const SIDECAR_TABLES = [
  'brain_meta', 'knowledge_nodes', 'knowledge_edges',
  'documents', 'document_images', 'consolidation_log',
  'retrieval_feedback', 'conversations', 'messages',
];

export class QdrantSourceAdapter implements IMigrationSource {
  private sidecarDb: any = null; // better-sqlite3 Database for non-vector tables

  /**
   * @param url    - Qdrant base URL (e.g. 'http://localhost:6333').
   * @param apiKey - Optional API key for cloud instances.
   */
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
  ) {}

  /** Build fetch headers with optional API key. */
  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  /**
   * List available tables/collections.
   * Combines Qdrant collections and sidecar SQLite tables.
   */
  async listTables(): Promise<string[]> {
    const tables: string[] = [];

    // Check which Qdrant collections exist.
    try {
      const res = await fetch(`${this.url}/collections`, { headers: this._headers() });
      if (res.ok) {
        const data = await res.json() as { result: { collections: { name: string }[] } };
        const names = new Set(data.result.collections.map(c => c.name));
        for (const t of QDRANT_COLLECTIONS) {
          if (names.has(t)) tables.push(t);
        }
      }
    } catch {
      // Qdrant not reachable — skip vector tables.
    }

    // Check sidecar SQLite tables.
    // Sidecar path convention: same directory as Qdrant data, file 'sidecar.sqlite'.
    // For source adapter, this is typically not needed (data comes from the API).
    // We include sidecar tables only if the sidecar DB path is available via env.
    // TODO: Accept sidecar path in constructor for full migration support.

    return tables;
  }

  /** Count points in a Qdrant collection. */
  async countRows(table: string): Promise<number> {
    if (QDRANT_COLLECTIONS.includes(table)) {
      const res = await fetch(`${this.url}/collections/${table}`, { headers: this._headers() });
      if (res.ok) {
        const data = await res.json() as { result: { points_count: number } };
        return data.result.points_count;
      }
    }
    return 0;
  }

  /**
   * Read a batch of points from a Qdrant collection using the scroll API.
   * Converts Qdrant point format to flat row objects.
   */
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    if (!QDRANT_COLLECTIONS.includes(table)) return [];

    const body = JSON.stringify({
      limit,
      offset,
      with_payload: true,
      with_vector: true,
    });

    const res = await fetch(`${this.url}/collections/${table}/points/scroll`, {
      method: 'POST',
      headers: this._headers(),
      body,
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      result: { points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> };
    };

    // Flatten Qdrant point structure into row objects.
    return data.result.points.map(pt => ({
      id: String(pt.id),
      embedding: pt.vector,
      ...pt.payload,
    }));
  }

  /** Close connections. */
  async close(): Promise<void> {
    if (this.sidecarDb) {
      this.sidecarDb.close();
      this.sidecarDb = null;
    }
  }
}
