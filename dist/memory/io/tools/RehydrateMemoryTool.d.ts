/**
 * @fileoverview RehydrateMemoryTool — lets an agent inflate a gisted memory trace.
 *
 * Exposes `rehydrate_memory` as an opt-in agent tool. When a gisted memory
 * appears in the assembled context and the summary lacks detail, the LLM can
 * call this tool to retrieve the original verbatim content from the archive.
 *
 * Registration is opt-in: consumers pass `{ includeRehydrate: true }` to the
 * `MemoryToolsExtension`. The default tool surface is unchanged for agents
 * that don't adopt the archive.
 *
 * @module memory/tools/RehydrateMemoryTool
 * @see {@link IMemoryArchive} for the underlying archive contract.
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { IMemoryArchive } from '../../archive/IMemoryArchive.js';
/**
 * Input arguments for {@link RehydrateMemoryTool}.
 *
 * @property traceId - ID of the trace to rehydrate.
 */
export interface RehydrateMemoryInput extends Record<string, any> {
    traceId: string;
}
/**
 * Output returned by {@link RehydrateMemoryTool}.
 *
 * @property verbatimContent - The original verbatim content, or `null` if
 *   the trace is not archived or integrity verification failed.
 * @property archivedAt - Unix ms when the trace was archived, or `null`.
 */
export interface RehydrateMemoryOutput {
    verbatimContent: string | null;
    archivedAt: number | null;
}
/**
 * ITool implementation that retrieves the original verbatim content of a
 * gisted or archived memory trace from the agent's memory archive.
 *
 * **Usage:**
 * ```ts
 * const tool = new RehydrateMemoryTool(archive);
 * const result = await tool.execute({ traceId: 'mt_abc123' }, context);
 * // result.output.verbatimContent → 'The dragon attacked...' or null
 * ```
 */
export declare class RehydrateMemoryTool implements ITool<RehydrateMemoryInput, RehydrateMemoryOutput> {
    private readonly archive;
    /** Globally unique tool identifier. */
    readonly id = "rehydrate-memory-v1";
    /** LLM-facing tool name. */
    readonly name = "rehydrate_memory";
    /** Human-readable display name. */
    readonly displayName = "Rehydrate Memory";
    /** LLM-facing description. */
    readonly description: string;
    /** Logical category for discovery and grouping. */
    readonly category = "memory";
    /** This tool reads from the archive and writes an access-log entry. */
    readonly hasSideEffects = true;
    /** JSON schema for input validation and LLM tool-call construction. */
    readonly inputSchema: JSONSchemaObject;
    /**
     * @param archive - The agent's IMemoryArchive instance.
     */
    constructor(archive: IMemoryArchive);
    /**
     * Retrieve the original verbatim content for a gisted/archived trace.
     *
     * Delegates to `IMemoryArchive.rehydrate()`, which performs integrity
     * verification and writes an access-log entry. Returns `null` for both
     * verbatimContent and archivedAt if the trace is not found or integrity
     * verification fails.
     *
     * @param args     - Rehydrate input (traceId).
     * @param _context - Tool execution context (not used by this tool).
     * @returns The rehydrated content or nulls, wrapped in ToolExecutionResult.
     */
    execute(args: RehydrateMemoryInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<RehydrateMemoryOutput>>;
}
//# sourceMappingURL=RehydrateMemoryTool.d.ts.map