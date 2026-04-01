import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../../../core/tools/ITool.js';
import type { MarkdownWorkingMemory } from './MarkdownWorkingMemory.js';
interface UpdateInput {
    content: string;
}
interface UpdateOutput {
    tokensUsed: number;
    truncated: boolean;
}
/**
 * Tool that lets the agent fully replace its persistent markdown working memory.
 * The agent should call this whenever it learns new persistent context about the
 * user, session, or ongoing tasks that should survive across conversations.
 */
export declare class UpdateWorkingMemoryTool implements ITool<UpdateInput, UpdateOutput> {
    private readonly memory;
    readonly id = "update-working-memory-v1";
    readonly name = "update_working_memory";
    readonly displayName = "Update Working Memory";
    readonly description: string;
    readonly category = "memory";
    readonly hasSideEffects = true;
    readonly inputSchema: JSONSchemaObject;
    constructor(memory: MarkdownWorkingMemory);
    execute(args: UpdateInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<UpdateOutput>>;
}
export {};
//# sourceMappingURL=UpdateWorkingMemoryTool.d.ts.map