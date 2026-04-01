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
import matter from 'gray-matter';
import { MarkdownExporter } from './MarkdownExporter.js';
// ---------------------------------------------------------------------------
// ObsidianExporter
// ---------------------------------------------------------------------------
/**
 * Exports memory traces as an Obsidian-compatible Markdown vault.
 *
 * **Usage:**
 * ```ts
 * const exporter = new ObsidianExporter(brain);
 * await exporter.export('/path/to/obsidian-vault');
 * ```
 */
export class ObsidianExporter extends MarkdownExporter {
    constructor() {
        super(...arguments);
        /**
         * Pre-fetched map of traceId → related node labels.
         * Populated in `export()` before delegating to the parent, so that the
         * synchronous `buildFileContent()` override can look up wikilinks without
         * needing async DB access.
         */
        this._relatedNodesCache = new Map();
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
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
    async export(outputDir, options) {
        // Pre-fetch all related nodes so buildFileContent can use them synchronously.
        await this._prefetchRelatedNodes();
        await super.export(outputDir, options);
    }
    // -------------------------------------------------------------------------
    // Overridden helpers
    // -------------------------------------------------------------------------
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
    buildFileContent(trace) {
        let tags = [];
        try {
            tags = JSON.parse(trace.tags);
        }
        catch {
            tags = [];
        }
        // Render inline #hashtags so Obsidian picks them up in tag search.
        const tagLine = tags.length > 0
            ? '\n\n' + tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')
            : '';
        // Look up pre-fetched related knowledge nodes for wikilink generation.
        const relatedNodes = this._relatedNodesCache.get(trace.id) ?? [];
        const wikiLinks = relatedNodes.length > 0
            ? '\n\n**Related:**\n' +
                relatedNodes.map((label) => `- [[${label}]]`).join('\n')
            : '';
        const body = trace.content + tagLine + wikiLinks;
        return matter.stringify(body, {
            id: trace.id,
            type: trace.type,
            scope: trace.scope,
            strength: trace.strength,
            tags,
            createdAt: trace.created_at,
        });
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Pre-fetch all knowledge-edge relationships and group them by source_id.
     *
     * This populates `_relatedNodesCache` so that the synchronous
     * `buildFileContent` method can look up wikilinks without async DB access.
     */
    async _prefetchRelatedNodes() {
        this._relatedNodesCache.clear();
        try {
            const { dialect } = this.brain.features;
            const sourceTraceExpr = dialect.ifnull(dialect.jsonExtract('src.properties', '$.trace_id'), 'ke.source_id');
            const rows = await this.brain.all(`SELECT ${sourceTraceExpr} AS trace_id, kn.label
         FROM knowledge_edges ke
         JOIN knowledge_nodes src ON src.id = ke.source_id
         JOIN knowledge_nodes kn ON kn.id = ke.target_id`);
            for (const row of rows) {
                const existing = this._relatedNodesCache.get(row.trace_id);
                if (existing) {
                    existing.push(row.label);
                }
                else {
                    this._relatedNodesCache.set(row.trace_id, [row.label]);
                }
            }
        }
        catch {
            // If the knowledge graph isn't populated, the cache stays empty.
        }
    }
}
//# sourceMappingURL=ObsidianExporter.js.map