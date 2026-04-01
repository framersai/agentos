/**
 * @fileoverview MemoryAddTool — lets an agent store a new memory trace.
 *
 * The agent calls this tool to remember important facts, decisions, or
 * observations. Each invocation inserts a fresh row into `memory_traces`
 * with strength 1.0 (full encoding strength at creation time).
 *
 * ID format: `mt_<timestamp>_<counter>` — monotonically increasing within a
 * process, collision-safe across typical agent interaction rates.
 *
 * @module memory/tools/MemoryAddTool
 */
import { buildInitialTraceMetadata, sha256Hex } from '../../retrieval/store/tracePersistence.js';
import { resolveMemoryToolScopeId } from './scopeContext.js';
// ---------------------------------------------------------------------------
// Counter for unique ID generation within the process lifetime
// ---------------------------------------------------------------------------
/** Monotonic counter shared across all MemoryAddTool instances in the process. */
let _idCounter = 0;
// ---------------------------------------------------------------------------
// MemoryAddTool
// ---------------------------------------------------------------------------
/**
 * ITool implementation that stores a new memory trace in the agent's
 * SQLite brain database.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemoryAddTool(brain);
 * const result = await tool.execute(
 *   { content: 'User prefers dark mode.', tags: ['preference', 'ui'] },
 *   context,
 * );
 * // result.output.traceId → 'mt_1711234567890_0'
 * ```
 */
export class MemoryAddTool {
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain) {
        this.brain = brain;
        /** Globally unique tool identifier. */
        this.id = 'memory-add-v1';
        /** LLM-facing tool name (snake_case, as the LLM will call it). */
        this.name = 'memory_add';
        /** Human-readable display name for UIs and logs. */
        this.displayName = 'Add Memory';
        /**
         * Description shown to the LLM when deciding which tool to invoke.
         * Must be comprehensive enough for the model to understand when to call this.
         */
        this.description = 'Store a new memory trace. The agent calls this to remember important facts, decisions, or observations.';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /**
         * This tool writes to the database.
         * Callers may request confirmation before execution when `hasSideEffects = true`.
         */
        this.hasSideEffects = true;
        /**
         * JSON schema for input validation and LLM tool-call construction.
         * All optional fields default gracefully inside `execute()`.
         */
        this.inputSchema = {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The text content of the memory to store.',
                },
                type: {
                    type: 'string',
                    enum: ['episodic', 'semantic', 'procedural', 'prospective', 'relational'],
                    description: 'Tulving memory type. Defaults to "episodic".',
                },
                scope: {
                    type: 'string',
                    enum: ['thread', 'user', 'persona', 'organization'],
                    description: 'Visibility scope of the trace. Defaults to "user".',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional free-form tags for filtering and retrieval.',
                },
            },
            required: ['content'],
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
    /**
     * Insert a new memory trace row into `memory_traces`.
     *
     * Defaults applied when optional fields are absent:
     * - `type`  → `'episodic'`
     * - `scope` → `'user'`
     * - `tags`  → `[]`
     *
     * The trace is created with `strength = 1.0` (maximum encoding strength)
     * and `deleted = 0` (active). No embedding is computed here — the background
     * EmbeddingEncoder will embed it asynchronously.
     *
     * @param args    - Memory add input (content, optional type/scope/tags).
     * @param context - Tool execution context used to resolve the scope ID.
     * @returns `{ traceId }` on success, or an error result.
     */
    async execute(args, context) {
        try {
            const now = Date.now();
            const traceId = `mt_${now}_${_idCounter++}`;
            const type = args.type ?? 'episodic';
            const scope = args.scope ?? 'user';
            const scopeId = resolveMemoryToolScopeId(scope, context);
            const tags = JSON.stringify(args.tags ?? []);
            const metadata = JSON.stringify(buildInitialTraceMetadata({}, {
                contentHash: await sha256Hex(args.content),
                ...(scopeId ? { scopeId } : {}),
            }));
            await this.brain.transaction(async (trx) => {
                await trx.run(`INSERT INTO memory_traces
             (id, type, scope, content, embedding, strength, created_at,
              last_accessed, retrieval_count, tags, emotions, metadata, deleted)
           VALUES (?, ?, ?, ?, NULL, 1.0, ?, NULL, 0, ?, '{}', ?, 0)`, [traceId, type, scope, args.content, now, tags, metadata]);
                await trx.run(this.brain.features.fts.syncInsert('memory_traces_fts', '(SELECT rowid FROM memory_traces WHERE id = ?)', ['content', 'tags']), [traceId, args.content, tags]);
            });
            return { success: true, output: { traceId } };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=MemoryAddTool.js.map