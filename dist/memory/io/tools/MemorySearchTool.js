/**
 * @fileoverview MemorySearchTool — lets an agent search its own memory traces
 * using FTS5 full-text search.
 *
 * The tool queries the `memory_traces_fts` FTS5 virtual table (backed by the
 * `memory_traces` content table) and joins back to `memory_traces` for
 * metadata fields (type, scope, strength, tags). Optional `type` and `scope`
 * filters narrow the result set via SQL WHERE clauses applied to the join.
 *
 * FTS5 matching uses the Porter-stemmed tokenizer configured at DDL time, so
 * queries like `"retrieve"` will also match `"retrieval"`, `"retrieved"`, etc.
 *
 * @module memory/tools/MemorySearchTool
 */
import { buildNaturalLanguageFtsQuery } from '../../retrieval/store/tracePersistence.js';
import { resolveMemoryToolScopeId } from './scopeContext.js';
// ---------------------------------------------------------------------------
// MemorySearchTool
// ---------------------------------------------------------------------------
/**
 * ITool implementation that searches the agent's memory traces using FTS5.
 *
 * **Usage:**
 * ```ts
 * const tool = new MemorySearchTool(brain);
 * const result = await tool.execute(
 *   { query: 'dark mode preference', scope: 'user', limit: 5 },
 *   context,
 * );
 * // result.output.results → [{ id, content, type, scope, strength, tags }, ...]
 * ```
 */
export class MemorySearchTool {
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain) {
        this.brain = brain;
        /** Globally unique tool identifier. */
        this.id = 'memory-search-v1';
        /** LLM-facing tool name. */
        this.name = 'memory_search';
        /** Human-readable display name. */
        this.displayName = 'Search Memory';
        /** LLM-facing description. */
        this.description = 'Search memory traces using full-text search (FTS5 with Porter stemming). ' +
            'Supports FTS5 query syntax: phrase queries in quotes, AND/OR operators, prefix matching (e.g. "retriev*"). ' +
            'Filter by type (episodic/semantic/procedural/prospective) or scope (thread/user/persona/organization).';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /** This tool only reads from the database — no side effects. */
        this.hasSideEffects = false;
        /** JSON schema for input validation and LLM tool-call construction. */
        this.inputSchema = {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Full-text search query string. Supports FTS5 syntax: phrases in quotes, boolean operators, prefix matching.',
                },
                type: {
                    type: 'string',
                    enum: ['episodic', 'semantic', 'procedural', 'prospective', 'relational'],
                    description: 'Optional filter: only return traces of this memory type.',
                },
                scope: {
                    type: 'string',
                    enum: ['thread', 'user', 'persona', 'organization'],
                    description: 'Optional filter: only return traces with this scope.',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 100,
                    description: 'Maximum number of results to return. Defaults to 10.',
                },
            },
            required: ['query'],
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
    /**
     * Run a full-text search against `memory_traces_fts` and join back to
     * `memory_traces` for metadata.
     *
     * The SQL pattern:
     * ```sql
     * SELECT mt.id, mt.content, mt.type, mt.scope, mt.strength, mt.tags
     * FROM memory_traces_fts fts
     * JOIN memory_traces mt ON mt.rowid = fts.rowid
     * WHERE fts.memory_traces_fts MATCH ?
     *   AND mt.deleted = 0
     *   [AND mt.type = ?]    -- when type filter provided
     *   [AND mt.scope = ?]   -- when scope filter provided
     * ORDER BY rank          -- FTS5 BM25 relevance (lower = more relevant)
     * LIMIT ?
     * ```
     *
     * Tags are stored as JSON arrays; they are parsed and returned as string[].
     * Malformed tag JSON returns an empty array rather than throwing.
     *
     * @param args    - Search input (query, optional type/scope/limit).
     * @param context - Tool execution context used to resolve scoped searches.
     * @returns `{ results }` array on success, or an error result.
     */
    async execute(args, context) {
        try {
            const rawQuery = args.query.trim();
            if (!rawQuery) {
                return { success: true, output: { results: [] } };
            }
            const limit = args.limit ?? 10;
            // Build WHERE clause additions for optional filters.
            const extraClauses = [];
            const extraParams = [];
            if (args.type !== undefined) {
                extraClauses.push('mt.type = ?');
                extraParams.push(args.type);
            }
            if (args.scope !== undefined) {
                extraClauses.push('mt.scope = ?');
                extraParams.push(args.scope);
                const scopeId = resolveMemoryToolScopeId(args.scope, context);
                if (scopeId) {
                    const { dialect } = this.brain.features;
                    extraClauses.push(`${dialect.jsonExtract('mt.metadata', '$.scopeId')} = ?`);
                    extraParams.push(scopeId);
                }
            }
            const extraWhere = extraClauses.length > 0 ? `AND ${extraClauses.join(' AND ')}` : '';
            const { fts } = this.brain.features;
            const sql = `
        SELECT mt.id, mt.content, mt.type, mt.scope, mt.strength, mt.tags
        FROM ${fts.joinClause('memory_traces', 'mt', 'fts', 'memory_traces_fts')}
        WHERE ${fts.matchClause('memory_traces_fts', '?')}
          AND mt.deleted = 0
          ${extraWhere}
        ORDER BY ${fts.rankExpression('fts')}
        LIMIT ?
      `;
            const runSearch = async (query) => {
                const params = [query, ...extraParams, limit];
                return await this.brain.all(sql, params);
            };
            let rows;
            try {
                rows = await runSearch(rawQuery);
            }
            catch (error) {
                const fallbackQuery = buildNaturalLanguageFtsQuery(rawQuery);
                if (error?.code !== 'SQLITE_ERROR' || !fallbackQuery || fallbackQuery === rawQuery) {
                    throw error;
                }
                rows = await runSearch(fallbackQuery);
            }
            const results = rows.map((row) => {
                let tags = [];
                try {
                    tags = JSON.parse(row.tags);
                }
                catch {
                    // Malformed JSON tags — return empty array.
                }
                return {
                    id: row.id,
                    content: row.content,
                    type: row.type,
                    scope: row.scope,
                    strength: row.strength,
                    tags,
                };
            });
            return { success: true, output: { results } };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=MemorySearchTool.js.map