import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { MarkdownWorkingMemory } from './MarkdownWorkingMemory.js';
interface ReadOutput {
    content: string;
    tokensUsed: number;
}
/**
 * Tool that lets the agent explicitly read its persistent working memory.
 * The memory is also injected into the system prompt automatically,
 * but this tool is useful when the agent wants to reason about its
 * memory before deciding what to update.
 */
export declare class ReadWorkingMemoryTool implements ITool<Record<string, never>, ReadOutput> {
    private readonly memory;
    readonly id = "read-working-memory-v1";
    readonly name = "read_working_memory";
    readonly displayName = "Read Working Memory";
    readonly description: string;
    readonly category = "memory";
    readonly hasSideEffects = false;
    readonly inputSchema: JSONSchemaObject;
    constructor(memory: MarkdownWorkingMemory);
    execute(_args: Record<string, never>, _context: ToolExecutionContext): Promise<ToolExecutionResult<ReadOutput>>;
}
export {};
//# sourceMappingURL=ReadWorkingMemoryTool.d.ts.map