/**
 * @fileoverview CSV importer for AgentOS memory brain.
 *
 * Imports flat CSV files into a target `SqliteBrain`. A header row is
 * required and must include a `content` column. Optional columns map onto
 * `memory_traces` fields when present.
 *
 * Supported optional columns:
 * - `id`
 * - `type`
 * - `scope`
 * - `strength`
 * - `created_at` / `createdAt`
 * - `last_accessed`
 * - `retrieval_count`
 * - `deleted`
 * - `tags` (JSON array, comma-separated, or pipe-separated)
 * - `metadata` (JSON object)
 *
 * Deduplication uses SHA-256 of the `content` field and stores the hash in
 * `metadata.import_hash`.
 *
 * @module memory/io/CsvImporter
 */
import type { ImportOptions, ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/**
 * Imports a flat CSV file into a `SqliteBrain`.
 */
export declare class CsvImporter {
    private readonly brain;
    constructor(brain: SqliteBrain);
    /**
     * Read, parse, and import a CSV file.
     *
     * @param sourcePath - Absolute or relative path to the CSV file.
     * @returns Import summary with imported/skipped/error counts.
     */
    import(sourcePath: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Import a CSV string directly into the target brain without filesystem access.
     *
     * @param csvContent - The raw CSV string to parse and import.
     * @returns Import summary with imported/skipped/error counts.
     */
    importFromString(csvContent: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Parse raw CSV content and import its rows into the brain.
     *
     * @param raw    - The raw CSV string (may include BOM).
     * @param result - Mutable `ImportResult` to accumulate counts.
     * @returns The populated `ImportResult`.
     */
    private _importCsvContent;
    private _sha256;
    private _resolveTraceId;
    private _readCell;
    private _toNumber;
    private _toInteger;
    private _parseTags;
    /**
     * Small RFC4180-ish CSV parser that supports quoted fields, escaped quotes,
     * and embedded newlines inside quoted cells.
     */
    private _parseCsv;
}
//# sourceMappingURL=CsvImporter.d.ts.map