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
export class ReadWorkingMemoryTool implements ITool<Record<string, never>, ReadOutput> {
  readonly id = 'read-working-memory-v1';
  readonly name = 'read_working_memory';
  readonly displayName = 'Read Working Memory';
  readonly description =
    'Read your current persistent working memory contents. ' +
    'This is also available in your system prompt, but use this tool ' +
    'when you need to inspect your memory before updating it.';
  readonly category = 'memory';
  readonly hasSideEffects = false;
  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {},
  };

  constructor(private readonly memory: MarkdownWorkingMemory) {}

  async execute(_args: Record<string, never>, _context: ToolExecutionContext): Promise<ToolExecutionResult<ReadOutput>> {
    const content = this.memory.read();
    return {
      success: true,
      output: { content, tokensUsed: this.memory.estimateTokens() },
    };
  }
}
