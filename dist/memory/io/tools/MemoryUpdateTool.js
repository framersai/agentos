/**
 * @fileoverview MemoryUpdateTool — lets an agent update an existing memory trace.
 *
 * Supports partial updates: the agent may change just the content, just the
 * tags, or both. When the content is changed, the stored embedding is cleared
 * so the background EmbeddingEncoder will re-embed the trace asynchronously
 * on the next pass — preventing stale vector data from contaminating semantic
 * search results.
 *
 * @module memory/tools/MemoryUpdateTool
 */
import { parseTraceMetadata, sha256Hex } from '../../retrieval/store/tracePersistence.js';
// ---------------------------------------------------------------------------
// MemoryUpdateTool
// ---------------------------------------------------------------------------
/**
 * ITool implementation that applies partial updates to an existing memory
 * trace stored in the agent's SQLite brain database.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryUpdateTool(brain);
 * const result = await tool.execute(
 *   { traceId: 'mt_1711234567890_0', content: 'Updated content here.' },
 *   context,
 * );
 * // result.output.updated → true
 * ```
 */
export class MemoryUpdateTool {
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain) {
        this.brain = brain;
        /** Globally unique tool identifier. */
        this.id = 'memory-update-v1';
        /** LLM-facing tool name. */
        this.name = 'memory_update';
        /** Human-readable display name. */
        this.displayName = 'Update Memory';
        /** LLM-facing description. */
        this.description = 'Update an existing memory trace by ID. You can change the content, the tags, or both. ' +
            'If content changes, the stored embedding is cleared and will be re-computed automatically.';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /** This tool writes to the database. */
        this.hasSideEffects = true;
        /** JSON schema for input validation and LLM tool-call construction. */
        this.inputSchema = {
            type: 'object',
            properties: {
                traceId: {
                    type: 'string',
                    description: 'The unique ID of the memory trace to update.',
                },
                content: {
                    type: 'string',
                    description: 'New text content for the trace. Clears the stored embedding so it can be re-computed.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Replacement tag array (overwrites the existing tags entirely).',
                },
            },
            required: ['traceId'],
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
    /**
     * Update a memory trace identified by `traceId`.
     *
     * The method builds a dynamic SET clause based on which optional fields
     * are provided:
     * - `content` provided → set `content = ?`, also set `embedding = NULL`
     *   to signal that the cached vector is stale.
     * - `tags` provided → serialise array as JSON and set `tags = ?`.
     *
     * If neither `content` nor `tags` is specified, the method returns
     * `{ updated: false }` immediately without touching the database.
     *
     * A trace that does not exist or has `deleted = 1` returns `{ updated: false }`.
     *
     * @param args     - Update input (traceId, optional content/tags).
     * @param _context - Tool execution context (not used by this tool).
     * @returns `{ updated }` status, or an error result.
     */
    async execute(args, _context) {
        try {
            const { traceId, content, tags } = args;
            // Nothing to update — return false without any DB work.
            if (content === undefined && tags === undefined) {
                return { success: true, output: { updated: false } };
            }
            const current = await this.brain.get(`SELECT content, tags, metadata
         FROM memory_traces
         WHERE id = ? AND deleted = 0`, [traceId]);
            if (!current) {
                return { success: true, output: { updated: false } };
            }
            const nextContent = content ?? current.content;
            const nextTags = tags !== undefined ? JSON.stringify(tags) : current.tags;
            const nextMetadataObject = parseTraceMetadata(current.metadata);
            if (content !== undefined) {
                nextMetadataObject.content_hash = await sha256Hex(nextContent);
                delete nextMetadataObject.import_hash;
            }
            const nextMetadata = JSON.stringify(nextMetadataObject);
            const sql = content !== undefined
                ? `UPDATE memory_traces
             SET content = ?, tags = ?, metadata = ?, embedding = NULL
             WHERE id = ? AND deleted = 0`
                : `UPDATE memory_traces
             SET content = ?, tags = ?, metadata = ?
             WHERE id = ? AND deleted = 0`;
            const changes = await this.brain.transaction(async (trx) => {
                const info = await trx.run(sql, [nextContent, nextTags, nextMetadata, traceId]);
                if (info.changes > 0) {
                    await trx.exec(this.brain.features.fts.rebuildCommand('memory_traces_fts'));
                }
                return info.changes;
            });
            return { success: true, output: { updated: changes > 0 } };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=MemoryUpdateTool.js.map