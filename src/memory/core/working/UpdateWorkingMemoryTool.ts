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
export class UpdateWorkingMemoryTool implements ITool<UpdateInput, UpdateOutput> {
  readonly id = 'update-working-memory-v1';
  readonly name = 'update_working_memory';
  readonly displayName = 'Update Working Memory';
  readonly description =
    'Replace your persistent working memory with updated content. ' +
    'Use this to store user preferences, ongoing context, project notes, ' +
    'and anything that should persist across conversations. ' +
    'You must provide the COMPLETE updated content (full replacement, not a patch).';
  readonly category = 'memory';
  readonly hasSideEffects = true;
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The full markdown content to replace working memory with.',
      },
    },
    required: ['content'],
  };

  constructor(private readonly memory: MarkdownWorkingMemory) {}

  async execute(args: UpdateInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<UpdateOutput>> {
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
