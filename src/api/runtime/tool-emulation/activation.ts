import type { ToolExecutionResult } from '../../../core/tools/ITool';

export type ToolMode = 'auto' | 'native' | 'prompt';

/** Decide whether the prompt-based shim handles tools for this call. */
export function resolveShimActive(mode: ToolMode | undefined, nativeToolSupport: boolean): boolean {
  const m = mode ?? 'auto';
  if (m === 'prompt') return true;
  if (m === 'native') return false;
  return !nativeToolSupport; // 'auto'
}

/** Serialize a tool execution result into a <tool_response> block. */
export function formatToolResponse(name: string, result: ToolExecutionResult): string {
  const body = result.success
    ? { name, output: result.output ?? null }
    : { name, error: result.error ?? 'tool execution failed' };
  return `<tool_response>${JSON.stringify(body)}</tool_response>`;
}
