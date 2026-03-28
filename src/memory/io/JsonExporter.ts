/**
 * @fileoverview JSON exporter for AgentOS memory brain.
 *
 * Serialises all memory traces, knowledge graph nodes/edges, documents, and
 * conversations from a `SqliteBrain` into a single structured JSON file.
 * Optionally includes raw embedding vectors encoded as base64 strings.
 *
 * ## Output shape
 * ```json
 * {
 *   "meta": { "schema_version": "1", "exported_at": 1711234567890, ... },
 *   "traces": [...],
 *   "nodes": [...],
 *   "edges": [...],
 *   "documents": [...],
 *   "conversations": [...]
 * }
 * ```
 *
 * @module memory/io/JsonExporter
 */

import type { ExportOptions } from '../facade/types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';
import { asBinaryBytes, bytesToBase64 } from './base64.js';

// ---------------------------------------------------------------------------
// Row types (internal — matched to SqliteBrain DDL)
// ---------------------------------------------------------------------------

/** Raw row shape from the `memory_traces` table. */
interface TraceRow {
  id: string;
  type: string;
  scope: string;
  content: string;
  embedding: Uint8Array | null;
  strength: number;
  created_at: number;
  last_accessed: number | null;
  retrieval_count: number;
  tags: string;
  emotions: string;
  metadata: string;
  deleted: number;
}

/** Raw row shape from the `knowledge_nodes` table. */
interface NodeRow {
  id: string;
  type: string;
  label: string;
  properties: string;
  embedding: Uint8Array | null;
  confidence: number;
  source: string;
  created_at: number;
}

/** Raw row shape from the `knowledge_edges` table. */
interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  bidirectional: number;
  metadata: string;
  created_at: number;
}

/** Raw row shape from the `documents` table. */
interface DocumentRow {
  id: string;
  path: string;
  format: string;
  title: string | null;
  content_hash: string;
  chunk_count: number;
  metadata: string;
  ingested_at: number;
}

/** Raw row shape from the `conversations` table. */
interface ConversationRow {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  metadata: string;
}

// ---------------------------------------------------------------------------
// JsonExporter
// ---------------------------------------------------------------------------

/**
 * Exports a `SqliteBrain` to a structured JSON file.
 *
 * **Usage:**
 * ```ts
 * const exporter = new JsonExporter(brain);
 * await exporter.export('/path/to/export.json', { includeEmbeddings: false });
 * ```
 */
export class JsonExporter {
  /**
   * @param brain - The `SqliteBrain` instance to read from.
   */
  constructor(private readonly brain: SqliteBrain) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Export the full brain state to a JSON file at `outputPath`.
   *
   * @param outputPath       - Absolute path to write the JSON output.
   * @param options          - Optional export configuration.
   * @param options.includeEmbeddings   - When `true`, raw embedding BLOBs are
   *   encoded as base64 strings and included in the output. Defaults to `false`.
   * @param options.includeConversations - When `false`, conversation rows are
   *   omitted from the output. Defaults to `true`.
   */
  async export(outputPath: string, options?: ExportOptions): Promise<void> {
    const payload = await this._buildPayload(options);
    const fs = await import('node:fs/promises');
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  /**
   * Export the full brain state as a JSON string without filesystem access.
   *
   * @param options - Optional export configuration (embeddings, conversations).
   * @returns Pretty-printed JSON string of the full brain payload.
   */
  async exportToString(options?: ExportOptions): Promise<string> {
    const payload = await this._buildPayload(options);
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Build the full export payload from the brain database.
   *
   * @param options - Optional export configuration.
   * @returns The structured payload object ready for serialisation.
   */
  private async _buildPayload(options?: ExportOptions): Promise<Record<string, unknown>> {
    const includeEmbeddings = options?.includeEmbeddings ?? false;
    const includeConversations = options?.includeConversations ?? true;

    // Collect brain_meta as a plain object for the `meta` field.
    const metaRows = await this.brain.all<{ key: string; value: string }>(
      'SELECT key, value FROM brain_meta',
    );
    const meta: Record<string, string> = {};
    for (const row of metaRows) {
      meta[row.key] = row.value;
    }
    meta['exported_at'] = String(Date.now());

    // ---- memory_traces ----
    const rawTraces = await this.brain.all<TraceRow>('SELECT * FROM memory_traces');
    const traces = rawTraces.map((row) => this._serializeTrace(row, includeEmbeddings));

    // ---- knowledge_nodes ----
    const rawNodes = await this.brain.all<NodeRow>('SELECT * FROM knowledge_nodes');
    const nodes = rawNodes.map((row) => this._serializeNode(row, includeEmbeddings));

    // ---- knowledge_edges ----
    const edges = await this.brain.all<EdgeRow>('SELECT * FROM knowledge_edges');

    // ---- documents ----
    const documents = await this.brain.all<DocumentRow>('SELECT * FROM documents');

    // ---- conversations ----
    const conversations: ConversationRow[] = includeConversations
      ? await this.brain.all<ConversationRow>('SELECT * FROM conversations')
      : [];

    return {
      meta,
      traces,
      nodes,
      edges,
      documents,
      conversations,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Serialise a single `memory_traces` row, optionally stripping the embedding.
   *
   * @param row               - Raw DB row.
   * @param includeEmbeddings - Whether to encode the BLOB as base64.
   * @returns Plain JS object safe for JSON serialisation.
   */
  private _serializeTrace(row: TraceRow, includeEmbeddings: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    const embedding = asBinaryBytes(row.embedding);
    if (embedding) {
      out['embedding'] = includeEmbeddings ? bytesToBase64(embedding) : undefined;
    }
    return out;
  }

  /**
   * Serialise a single `knowledge_nodes` row, optionally stripping the embedding.
   *
   * @param row               - Raw DB row.
   * @param includeEmbeddings - Whether to encode the BLOB as base64.
   * @returns Plain JS object safe for JSON serialisation.
   */
  private _serializeNode(row: NodeRow, includeEmbeddings: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    const embedding = asBinaryBytes(row.embedding);
    if (embedding) {
      out['embedding'] = includeEmbeddings ? bytesToBase64(embedding) : undefined;
    }
    return out;
  }
}
