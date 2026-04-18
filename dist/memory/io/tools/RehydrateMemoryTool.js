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
// ---------------------------------------------------------------------------
// RehydrateMemoryTool
// ---------------------------------------------------------------------------
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
export class RehydrateMemoryTool {
    /**
     * @param archive - The agent's IMemoryArchive instance.
     */
    constructor(archive) {
        this.archive = archive;
        /** Globally unique tool identifier. */
        this.id = 'rehydrate-memory-v1';
        /** LLM-facing tool name. */
        this.name = 'rehydrate_memory';
        /** Human-readable display name. */
        this.displayName = 'Rehydrate Memory';
        /** LLM-facing description. */
        this.description = "Look up the full original content of a memory whose summary you've seen. " +
            'Use this when a gisted memory is relevant and the summary lacks detail.';
        /** Logical category for discovery and grouping. */
        this.category = 'memory';
        /** This tool reads from the archive and writes an access-log entry. */
        this.hasSideEffects = true;
        /** JSON schema for input validation and LLM tool-call construction. */
        this.inputSchema = {
            type: 'object',
            properties: {
                traceId: {
                    type: 'string',
                    description: 'The unique ID of the memory trace to rehydrate.',
                },
            },
            required: ['traceId'],
        };
    }
    // ---------------------------------------------------------------------------
    // execute
    // ---------------------------------------------------------------------------
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
    async execute(args, _context) {
        try {
            const result = await this.archive.rehydrate(args.traceId, 'rehydrate_memory_tool');
            return {
                success: true,
                output: {
                    verbatimContent: result?.verbatimContent ?? null,
                    archivedAt: result?.archivedAt ?? null,
                },
            };
        }
        catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
//# sourceMappingURL=RehydrateMemoryTool.js.map