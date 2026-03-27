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

import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { ImportResult } from '../facade/types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';
import { MarkdownImporter } from './MarkdownImporter.js';

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/**
 * Matches Obsidian wikilinks: `[[Target]]` or `[[Target|Alias]]`.
 * Capture group 1 is the target note name; alias (if any) is ignored.
 * Does NOT match embedded images (`![[...]]`) — those use a separate pattern.
 */
const WIKILINK_RE = /(?<!!)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Matches Obsidian embedded images: `![[image.png]]`.
 * Used to emit a warning — embedded images are not yet supported for import.
 */
const EMBED_RE = /!\[\[[^\]]+\]\]/g;

/**
 * Matches inline hashtags: `#tagName` (not preceded by `[` or `#`).
 * Only captures the tag name (group 1) without the leading `#`.
 */
const HASHTAG_RE = /(?<![[#])#([\w-]+)/g;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ObsidianImporter
// ---------------------------------------------------------------------------

/**
 * Imports an Obsidian vault (directory of Markdown files) into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new ObsidianImporter(brain);
 * const result = await importer.import('/path/to/obsidian-vault');
 * ```
 */
export class ObsidianImporter extends MarkdownImporter {
  /**
   * @param brain - The target `SqliteBrain` to import into.
   */
  constructor(brain: SqliteBrain) {
    super(brain);
  }

  // -------------------------------------------------------------------------
  // Overridden hook
  // -------------------------------------------------------------------------

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
  protected override async postProcess(
    _filePath: string,
    _frontmatter: TraceFrontmatter,
    body: string,
    result: ImportResult,
    traceId: string,
  ): Promise<void> {
    // ---- 1. Warn about embedded images ----
    const embedMatches = body.match(EMBED_RE);
    if (embedMatches && embedMatches.length > 0) {
      console.warn(
        `[ObsidianImporter] Embedded images are not yet supported in import. ` +
          `Found ${embedMatches.length} embed(s) in trace ${traceId}.`,
      );
    }

    // ---- 2. Extract inline hashtags and persist to trace ----
    const inlineTags: string[] = [];
    let tagMatch: RegExpExecArray | null;
    HASHTAG_RE.lastIndex = 0;
    while ((tagMatch = HASHTAG_RE.exec(body)) !== null) {
      if (tagMatch[1]) inlineTags.push(tagMatch[1]);
    }

    if (inlineTags.length > 0) {
      await this._mergeTagsIntoTrace(traceId, inlineTags, result);
    }

    // ---- 3. Parse wikilinks and create knowledge_edges ----
    const wikiTargets: string[] = [];
    let wikilinkMatch: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((wikilinkMatch = WIKILINK_RE.exec(body)) !== null) {
      if (wikilinkMatch[1]) wikiTargets.push(wikilinkMatch[1].trim());
    }

    for (const target of wikiTargets) {
      await this._upsertWikiEdge(traceId, target, result);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Merge a list of inline hashtag names into a trace's `tags` JSON column.
   *
   * Reads the current tags array, deduplicates, and writes back.
   *
   * @param traceId    - ID of the trace to update.
   * @param newTags    - Hashtag names to add (without the leading `#`).
   * @param result     - Mutable result accumulator (errors recorded here).
   */
  private async _mergeTagsIntoTrace(
    traceId: string,
    newTags: string[],
    result: ImportResult,
  ): Promise<void> {
    try {
      const brainRef = (this as unknown as { brain: SqliteBrain }).brain;

      const row = await brainRef.get<{ tags: string }>(
        'SELECT tags FROM memory_traces WHERE id = ?',
        [traceId],
      );

      if (!row) return;

      let existing: string[] = [];
      try {
        existing = JSON.parse(row.tags) as string[];
      } catch {
        existing = [];
      }

      const merged = Array.from(new Set([...existing, ...newTags]));

      await brainRef.run(
        'UPDATE memory_traces SET tags = ? WHERE id = ?',
        [JSON.stringify(merged), traceId],
      );
    } catch (err) {
      result.errors.push(`Tag merge error for trace ${traceId}: ${String(err)}`);
    }
  }

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
  private async _upsertWikiEdge(
    sourceTraceId: string,
    targetLabel: string,
    result: ImportResult,
  ): Promise<void> {
    try {
      const brainRef = (this as unknown as { brain: SqliteBrain }).brain;

      // ---- Upsert source knowledge node for the trace ----
      // We use the trace ID itself as the node label so the graph stays navigable.
      const sourceLabel = `trace:${sourceTraceId}`;
      const sourceHash = crypto
        .createHash('sha256')
        .update(`wiki-source::${sourceTraceId}`)
        .digest('hex');

      let sourceNodeId: string;
      const existingSource = await brainRef.get<{ id: string }>(
        `SELECT id FROM knowledge_nodes WHERE label = ? LIMIT 1`,
        [sourceLabel],
      );

      if (existingSource) {
        sourceNodeId = existingSource.id;
      } else {
        sourceNodeId = `kn_${uuidv4()}`;
        await brainRef.run(
          `INSERT OR IGNORE INTO knowledge_nodes
             (id, type, label, properties, embedding, confidence, source, created_at)
           VALUES (?, 'trace', ?, ?, NULL, 1.0, '{}', ?)`,
          [
            sourceNodeId,
            sourceLabel,
            JSON.stringify({ import_hash: sourceHash, trace_id: sourceTraceId }),
            Date.now(),
          ],
        );
      }

      // ---- Upsert target knowledge node for the wikilink label ----
      const targetHash = crypto
        .createHash('sha256')
        .update(`wiki::${targetLabel}`)
        .digest('hex');

      let targetNodeId: string;
      const existingTarget = await brainRef.get<{ id: string }>(
        `SELECT id FROM knowledge_nodes WHERE label = ? LIMIT 1`,
        [targetLabel],
      );

      if (existingTarget) {
        targetNodeId = existingTarget.id;
      } else {
        targetNodeId = `kn_${uuidv4()}`;
        await brainRef.run(
          `INSERT OR IGNORE INTO knowledge_nodes
             (id, type, label, properties, embedding, confidence, source, created_at)
           VALUES (?, 'concept', ?, ?, NULL, 1.0, '{}', ?)`,
          [
            targetNodeId,
            targetLabel,
            JSON.stringify({ import_hash: targetHash, obsidian_wikilink: true }),
            Date.now(),
          ],
        );
      }

      // ---- Create the directed edge: source node → target node ----
      const edgeHash = crypto
        .createHash('sha256')
        .update(`${sourceNodeId}::${targetNodeId}::related_to`)
        .digest('hex');

      // Check for existing edge before insert (extra safety beyond OR IGNORE).
      const existingEdge = await brainRef.get<{ id: string }>(
        `SELECT id FROM knowledge_edges
           WHERE json_extract(metadata, '$.import_hash') = ? LIMIT 1`,
        [edgeHash],
      );

      if (!existingEdge) {
        await brainRef.run(
          `INSERT OR IGNORE INTO knowledge_edges
             (id, source_id, target_id, type, weight, bidirectional, metadata, created_at)
           VALUES (?, ?, ?, 'related_to', 1.0, 0, ?, ?)`,
          [
            `ke_${uuidv4()}`,
            sourceNodeId,
            targetNodeId,
            JSON.stringify({ import_hash: edgeHash, source: 'obsidian_wikilink', trace_id: sourceTraceId }),
            Date.now(),
          ],
        );
      }
    } catch (err) {
      result.errors.push(
        `Wikilink edge error (${sourceTraceId} → "${targetLabel}"): ${String(err)}`,
      );
    }
  }
}
