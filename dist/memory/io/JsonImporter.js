/**
 * @fileoverview JSON importer for AgentOS memory brain.
 *
 * Reads a JSON file produced by `JsonExporter` (or a compatible schema) and
 * merges traces, graph rows, documents, document chunks/images, conversations,
 * and messages into a target `SqliteBrain`.
 *
 * Trace deduplication is performed via SHA-256 content hash by default, but it
 * can be disabled via `{ dedup: false }` on the importer or `Memory.importFrom`.
 *
 * @module memory/io/JsonImporter
 */
import { sha256 } from '../core/util/crossPlatformCrypto.js';
import { v4 as uuidv4 } from 'uuid';
import { base64ToBytes } from './base64.js';
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
    constructor(brain) {
        this.brain = brain;
    }
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
    async import(sourcePath, options) {
        const result = { imported: 0, skipped: 0, errors: [] };
        // ---- Load + parse ----
        let raw;
        try {
            const fs = await import('node:fs/promises');
            raw = await fs.readFile(sourcePath, 'utf8');
        }
        catch (err) {
            result.errors.push(`Failed to read file: ${String(err)}`);
            return result;
        }
        return this._importParsed(raw, result, options);
    }
    /**
     * Import a JSON string directly into the target brain without filesystem access.
     *
     * @param jsonContent - The JSON string to parse and import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    async importFromString(jsonContent, options) {
        const result = { imported: 0, skipped: 0, errors: [] };
        return this._importParsed(jsonContent, result, options);
    }
    /**
     * Parse a raw JSON string and import its contents into the brain.
     *
     * @param raw    - The raw JSON string to parse.
     * @param result - Mutable `ImportResult` to accumulate counts.
     * @returns The populated `ImportResult`.
     */
    async _importParsed(raw, result, options) {
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch (err) {
            result.errors.push(`Invalid JSON: ${String(err)}`);
            return result;
        }
        if (!Array.isArray(payload.traces)) {
            result.errors.push('Invalid export format: missing top-level "traces" array.');
            return result;
        }
        // ---- Import in a single transaction for atomicity ----
        const context = {
            dedup: options?.dedup ?? true,
            traceIds: new Map(),
            nodeIds: new Map(),
            documentIds: new Map(),
            chunkIds: new Map(),
            conversationIds: new Map(),
        };
        await this.brain.transaction(async (trx) => {
            await this._importMeta(trx, payload.meta);
            await this._importTraces(trx, payload.traces, result, context);
            await this._importNodes(trx, payload.nodes ?? [], result, context);
            await this._importEdges(trx, payload.edges ?? [], result, context);
            await this._importDocuments(trx, payload.documents ?? [], result, context);
            await this._importChunks(trx, payload.chunks ?? [], result, context);
            await this._importImages(trx, payload.images ?? [], result, context);
            await this._importConversations(trx, payload.conversations ?? [], result, context);
            await this._importMessages(trx, payload.messages ?? [], result, context);
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
    async _sha256(content) {
        return sha256(content);
    }
    /**
     * Restore brain metadata keys from the export payload.
     *
     * `exported_at` is export-specific and intentionally ignored on import.
     */
    async _importMeta(trx, meta) {
        if (!meta)
            return;
        const { dialect } = this.brain.features;
        const upsertSql = dialect.insertOrReplace('brain_meta', ['key', 'value'], ['?', '?'], 'key');
        for (const [key, value] of Object.entries(meta)) {
            if (key === 'exported_at')
                continue;
            await trx.run(upsertSql, [key, value]);
        }
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
    async _importTraces(trx, traces, result, context) {
        const { dialect } = this.brain.features;
        const checkSql = `SELECT id FROM memory_traces WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ? LIMIT 1`;
        const insertSql = `INSERT INTO memory_traces
         (id, type, scope, content, embedding, strength, created_at, last_accessed,
          retrieval_count, tags, emotions, metadata, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        for (const t of traces) {
            try {
                const hash = await this._sha256(t.content);
                const sourceId = t.id;
                if (context.dedup) {
                    const existing = await trx.get(checkSql, [hash]);
                    if (existing) {
                        if (sourceId)
                            context.traceIds.set(sourceId, existing.id);
                        result.skipped++;
                        continue;
                    }
                }
                // Merge import_hash into the metadata JSON so future imports can dedup.
                let meta = {};
                try {
                    meta = JSON.parse(t.metadata ?? '{}');
                }
                catch {
                    // If metadata is malformed, start fresh.
                }
                meta['import_hash'] = hash;
                // Decode embedding if present.
                let embeddingBuf = null;
                if (typeof t.embedding === 'string') {
                    embeddingBuf = base64ToBytes(t.embedding);
                }
                const id = await this._resolveUniqueId(trx, 'memory_traces', sourceId ?? `mt_${uuidv4()}`, 'mt_');
                await trx.run(insertSql, [
                    id,
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
                if (sourceId)
                    context.traceIds.set(sourceId, id);
                result.imported++;
            }
            catch (err) {
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
    async _importNodes(trx, nodes, result, context) {
        const { dialect } = this.brain.features;
        const checkSql = `SELECT id FROM knowledge_nodes WHERE ${dialect.jsonExtract('properties', '$.import_hash')} = ? LIMIT 1`;
        const insertSql = dialect.insertOrIgnore('knowledge_nodes', ['id', 'type', 'label', 'properties', 'embedding', 'confidence', 'source', 'created_at'], ['?', '?', '?', '?', '?', '?', '?', '?']);
        for (const n of nodes) {
            try {
                const hash = await this._sha256(`${n.label ?? ''}::${n.type ?? ''}`);
                const sourceId = n.id;
                const existing = await trx.get(checkSql, [hash]);
                if (existing) {
                    if (sourceId)
                        context.nodeIds.set(sourceId, existing.id);
                    result.skipped++;
                    continue;
                }
                let props = {};
                try {
                    props = JSON.parse(n.properties ?? '{}');
                }
                catch {
                    // ignore malformed JSON
                }
                props['import_hash'] = hash;
                let embeddingBuf = null;
                if (typeof n.embedding === 'string') {
                    embeddingBuf = base64ToBytes(n.embedding);
                }
                const id = await this._resolveUniqueId(trx, 'knowledge_nodes', sourceId ?? `kn_${uuidv4()}`, 'kn_');
                await trx.run(insertSql, [
                    id,
                    n.type ?? 'concept',
                    n.label ?? '',
                    JSON.stringify(props),
                    embeddingBuf,
                    n.confidence ?? 1.0,
                    n.source ?? '{}',
                    n.created_at ?? Date.now(),
                ]);
                if (sourceId)
                    context.nodeIds.set(sourceId, id);
                result.imported++;
            }
            catch (err) {
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
    async _importEdges(trx, edges, result, context) {
        const { dialect } = this.brain.features;
        const checkSql = `SELECT id FROM knowledge_edges WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ? LIMIT 1`;
        const insertSql = dialect.insertOrIgnore('knowledge_edges', ['id', 'source_id', 'target_id', 'type', 'weight', 'bidirectional', 'metadata', 'created_at'], ['?', '?', '?', '?', '?', '?', '?', '?']);
        for (const e of edges) {
            try {
                const sourceId = e.source_id ? (context.nodeIds.get(e.source_id) ?? e.source_id) : null;
                const targetId = e.target_id ? (context.nodeIds.get(e.target_id) ?? e.target_id) : null;
                if (!sourceId || !targetId) {
                    result.skipped++;
                    continue;
                }
                const hash = await this._sha256(`${sourceId}::${targetId}::${e.type ?? ''}`);
                const existing = await trx.get(checkSql, [hash]);
                if (existing) {
                    result.skipped++;
                    continue;
                }
                let meta = {};
                try {
                    meta = JSON.parse(e.metadata ?? '{}');
                }
                catch {
                    // ignore malformed JSON
                }
                meta['import_hash'] = hash;
                await trx.run(insertSql, [
                    await this._resolveUniqueId(trx, 'knowledge_edges', e.id ?? `ke_${uuidv4()}`, 'ke_'),
                    sourceId,
                    targetId,
                    e.type ?? 'related_to',
                    e.weight ?? 1.0,
                    e.bidirectional ?? 0,
                    JSON.stringify(meta),
                    e.created_at ?? Date.now(),
                ]);
                result.imported++;
            }
            catch (err) {
                // FK constraint violation (referenced node doesn't exist) is common
                // when importing partial exports — log but don't fail.
                result.errors.push(`Edge import error: ${String(err)}`);
            }
        }
    }
    /**
     * Import document registry rows.
     *
     * Documents are deduplicated by their exported `id`.
     */
    async _importDocuments(trx, documents, result, context) {
        const { dialect } = this.brain.features;
        const checkSql = 'SELECT id FROM documents WHERE id = ? LIMIT 1';
        const upsertSql = dialect.insertOrReplace('documents', ['id', 'path', 'format', 'title', 'content_hash', 'chunk_count', 'metadata', 'ingested_at'], ['?', '?', '?', '?', '?', '?', '?', '?'], 'id');
        for (const doc of documents) {
            try {
                const sourceId = doc.id;
                const id = sourceId ?? `doc_${uuidv4()}`;
                const existing = await trx.get(checkSql, [id]);
                if (existing) {
                    if (sourceId)
                        context.documentIds.set(sourceId, existing.id);
                    result.skipped++;
                    continue;
                }
                await trx.run(upsertSql, [
                    id,
                    doc.path ?? '',
                    doc.format ?? 'unknown',
                    doc.title ?? null,
                    doc.content_hash ?? '',
                    doc.chunk_count ?? 0,
                    doc.metadata ?? '{}',
                    doc.ingested_at ?? Date.now(),
                ]);
                if (sourceId)
                    context.documentIds.set(sourceId, id);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Document import error: ${String(err)}`);
            }
        }
    }
    /**
     * Import document chunk rows.
     */
    async _importChunks(trx, chunks, result, context) {
        const checkSql = 'SELECT id FROM document_chunks WHERE id = ? LIMIT 1';
        const insertSql = `INSERT INTO document_chunks
         (id, document_id, trace_id, content, chunk_index, page_number, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`;
        for (const chunk of chunks) {
            try {
                const sourceId = chunk.id;
                const id = sourceId ?? `chunk_${uuidv4()}`;
                const existing = await trx.get(checkSql, [id]);
                if (existing) {
                    if (sourceId)
                        context.chunkIds.set(sourceId, existing.id);
                    result.skipped++;
                    continue;
                }
                const documentId = chunk.document_id
                    ? (context.documentIds.get(chunk.document_id) ?? chunk.document_id)
                    : null;
                if (!documentId || !chunk.content) {
                    result.skipped++;
                    continue;
                }
                const traceId = chunk.trace_id
                    ? (context.traceIds.get(chunk.trace_id) ?? chunk.trace_id)
                    : null;
                const embedding = typeof chunk.embedding === 'string'
                    ? base64ToBytes(chunk.embedding)
                    : null;
                await trx.run(insertSql, [
                    id,
                    documentId,
                    traceId,
                    chunk.content,
                    chunk.chunk_index ?? 0,
                    chunk.page_number ?? null,
                    embedding,
                ]);
                if (sourceId)
                    context.chunkIds.set(sourceId, id);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Chunk import error: ${String(err)}`);
            }
        }
    }
    /**
     * Import document image rows.
     */
    async _importImages(trx, images, result, context) {
        const checkSql = 'SELECT id FROM document_images WHERE id = ? LIMIT 1';
        const insertSql = `INSERT INTO document_images
         (id, document_id, chunk_id, data, mime_type, caption, page_number, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        for (const image of images) {
            try {
                const id = image.id ?? `img_${uuidv4()}`;
                const existing = await trx.get(checkSql, [id]);
                if (existing) {
                    result.skipped++;
                    continue;
                }
                const documentId = image.document_id
                    ? (context.documentIds.get(image.document_id) ?? image.document_id)
                    : null;
                if (!documentId || !image.data || !image.mime_type) {
                    result.skipped++;
                    continue;
                }
                const chunkId = image.chunk_id
                    ? (context.chunkIds.get(image.chunk_id) ?? image.chunk_id)
                    : null;
                const data = base64ToBytes(image.data);
                const embedding = typeof image.embedding === 'string'
                    ? base64ToBytes(image.embedding)
                    : null;
                await trx.run(insertSql, [
                    id,
                    documentId,
                    chunkId,
                    data,
                    image.mime_type,
                    image.caption ?? null,
                    image.page_number ?? null,
                    embedding,
                ]);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Image import error: ${String(err)}`);
            }
        }
    }
    /**
     * Import conversation session rows.
     *
     * Conversation session rows are imported before messages so message foreign
     * keys can be remapped safely when IDs collide or sessions already exist.
     */
    async _importConversations(trx, conversations, result, context) {
        const { dialect } = this.brain.features;
        const checkSql = 'SELECT id FROM conversations WHERE id = ? LIMIT 1';
        const upsertSql = dialect.insertOrReplace('conversations', ['id', 'title', 'created_at', 'updated_at', 'metadata'], ['?', '?', '?', '?', '?'], 'id');
        for (const convo of conversations) {
            try {
                const sourceId = convo.id;
                const id = sourceId ?? `conv_${uuidv4()}`;
                const existing = await trx.get(checkSql, [id]);
                if (existing) {
                    if (sourceId)
                        context.conversationIds.set(sourceId, existing.id);
                    result.skipped++;
                    continue;
                }
                const createdAt = convo.created_at ?? Date.now();
                await trx.run(upsertSql, [
                    id,
                    convo.title ?? null,
                    createdAt,
                    convo.updated_at ?? createdAt,
                    convo.metadata ?? '{}',
                ]);
                if (sourceId)
                    context.conversationIds.set(sourceId, id);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Conversation import error: ${String(err)}`);
            }
        }
    }
    /**
     * Import conversation message rows.
     */
    async _importMessages(trx, messages, result, context) {
        const checkSql = 'SELECT id FROM messages WHERE id = ? LIMIT 1';
        const insertSql = `INSERT INTO messages
         (id, conversation_id, role, content, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`;
        for (const message of messages) {
            try {
                const id = message.id ?? `msg_${uuidv4()}`;
                const existing = await trx.get(checkSql, [id]);
                if (existing) {
                    result.skipped++;
                    continue;
                }
                const conversationId = message.conversation_id
                    ? (context.conversationIds.get(message.conversation_id) ?? message.conversation_id)
                    : null;
                if (!conversationId || !message.role || !message.content) {
                    result.skipped++;
                    continue;
                }
                await trx.run(insertSql, [
                    id,
                    conversationId,
                    message.role,
                    message.content,
                    message.created_at ?? Date.now(),
                    message.metadata ?? '{}',
                ]);
                result.imported++;
            }
            catch (err) {
                result.errors.push(`Message import error: ${String(err)}`);
            }
        }
    }
    async _resolveUniqueId(trx, table, preferredId, prefix) {
        const existing = await trx.get(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [preferredId]);
        return existing ? `${prefix}${uuidv4()}` : preferredId;
    }
}
//# sourceMappingURL=JsonImporter.js.map