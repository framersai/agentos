/**
 * @fileoverview Markdown exporter for AgentOS memory brain.
 *
 * Creates a directory of Markdown files — one per memory trace — organised
 * into a `{output}/{scope}/{type}/` folder hierarchy.  Each file contains
 * YAML front-matter (id, type, scope, strength, tags, createdAt) followed
 * by the plain-text trace content.
 *
 * The `gray-matter` library is used to serialise the front-matter block so
 * that the same library can later round-trip back via `MarkdownImporter`.
 *
 * ## Folder layout
 * ```
 * {outputDir}/
 *   user/
 *     episodic/
 *       mt_abc123.md
 *       mt_def456.md
 *     semantic/
 *       mt_789.md
 *   thread/
 *     procedural/
 *       ...
 * ```
 *
 * @module memory/io/MarkdownExporter
 */
import type { ExportOptions } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
/** Raw row shape from the `memory_traces` table. */
interface TraceRow {
    id: string;
    type: string;
    scope: string;
    content: string;
    strength: number;
    created_at: number;
    tags: string;
}
/**
 * Exports memory traces as Markdown files with YAML front-matter.
 *
 * **Usage:**
 * ```ts
 * const exporter = new MarkdownExporter(brain);
 * await exporter.export('/path/to/vault');
 * ```
 */
export declare class MarkdownExporter {
    protected readonly brain: SqliteBrain;
    /**
     * @param brain - The `SqliteBrain` instance to read from.
     */
    constructor(brain: SqliteBrain);
    /**
     * Export all memory traces as `.md` files into `outputDir`.
     *
     * Directories are created on demand (equivalent to `mkdir -p`).
     *
     * @param outputDir - Root directory to write the Markdown vault into.
     * @param _options  - Optional export configuration (currently unused but
     *   accepted for API consistency with other exporters).
     */
    export(outputDir: string, _options?: ExportOptions): Promise<void>;
    /**
     * Build the Markdown content for a single trace.
     *
     * Subclasses (e.g. `ObsidianExporter`) override this to inject wiki-links
     * and `#tag` decorations into the body.
     *
     * @param trace - Parsed trace row from the database.
     * @returns Full Markdown file content (front-matter + body).
     */
    protected buildFileContent(trace: TraceRow): string;
    /**
     * Determine the relative file path for a trace within the output directory.
     *
     * Default: `{scope}/{type}/{id}.md`
     *
     * @param trace - The trace row.
     * @returns Relative path string (no leading slash).
     */
    protected traceRelativePath(trace: TraceRow): string;
    /**
     * Write a single trace to disk.
     *
     * Creates any missing parent directories before writing.
     *
     * @param outputDir - Root output directory.
     * @param trace     - Trace row to serialise.
     */
    private _writeTrace;
}
export {};
//# sourceMappingURL=MarkdownExporter.d.ts.map