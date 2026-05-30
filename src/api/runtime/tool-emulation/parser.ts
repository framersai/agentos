/** A tool call parsed out of the model's prompt-emulated text output. */
export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** A malformed `<tool_call>` block that could not be parsed. */
export interface ToolParseError {
  raw: string;
  message: string;
}

export interface ParsedToolOutput {
  calls: ParsedToolCall[];
  cleanedText: string;
  parseErrors: ToolParseError[];
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
const TOOL_RESPONSE_RE = /<tool_response>[\s\S]*?<\/tool_response>/g;

/**
 * Extract every `<tool_call>{json}</tool_call>` block from model text.
 * Malformed blocks are collected in `parseErrors` rather than thrown, so the
 * caller can feed an error back to the model. `cleanedText` is the input with
 * all tool_call / tool_response spans removed and trimmed.
 */
export function parseToolCalls(text: string): ParsedToolOutput {
  const calls: ParsedToolCall[] = [];
  const parseErrors: ToolParseError[] = [];

  for (const match of text.matchAll(TOOL_CALL_RE)) {
    const raw = match[1] ?? '';
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      parseErrors.push({ raw, message: 'tool_call payload was not valid JSON' });
      continue;
    }
    const obj = payload as { name?: unknown; arguments?: unknown };
    if (typeof obj.name !== 'string' || obj.name.length === 0) {
      parseErrors.push({ raw, message: 'tool_call missing string "name"' });
      continue;
    }
    const args =
      obj.arguments && typeof obj.arguments === 'object'
        ? (obj.arguments as Record<string, unknown>)
        : {};
    calls.push({ name: obj.name, arguments: args });
  }

  const cleanedText = text
    .replace(TOOL_CALL_RE, '')
    .replace(TOOL_RESPONSE_RE, '')
    .trim();

  return { calls, cleanedText, parseErrors };
}
