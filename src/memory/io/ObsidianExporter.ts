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
import type { ExportOptions } from '../facade/types.js';
import { MarkdownExporter } from './MarkdownExporter.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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

/** Result row when joining edges → nodes. */
interface RelatedNodeRow {
  label: string;
}

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
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Export all memory traces as Obsidian-flavoured `.md` files.
   *
   * Delegates to the parent `export()` method — directory creation and file
   * writing are handled there; only `buildFileContent` is overridden.
   *
   * @param outputDir - Root directory to write the Obsidian vault into.
   * @param options   - Optional export configuration.
   */
  override async export(outputDir: string, options?: ExportOptions): Promise<void> {
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
  protected override buildFileContent(trace: TraceRow): string {
    let tags: string[] = [];
    try {
      tags = JSON.parse(trace.tags) as string[];
    } catch {
      tags = [];
    }

    // Render inline #hashtags so Obsidian picks them up in tag search.
    const tagLine =
      tags.length > 0
        ? '\n\n' + tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')
        : '';

    // Fetch related knowledge nodes via edges where source === trace ID.
    // We query knowledge_edges by source_id and join knowledge_nodes to get
    // the human-readable label for the wikilink.
    const relatedNodes = this._fetchRelatedNodes(trace.id);

    const wikiLinks =
      relatedNodes.length > 0
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
   * Query `knowledge_edges` for nodes related to the given trace ID.
   *
   * Only edges whose `source_id` matches the trace ID are considered.
   * The target node's `label` is returned for wikilink generation.
   *
   * @param traceId - The memory trace ID to look up edges for.
   * @returns Array of knowledge node labels linked to this trace.
   */
  private _fetchRelatedNodes(traceId: string): string[] {
    try {
      const rows = this.brain.db
        .prepare<[string], RelatedNodeRow>(
          `SELECT kn.label
           FROM knowledge_edges ke
           JOIN knowledge_nodes kn ON kn.id = ke.target_id
           WHERE ke.source_id = ?
           LIMIT 50`,
        )
        .all(traceId);

      return rows.map((r) => r.label);
    } catch {
      // If the knowledge graph isn't populated, return empty gracefully.
      return [];
    }
  }
}
