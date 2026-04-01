/**
 * @fileoverview Markdown importer for AgentOS memory brain.
 *
 * Recursively walks a directory of Markdown files and inserts each file as a
 * memory trace in the target `SqliteBrain`.  Front-matter fields (parsed via
 * `gray-matter`) are mapped to trace columns; the document body becomes the
 * trace content.
 *
 * Deduplication uses SHA-256 of the content body — files already present in
 * the target brain (same hash in `metadata.import_hash`) are skipped.
 *
 * @module memory/io/MarkdownImporter
 */
import type { ImportOptions, ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/**
 * Parsed front-matter fields extracted from a Markdown trace file.
 * All fields are optional — the importer falls back to safe defaults.
 */
interface TraceFrontmatter {
    id?: string;
    type?: string;
    scope?: string;
    strength?: number;
    tags?: string[];
    createdAt?: number;
    [key: string]: unknown;
}
/**
 * Imports Markdown files from a directory into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new MarkdownImporter(brain);
 * const result = await importer.import('/path/to/vault');
 * console.log(result.imported, result.skipped);
 * ```
 */
export declare class MarkdownImporter {
    protected readonly brain: SqliteBrain;
    /**
     * @param brain - The target `SqliteBrain` to import into.
     */
    constructor(brain: SqliteBrain);
    /**
     * Recursively walk `sourceDir`, parse every `.md` file, and insert traces.
     *
     * Non-Markdown files are silently ignored.  Files that fail to parse are
     * recorded in `result.errors` and processing continues.
     *
     * @param sourceDir - Directory to recursively scan for `.md` files.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    import(sourceDir: string, options?: Pick<ImportOptions, 'dedup'>): Promise<ImportResult>;
    /**
     * Post-process a parsed file before it is inserted into the database.
     *
     * The base implementation is a no-op.  `ObsidianImporter` overrides this
     * to extract `[[wikilinks]]` and `#tags`.
     *
     * @param _filePath   - Absolute path of the source file.
     * @param _frontmatter - Parsed front-matter data.
     * @param _body       - Markdown body content.
     * @param _result     - Mutable result accumulator.
     * @param _traceId    - The ID assigned (or taken from front-matter) for this trace.
     */
    protected postProcess(_filePath: string, _frontmatter: TraceFrontmatter, _body: string, _result: ImportResult, _traceId: string): Promise<void>;
    /**
     * Recursively collect all `.md` file paths under `dir`.
     *
     * @param dir - Root directory to scan.
     * @returns Sorted list of absolute file paths.
     */
    private _collectMarkdownFiles;
    /**
     * Parse and insert a single Markdown file.
     *
     * @param filePath - Absolute path to the `.md` file.
     * @param result   - Mutable `ImportResult` accumulator.
     */
    private _processFile;
    private _resolveTraceId;
}
export {};
//# sourceMappingURL=MarkdownImporter.d.ts.map