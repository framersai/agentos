/**
 * @fileoverview Obsidian vault exporter for AgentOS memory brain.
 *
 * Extends `MarkdownExporter` with Obsidian-specific enrichments:
 *
 * 1. **`#tag` decorations** — each trace tag is appended to the document body
 *    as an Obsidian-recognisable inline hashtag.
 *
 * 2. **`[[wikilinks]]`** — for each trace, the exporter queries
 *    `knowledge_edges` for related entities that share the same trace ID as
 *    a source.  Related knowledge-node labels are appended as `[[label]]`
 *    links so Obsidian's graph view can visualise the semantic network.
 *
 * The folder layout mirrors `MarkdownExporter`:
 * ```
 * {outputDir}/
 *   user/
 *     episodic/
 *       mt_abc123.md    ← includes [[related-node]] + #tag at bottom
 * ```
 *
 * @module memory/io/ObsidianExporter
 */
import type { ExportOptions } from './facade/types.js';
import { MarkdownExporter } from './MarkdownExporter.js';
/** Raw row shape from the `memory_traces` table (subset used here). */
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
 * Exports memory traces as an Obsidian-compatible Markdown vault.
 *
 * **Usage:**
 * ```ts
 * const exporter = new ObsidianExporter(brain);
 * await exporter.export('/path/to/obsidian-vault');
 * ```
 */
export declare class ObsidianExporter extends MarkdownExporter {
    /**
     * Pre-fetched map of traceId → related node labels.
     * Populated in `export()` before delegating to the parent, so that the
     * synchronous `buildFileContent()` override can look up wikilinks without
     * needing async DB access.
     */
    private _relatedNodesCache;
    /**
     * Export all memory traces as Obsidian-flavoured `.md` files.
     *
     * Pre-fetches all knowledge-edge relationships into an in-memory cache,
     * then delegates to the parent `export()` method. Directory creation and
     * file writing are handled there; only `buildFileContent` is overridden.
     *
     * @param outputDir - Root directory to write the Obsidian vault into.
     * @param options   - Optional export configuration.
     */
    export(outputDir: string, options?: ExportOptions): Promise<void>;
    /**
     * Build Obsidian-flavoured Markdown for a trace.
     *
     * Additions over the base implementation:
     * - Tags are rendered as `#tagName` inline hashtags in the body.
     * - Related knowledge nodes (found via `knowledge_edges`) are rendered as
     *   `[[Node Label]]` wikilinks appended at the bottom of the note.
     *
     * @param trace - Parsed trace row.
     * @returns Full Markdown file content with front-matter.
     */
    protected buildFileContent(trace: TraceRow): string;
    /**
     * Pre-fetch all knowledge-edge relationships and group them by source_id.
     *
     * This populates `_relatedNodesCache` so that the synchronous
     * `buildFileContent` method can look up wikilinks without async DB access.
     */
    private _prefetchRelatedNodes;
}
export {};
//# sourceMappingURL=ObsidianExporter.d.ts.map