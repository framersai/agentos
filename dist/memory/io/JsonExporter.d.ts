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
import type { ExportOptions } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/**
 * Exports a `SqliteBrain` to a structured JSON file.
 *
 * **Usage:**
 * ```ts
 * const exporter = new JsonExporter(brain);
 * await exporter.export('/path/to/export.json', { includeEmbeddings: false });
 * ```
 */
export declare class JsonExporter {
    private readonly brain;
    /**
     * @param brain - The `SqliteBrain` instance to read from.
     */
    constructor(brain: SqliteBrain);
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
    export(outputPath: string, options?: ExportOptions): Promise<void>;
    /**
     * Export the full brain state as a JSON string without filesystem access.
     *
     * @param options - Optional export configuration (embeddings, conversations).
     * @returns Pretty-printed JSON string of the full brain payload.
     */
    exportToString(options?: ExportOptions): Promise<string>;
    /**
     * Build the full export payload from the brain database.
     *
     * @param options - Optional export configuration.
     * @returns The structured payload object ready for serialisation.
     */
    private _buildPayload;
    /**
     * Serialise a single `memory_traces` row, optionally stripping the embedding.
     *
     * @param row               - Raw DB row.
     * @param includeEmbeddings - Whether to encode the BLOB as base64.
     * @returns Plain JS object safe for JSON serialisation.
     */
    private _serializeTrace;
    /**
     * Serialise a single `knowledge_nodes` row, optionally stripping the embedding.
     *
     * @param row               - Raw DB row.
     * @param includeEmbeddings - Whether to encode the BLOB as base64.
     * @returns Plain JS object safe for JSON serialisation.
     */
    private _serializeNode;
    /**
     * Serialise a single `document_chunks` row.
     */
    private _serializeChunk;
    /**
     * Serialise a single `document_images` row.
     *
     * Raw image bytes are always exported as base64 because they are primary
     * data, while the optional image embedding follows `includeEmbeddings`.
     */
    private _serializeImage;
}
//# sourceMappingURL=JsonExporter.d.ts.map