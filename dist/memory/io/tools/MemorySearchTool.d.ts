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
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { SqliteBrain } from '../../retrieval/store/SqliteBrain.js';
/**
 * Input arguments for {@link MemorySearchTool}.
 *
 * @property query - The full-text search query string. Supports FTS5 syntax
 *                   (phrase queries in quotes, boolean operators, prefix matching).
 * @property type  - Optional filter: only return traces of this Tulving memory type.
 * @property scope - Optional filter: only return traces with this visibility scope.
 * @property limit - Maximum number of results to return. Defaults to 10.
 */
export interface MemorySearchInput extends Record<string, any> {
    query: string;
    type?: string;
    scope?: string;
    limit?: number;
}
/**
 * A single result item in the {@link MemorySearchOutput} results array.
 *
 * @property id       - Trace ID.
 * @property content  - Full text content of the trace.
 * @property type     - Tulving memory type.
 * @property scope    - Visibility scope.
 * @property strength - Current Ebbinghaus encoding strength (0–1).
 * @property tags     - Array of tag strings.
 */
export interface MemorySearchResult {
    id: string;
    content: string;
    type: string;
    scope: string;
    strength: number;
    tags: string[];
}
/**
 * Output returned by {@link MemorySearchTool} on success.
 *
 * @property results - Array of matching memory traces ordered by FTS5 relevance (BM25).
 */
export interface MemorySearchOutput {
    results: MemorySearchResult[];
}
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
export declare class MemorySearchTool implements ITool<MemorySearchInput, MemorySearchOutput> {
    private readonly brain;
    /** Globally unique tool identifier. */
    readonly id = "memory-search-v1";
    /** LLM-facing tool name. */
    readonly name = "memory_search";
    /** Human-readable display name. */
    readonly displayName = "Search Memory";
    /** LLM-facing description. */
    readonly description: string;
    /** Logical category for discovery and grouping. */
    readonly category = "memory";
    /** This tool only reads from the database — no side effects. */
    readonly hasSideEffects = false;
    /** JSON schema for input validation and LLM tool-call construction. */
    readonly inputSchema: JSONSchemaObject;
    /**
     * @param brain - The agent's shared SQLite brain database connection.
     */
    constructor(brain: SqliteBrain);
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
    execute(args: MemorySearchInput, context: ToolExecutionContext): Promise<ToolExecutionResult<MemorySearchOutput>>;
}
//# sourceMappingURL=MemorySearchTool.d.ts.map