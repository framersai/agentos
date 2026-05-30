import type { ITool } from '../../../core/tools/ITool';

/**
 * Render a Hermes-style tool system block for models without native tool-use.
 * Lists the tools as JSON in a <tools> block and instructs the model to emit
 * <tool_call> blocks; results return as <tool_response> blocks.
 */
export function renderToolSystemBlock(tools: ITool[]): string {
  if (!tools || tools.length === 0) return '';
  const manifest = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
  return [
    'You can call tools. To call one, emit a block exactly in this form:',
    '<tool_call>{"name": "<tool_name>", "arguments": { ... }}</tool_call>',
    'You may emit multiple <tool_call> blocks in one reply. After each call you',
    'will receive a <tool_response>{...}</tool_response>. Use the responses to',
    'answer. When you have enough information, reply normally with NO <tool_call>',
    'blocks. Available tools:',
    '<tools>',
    JSON.stringify(manifest),
    '</tools>',
  ].join('\n');
}
