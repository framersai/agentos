/**
 * Tool that lets the agent fully replace its persistent markdown working memory.
 * The agent should call this whenever it learns new persistent context about the
 * user, session, or ongoing tasks that should survive across conversations.
 */
export class UpdateWorkingMemoryTool {
    constructor(memory) {
        this.memory = memory;
        this.id = 'update-working-memory-v1';
        this.name = 'update_working_memory';
        this.displayName = 'Update Working Memory';
        this.description = 'Replace your persistent working memory with updated content. ' +
            'Use this to store user preferences, ongoing context, project notes, ' +
            'and anything that should persist across conversations. ' +
            'You must provide the COMPLETE updated content (full replacement, not a patch).';
        this.category = 'memory';
        this.hasSideEffects = true;
        this.inputSchema = {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The full markdown content to replace working memory with.',
                },
            },
            required: ['content'],
        };
    }
    async execute(args, _context) {
        const result = this.memory.write(args.content);
        if (!result.success) {
            return { success: false, error: result.error ?? 'Failed to write working memory' };
        }
        return {
            success: true,
            output: { tokensUsed: result.tokensUsed, truncated: result.truncated },
        };
    }
}
//# sourceMappingURL=UpdateWorkingMemoryTool.js.map