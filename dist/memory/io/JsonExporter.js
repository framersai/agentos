/**
 * @fileoverview JSON exporter for AgentOS memory brain.
 *
 * Serialises all memory traces, knowledge graph nodes/edges, document registry
 * rows, document chunks/images, conversations, and conversation messages from
 * a `SqliteBrain` into a single structured JSON file.
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
 *   "chunks": [...],
 *   "images": [...],
 *   "conversations": [...],
 *   "messages": [...]
 * }
 * ```
 *
 * @module memory/io/JsonExporter
 */
import { asBinaryBytes, bytesToBase64 } from './base64.js';
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
    constructor(brain) {
        this.brain = brain;
    }
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
    async export(outputPath, options) {
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
    async exportToString(options) {
        const payload = await this._buildPayload(options);
        return JSON.stringify(payload, null, 2);
    }
    /**
     * Build the full export payload from the brain database.
     *
     * @param options - Optional export configuration.
     * @returns The structured payload object ready for serialisation.
     */
    async _buildPayload(options) {
        const includeEmbeddings = options?.includeEmbeddings ?? false;
        const includeConversations = options?.includeConversations ?? true;
        // Collect brain_meta as a plain object for the `meta` field.
        const metaRows = await this.brain.all('SELECT key, value FROM brain_meta');
        const meta = {};
        for (const row of metaRows) {
            meta[row.key] = row.value;
        }
        meta['exported_at'] = String(Date.now());
        // ---- memory_traces ----
        const rawTraces = await this.brain.all('SELECT * FROM memory_traces');
        const traces = rawTraces.map((row) => this._serializeTrace(row, includeEmbeddings));
        // ---- knowledge_nodes ----
        const rawNodes = await this.brain.all('SELECT * FROM knowledge_nodes');
        const nodes = rawNodes.map((row) => this._serializeNode(row, includeEmbeddings));
        // ---- knowledge_edges ----
        const edges = await this.brain.all('SELECT * FROM knowledge_edges');
        // ---- documents ----
        const documents = await this.brain.all('SELECT * FROM documents');
        // ---- document_chunks ----
        const rawChunks = await this.brain.all('SELECT * FROM document_chunks');
        const chunks = rawChunks.map((row) => this._serializeChunk(row, includeEmbeddings));
        // ---- document_images ----
        const rawImages = await this.brain.all('SELECT * FROM document_images');
        const images = rawImages.map((row) => this._serializeImage(row, includeEmbeddings));
        // ---- conversations ----
        const conversations = includeConversations
            ? await this.brain.all('SELECT * FROM conversations')
            : [];
        // ---- messages ----
        const messages = includeConversations
            ? await this.brain.all('SELECT * FROM messages')
            : [];
        return {
            meta,
            traces,
            nodes,
            edges,
            documents,
            chunks,
            images,
            conversations,
            messages,
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
    _serializeTrace(row, includeEmbeddings) {
        const out = { ...row };
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
    _serializeNode(row, includeEmbeddings) {
        const out = { ...row };
        const embedding = asBinaryBytes(row.embedding);
        if (embedding) {
            out['embedding'] = includeEmbeddings ? bytesToBase64(embedding) : undefined;
        }
        return out;
    }
    /**
     * Serialise a single `document_chunks` row.
     */
    _serializeChunk(row, includeEmbeddings) {
        const out = { ...row };
        const embedding = asBinaryBytes(row.embedding);
        if (embedding) {
            out['embedding'] = includeEmbeddings ? bytesToBase64(embedding) : undefined;
        }
        return out;
    }
    /**
     * Serialise a single `document_images` row.
     *
     * Raw image bytes are always exported as base64 because they are primary
     * data, while the optional image embedding follows `includeEmbeddings`.
     */
    _serializeImage(row, includeEmbeddings) {
        const out = { ...row, data: bytesToBase64(row.data) };
        const embedding = asBinaryBytes(row.embedding);
        if (embedding) {
            out['embedding'] = includeEmbeddings ? bytesToBase64(embedding) : undefined;
        }
        return out;
    }
}
//# sourceMappingURL=JsonExporter.js.map