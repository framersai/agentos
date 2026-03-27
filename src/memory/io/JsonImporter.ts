/**
 * @fileoverview JSON importer for AgentOS memory brain.
 *
 * Reads a JSON file produced by `JsonExporter` (or a compatible schema) and
 * merges its traces, knowledge nodes, and edges into a target `SqliteBrain`.
 * Deduplication is performed via SHA-256 content hash — any trace whose hash
 * already exists in the target brain is skipped rather than duplicated.
 *
 * @module memory/io/JsonImporter
 */

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { ImportResult } from '../facade/types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Expected shape of the JSON file produced by `JsonExporter`.
 * All fields except `traces` are optional so the importer is forgiving of
 * partial exports.
 */
interface BrainExportPayload {
  meta?: Record<string, string>;
  traces: TraceRecord[];
  nodes?: NodeRecord[];
  edges?: EdgeRecord[];
  documents?: DocumentRecord[];
  conversations?: ConversationRecord[];
}

/** Serialised memory trace from the export file. */
interface TraceRecord {
  id?: string;
  type?: string;
  scope?: string;
  content: string;
  embedding?: string | null;   // base64 when present
  strength?: number;
  created_at?: number;
  last_accessed?: number | null;
  retrieval_count?: number;
  tags?: string;
  emotions?: string;
  metadata?: string;
  deleted?: number;
}

/** Serialised knowledge node. */
interface NodeRecord {
  id?: string;
  type?: string;
  label?: string;
  properties?: string;
  embedding?: string | null;
  confidence?: number;
  source?: string;
  created_at?: number;
}

/** Serialised knowledge edge. */
interface EdgeRecord {
  id?: string;
  source_id?: string;
  target_id?: string;
  type?: string;
  weight?: number;
  bidirectional?: number;
  metadata?: string;
  created_at?: number;
}

/** Serialised document record. */
interface DocumentRecord {
  id?: string;
  path?: string;
  format?: string;
  title?: string | null;
  content_hash?: string;
  chunk_count?: number;
  metadata?: string;
  ingested_at?: number;
}

/** Serialised conversation record. */
interface ConversationRecord {
  id?: string;
  title?: string | null;
  created_at?: number;
  updated_at?: number;
  metadata?: string;
}

// ---------------------------------------------------------------------------
// JsonImporter
// ---------------------------------------------------------------------------

/**
 * Imports a `JsonExporter`-compatible JSON file into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new JsonImporter(brain);
 * const result = await importer.import('/path/to/export.json');
 * console.log(result.imported, result.skipped, result.errors);
 * ```
 */
export class JsonImporter {
  /**
   * @param brain - The target `SqliteBrain` to import into.
   */
  constructor(private readonly brain: SqliteBrain) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Read and merge a JSON export file into the target brain.
   *
   * Validation:
   * - The file must be valid JSON.
   * - The top-level object must contain a `traces` array.
   *
   * Deduplication:
   * - For `memory_traces`: SHA-256 of `content` is used as the dedup key.
   *   Existing rows with the same hash are skipped.
   * - For `knowledge_nodes`: SHA-256 of `label` + `type`.
   * - For `knowledge_edges`: SHA-256 of `source_id` + `target_id` + `type`.
   *
   * @param sourcePath - Absolute path to the JSON file to import.
   * @returns `ImportResult` with counts of imported, skipped, and errored items.
   */
  async import(sourcePath: string): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    // ---- Load + parse ----
    let raw: string;
    try {
      raw = await fs.readFile(sourcePath, 'utf8');
    } catch (err) {
      result.errors.push(`Failed to read file: ${String(err)}`);
      return result;
    }

    let payload: BrainExportPayload;
    try {
      payload = JSON.parse(raw) as BrainExportPayload;
    } catch (err) {
      result.errors.push(`Invalid JSON: ${String(err)}`);
      return result;
    }

    if (!Array.isArray(payload.traces)) {
      result.errors.push('Invalid export format: missing top-level "traces" array.');
      return result;
    }

    // ---- Import in a single transaction for atomicity ----
    await this.brain.transaction(async (trx) => {
      await this._importTraces(trx, payload.traces, result);
      await this._importNodes(trx, payload.nodes ?? [], result);
      await this._importEdges(trx, payload.edges ?? [], result);
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a SHA-256 hex digest of arbitrary string content.
   * Used as a stable dedup key across import operations.
   *
   * @param content - The string to hash.
   * @returns 64-character lowercase hex string.
   */
  private _sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Import memory trace records into `memory_traces`.
   *
   * Each trace is deduplicated by the SHA-256 of its `content` field.
   * If a trace with the same content hash already exists, it is skipped.
   *
   * @param trx    - Transactional storage adapter.
   * @param traces - Array of serialised trace objects from the export.
   * @param result - Mutable `ImportResult` to accumulate counts.
   */
  private async _importTraces(
    trx: { run: SqliteBrain['run']; get: SqliteBrain['get'] },
    traces: TraceRecord[],
    result: ImportResult,
  ): Promise<void> {
    const { dialect } = this.brain.features;
    const checkSql = `SELECT id FROM memory_traces WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ? LIMIT 1`;

    const insertSql = `INSERT INTO memory_traces
         (id, type, scope, content, embedding, strength, created_at, last_accessed,
          retrieval_count, tags, emotions, metadata, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const t of traces) {
      try {
        const hash = this._sha256(t.content);
        const existing = await trx.get<{ id: string }>(checkSql, [hash]);
        if (existing) {
          result.skipped++;
          continue;
        }

        // Merge import_hash into the metadata JSON so future imports can dedup.
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(t.metadata ?? '{}') as Record<string, unknown>;
        } catch {
          // If metadata is malformed, start fresh.
        }
        meta['import_hash'] = hash;

        // Decode embedding if present.
        let embeddingBuf: Buffer | null = null;
        if (typeof t.embedding === 'string') {
          embeddingBuf = Buffer.from(t.embedding, 'base64');
        }

        await trx.run(insertSql, [
          t.id ?? `mt_${uuidv4()}`,
          t.type ?? 'episodic',
          t.scope ?? 'user',
          t.content,
          embeddingBuf,
          t.strength ?? 1.0,
          t.created_at ?? Date.now(),
          t.last_accessed ?? null,
          t.retrieval_count ?? 0,
          t.tags ?? '[]',
          t.emotions ?? '{}',
          JSON.stringify(meta),
          t.deleted ?? 0,
        ]);

        result.imported++;
      } catch (err) {
        result.errors.push(`Trace import error: ${String(err)}`);
      }
    }
  }

  /**
   * Import knowledge node records into `knowledge_nodes`.
   *
   * Dedup key: SHA-256 of `label` concatenated with `type`.
   *
   * @param trx    - Transactional storage adapter.
   * @param nodes  - Array of serialised node objects.
   * @param result - Mutable `ImportResult` to accumulate counts.
   */
  private async _importNodes(
    trx: { run: SqliteBrain['run']; get: SqliteBrain['get'] },
    nodes: NodeRecord[],
    result: ImportResult,
  ): Promise<void> {
    const { dialect } = this.brain.features;
    const checkSql = `SELECT id FROM knowledge_nodes WHERE ${dialect.jsonExtract('properties', '$.import_hash')} = ? LIMIT 1`;

    const insertSql = dialect.insertOrIgnore(
      'knowledge_nodes',
      ['id', 'type', 'label', 'properties', 'embedding', 'confidence', 'source', 'created_at'],
      ['?', '?', '?', '?', '?', '?', '?', '?'],
    );

    for (const n of nodes) {
      try {
        const hash = this._sha256(`${n.label ?? ''}::${n.type ?? ''}`);
        const existing = await trx.get<{ id: string }>(checkSql, [hash]);
        if (existing) {
          result.skipped++;
          continue;
        }

        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(n.properties ?? '{}') as Record<string, unknown>;
        } catch {
          // ignore malformed JSON
        }
        props['import_hash'] = hash;

        let embeddingBuf: Buffer | null = null;
        if (typeof n.embedding === 'string') {
          embeddingBuf = Buffer.from(n.embedding, 'base64');
        }

        await trx.run(insertSql, [
          n.id ?? `kn_${uuidv4()}`,
          n.type ?? 'concept',
          n.label ?? '',
          JSON.stringify(props),
          embeddingBuf,
          n.confidence ?? 1.0,
          n.source ?? '{}',
          n.created_at ?? Date.now(),
        ]);

        result.imported++;
      } catch (err) {
        result.errors.push(`Node import error: ${String(err)}`);
      }
    }
  }

  /**
   * Import knowledge edge records into `knowledge_edges`.
   *
   * Dedup key: SHA-256 of `source_id + target_id + type`.
   * Edges referencing non-existent nodes are silently skipped (FK constraint).
   *
   * @param trx    - Transactional storage adapter.
   * @param edges  - Array of serialised edge objects.
   * @param result - Mutable `ImportResult` to accumulate counts.
   */
  private async _importEdges(
    trx: { run: SqliteBrain['run']; get: SqliteBrain['get'] },
    edges: EdgeRecord[],
    result: ImportResult,
  ): Promise<void> {
    const { dialect } = this.brain.features;
    const checkSql = `SELECT id FROM knowledge_edges WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ? LIMIT 1`;

    const insertSql = dialect.insertOrIgnore(
      'knowledge_edges',
      ['id', 'source_id', 'target_id', 'type', 'weight', 'bidirectional', 'metadata', 'created_at'],
      ['?', '?', '?', '?', '?', '?', '?', '?'],
    );

    for (const e of edges) {
      try {
        if (!e.source_id || !e.target_id) {
          result.skipped++;
          continue;
        }

        const hash = this._sha256(`${e.source_id}::${e.target_id}::${e.type ?? ''}`);
        const existing = await trx.get<{ id: string }>(checkSql, [hash]);
        if (existing) {
          result.skipped++;
          continue;
        }

        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(e.metadata ?? '{}') as Record<string, unknown>;
        } catch {
          // ignore malformed JSON
        }
        meta['import_hash'] = hash;

        await trx.run(insertSql, [
          e.id ?? `ke_${uuidv4()}`,
          e.source_id,
          e.target_id,
          e.type ?? 'related_to',
          e.weight ?? 1.0,
          e.bidirectional ?? 0,
          JSON.stringify(meta),
          e.created_at ?? Date.now(),
        ]);

        result.imported++;
      } catch (err) {
        // FK constraint violation (referenced node doesn't exist) is common
        // when importing partial exports — log but don't fail.
        result.errors.push(`Edge import error: ${String(err)}`);
      }
    }
  }
}
