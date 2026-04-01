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
import type { ImportOptions, ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
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
export declare class JsonImporter {
    private readonly brain;
    /**
     * @param brain - The target `SqliteBrain` to import into.
     */
    constructor(brain: SqliteBrain);
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
    import(sourcePath: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Import a JSON string directly into the target brain without filesystem access.
     *
     * @param jsonContent - The JSON string to parse and import.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    importFromString(jsonContent: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Parse a raw JSON string and import its contents into the brain.
     *
     * @param raw    - The raw JSON string to parse.
     * @param result - Mutable `ImportResult` to accumulate counts.
     * @returns The populated `ImportResult`.
     */
    private _importParsed;
    /**
     * Compute a SHA-256 hex digest of arbitrary string content.
     * Used as a stable dedup key across import operations.
     *
     * @param content - The string to hash.
     * @returns 64-character lowercase hex string.
     */
    private _sha256;
    /**
     * Restore brain metadata keys from the export payload.
     *
     * `exported_at` is export-specific and intentionally ignored on import.
     */
    private _importMeta;
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
    private _importTraces;
    /**
     * Import knowledge node records into `knowledge_nodes`.
     *
     * Dedup key: SHA-256 of `label` concatenated with `type`.
     *
     * @param trx    - Transactional storage adapter.
     * @param nodes  - Array of serialised node objects.
     * @param result - Mutable `ImportResult` to accumulate counts.
     */
    private _importNodes;
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
    private _importEdges;
    /**
     * Import document registry rows.
     *
     * Documents are deduplicated by their exported `id`.
     */
    private _importDocuments;
    /**
     * Import document chunk rows.
     */
    private _importChunks;
    /**
     * Import document image rows.
     */
    private _importImages;
    /**
     * Import conversation session rows.
     *
     * Conversation session rows are imported before messages so message foreign
     * keys can be remapped safely when IDs collide or sessions already exist.
     */
    private _importConversations;
    /**
     * Import conversation message rows.
     */
    private _importMessages;
    private _resolveUniqueId;
}
//# sourceMappingURL=JsonImporter.d.ts.map