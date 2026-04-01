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
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
// ---------------------------------------------------------------------------
// MarkdownExporter
// ---------------------------------------------------------------------------
/**
 * Exports memory traces as Markdown files with YAML front-matter.
 *
 * **Usage:**
 * ```ts
 * const exporter = new MarkdownExporter(brain);
 * await exporter.export('/path/to/vault');
 * ```
 */
export class MarkdownExporter {
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
     * Export all memory traces as `.md` files into `outputDir`.
     *
     * Directories are created on demand (equivalent to `mkdir -p`).
     *
     * @param outputDir - Root directory to write the Markdown vault into.
     * @param _options  - Optional export configuration (currently unused but
     *   accepted for API consistency with other exporters).
     */
    async export(outputDir, _options) {
        const traces = await this.brain.all('SELECT id, type, scope, content, strength, created_at, tags FROM memory_traces WHERE deleted = 0');
        await Promise.all(traces.map((trace) => this._writeTrace(outputDir, trace)));
    }
    // -------------------------------------------------------------------------
    // Protected helpers (overridden by ObsidianExporter)
    // -------------------------------------------------------------------------
    /**
     * Build the Markdown content for a single trace.
     *
     * Subclasses (e.g. `ObsidianExporter`) override this to inject wiki-links
     * and `#tag` decorations into the body.
     *
     * @param trace - Parsed trace row from the database.
     * @returns Full Markdown file content (front-matter + body).
     */
    buildFileContent(trace) {
        let tags = [];
        try {
            tags = JSON.parse(trace.tags);
        }
        catch {
            tags = [];
        }
        // gray-matter's `stringify` method generates the YAML block for us.
        return matter.stringify(trace.content, {
            id: trace.id,
            type: trace.type,
            scope: trace.scope,
            strength: trace.strength,
            tags,
            createdAt: trace.created_at,
        });
    }
    /**
     * Determine the relative file path for a trace within the output directory.
     *
     * Default: `{scope}/{type}/{id}.md`
     *
     * @param trace - The trace row.
     * @returns Relative path string (no leading slash).
     */
    traceRelativePath(trace) {
        return path.join(trace.scope, trace.type, `${trace.id}.md`);
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Write a single trace to disk.
     *
     * Creates any missing parent directories before writing.
     *
     * @param outputDir - Root output directory.
     * @param trace     - Trace row to serialise.
     */
    async _writeTrace(outputDir, trace) {
        const relPath = this.traceRelativePath(trace);
        const absPath = path.join(outputDir, relPath);
        // Ensure parent directory exists.
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        const content = this.buildFileContent(trace);
        await fs.writeFile(absPath, content, 'utf8');
    }
}
//# sourceMappingURL=MarkdownExporter.js.map