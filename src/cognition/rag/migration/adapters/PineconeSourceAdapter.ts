/**
 * @fileoverview Pinecone source adapter for the migration engine.
 * @module rag/migration/adapters/PineconeSourceAdapter
 *
 * Reads vectors from Pinecone using the list + fetch API.
 * Non-vector data (knowledge graph, etc.) is not stored in Pinecone.
 */

import type { IMigrationSource } from '../types.js';

export class PineconeSourceAdapter implements IMigrationSource {
  constructor(
    private readonly indexHost: string,
    private readonly apiKey: string,
    private readonly namespace = '',
  ) {}

  private _headers(): Record<string, string> {
    return { 'Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** Pinecone only stores vector data — returns single "table". */
  async listTables(): Promise<string[]> {
    return ['memory_traces'];
  }

  /** Count vectors via describe_index_stats. */
  async countRows(_table: string): Promise<number> {
    const res = await fetch(`${this.indexHost}/describe_index_stats`, {
      method: 'POST',
      headers: this._headers(),
      body: '{}',
    });
    if (!res.ok) return 0;
    const data = await res.json() as {
      namespaces?: Record<string, { vectorCount?: number }>;
      totalVectorCount?: number;
    };
    if (this.namespace && data.namespaces?.[this.namespace]) {
      return data.namespaces[this.namespace].vectorCount ?? 0;
    }
    return data.totalVectorCount ?? 0;
  }

  /** Read vectors via list + fetch. Pinecone doesn't support offset-based pagination well. */
  async readBatch(_table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    // Use list endpoint to get IDs, then fetch to get vectors + metadata.
    const listRes = await fetch(
      `${this.indexHost}/vectors/list?namespace=${encodeURIComponent(this.namespace)}&limit=${limit}`,
      { headers: this._headers() },
    );
    if (!listRes.ok) return [];

    const listData = await listRes.json() as { vectors?: Array<{ id: string }> };
    const ids = (listData.vectors ?? []).map(v => v.id);
    if (ids.length === 0) return [];

    // Fetch full vectors by ID.
    const fetchRes = await fetch(`${this.indexHost}/vectors/fetch`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ ids, namespace: this.namespace }),
    });
    if (!fetchRes.ok) return [];

    const fetchData = await fetchRes.json() as {
      vectors?: Record<string, { id: string; values: number[]; metadata?: Record<string, unknown> }>;
    };

    return Object.values(fetchData.vectors ?? {}).map(v => ({
      id: v.id,
      embedding: v.values,
      ...v.metadata,
    }));
  }

  async close(): Promise<void> {}
}
