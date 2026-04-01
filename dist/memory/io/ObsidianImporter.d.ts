/**
 * @fileoverview Obsidian vault importer for AgentOS memory brain.
 *
 * Extends `MarkdownImporter` with Obsidian-specific parsing:
 *
 * 1. **`[[wikilinks]]`** — each `[[Target Note]]` (or `[[Target|Alias]]`) in
 *    a note's body is parsed.  For each wikilink, the importer looks up (or
 *    creates) a `knowledge_nodes` entry for the target label and then creates
 *    a `knowledge_edges` row of type `'related_to'` linking the source trace
 *    node to the target node.
 *
 * 2. **`#tags`** — inline hashtags are extracted from the body and merged
 *    into the trace's `tags` JSON column (in addition to any front-matter tags).
 *
 * 3. **`![[image.png]]`** — embedded-image syntax is detected and a warning
 *    is logged.  Embedded images are not imported in the current version.
 *
 * @module memory/io/ObsidianImporter
 */
import type { ImportResult } from './facade/types.js';
import type { SqliteBrain } from '../retrieval/store/SqliteBrain.js';
import { MarkdownImporter } from './MarkdownImporter.js';
/**
 * Parsed front-matter fields (same shape as MarkdownImporter expects).
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
 * Imports an Obsidian vault (directory of Markdown files) into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new ObsidianImporter(brain);
 * const result = await importer.import('/path/to/obsidian-vault');
 * ```
 */
export declare class ObsidianImporter extends MarkdownImporter {
    /**
     * @param brain - The target `SqliteBrain` to import into.
     */
    constructor(brain: SqliteBrain);
    /**
     * Post-process a successfully imported Markdown file:
     *
     * 1. Warn about any embedded images (`![[...]]`).
     * 2. Extract inline `#hashtags` and merge them into the trace's tag list.
     * 3. Parse `[[wikilinks]]` and create `knowledge_edges` entries.
     *
     * @param _filePath    - Absolute path of the source file (unused here).
     * @param _frontmatter - Parsed front-matter data.
     * @param body         - Markdown body (content after front-matter).
     * @param result       - Mutable `ImportResult` accumulator.
     * @param traceId      - The ID of the just-inserted trace.
     */
    protected postProcess(_filePath: string, _frontmatter: TraceFrontmatter, body: string, result: ImportResult, traceId: string): Promise<void>;
    /**
     * Merge a list of inline hashtag names into a trace's `tags` JSON column.
     *
     * Reads the current tags array, deduplicates, and writes back.
     *
     * @param traceId    - ID of the trace to update.
     * @param newTags    - Hashtag names to add (without the leading `#`).
     * @param result     - Mutable result accumulator (errors recorded here).
     */
    private _mergeTagsIntoTrace;
    /**
     * Ensure `knowledge_nodes` entries exist for both the source trace and the
     * target label, then create a `knowledge_edges` row (type `'related_to'`)
     * linking them.
     *
     * Because `knowledge_edges.source_id` has a FK reference to
     * `knowledge_nodes(id)`, we first upsert a node for the source trace (using
     * the trace content as the label) before creating the edge.  This lets
     * Obsidian's graph view visualise which note links to which concept.
     *
     * Both node upserts and the edge insert use `INSERT OR IGNORE` so repeated
     * imports don't create duplicates.
     *
     * @param sourceTraceId - The memory trace ID that contains the wikilink.
     * @param targetLabel   - The label of the linked note (wikilink target).
     * @param result        - Mutable result accumulator.
     */
    private _upsertWikiEdge;
}
export {};
//# sourceMappingURL=ObsidianImporter.d.ts.map