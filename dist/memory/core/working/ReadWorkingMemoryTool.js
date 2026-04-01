/**
 * Tool that lets the agent explicitly read its persistent working memory.
 * The memory is also injected into the system prompt automatically,
 * but this tool is useful when the agent wants to reason about its
 * memory before deciding what to update.
 */
export class ReadWorkingMemoryTool {
    constructor(memory) {
        this.memory = memory;
        this.id = 'read-working-memory-v1';
        this.name = 'read_working_memory';
        this.displayName = 'Read Working Memory';
        this.description = 'Read your current persistent working memory contents. ' +
            'This is also available in your system prompt, but use this tool ' +
            'when you need to inspect your memory before updating it.';
        this.category = 'memory';
        this.hasSideEffects = false;
        this.inputSchema = {
            type: 'object',
            properties: {},
        };
    }
    async execute(_args, _context) {
        const content = this.memory.read();
        return {
            success: true,
            output: { content, tokensUsed: this.memory.estimateTokens() },
        };
    }
}
//# sourceMappingURL=ReadWorkingMemoryTool.js.map