/**
 * @file TextToolCallParser.ts
 * Fallback parser for extracting tool invocations from plain-text LLM responses.
 *
 * When an LLM does not support native `tool_calls` (e.g. some Ollama models,
 * open-source models), the model may still emit structured text that encodes
 * tool invocations.  This parser recognises two common formats:
 *
 * **Format A — JSON in markdown code fences:**
 * ```json
 * {"tool": "web_search", "arguments": {"query": "AgentOS features"}}
 * ```
 *
 * **Format B — ReAct-style structured text:**
 * ```
 * Thought: I need to search for information about AgentOS.
 * Action: web_search
 * Input: {"query": "AgentOS features"}
 * ```
 *
 * The parser first attempts Format A extraction, then Format B.  Results from
 * both passes are concatenated and returned as a unified array.
 *
 * @module api/TextToolCallParser
 */

/**
 * A tool invocation extracted from unstructured LLM text output.
 *
 * Maps directly onto the `ToolCallRecord` shape used by {@link generateText},
 * but uses `arguments` instead of `args` to match the canonical tool-call wire
 * format before execution.
 */
export interface ParsedToolCall {
  /** Name of the tool to invoke, as it appears in the tool registry. */
  name: string;
  /** Parsed argument object to pass to the tool's `execute` function. */
  arguments: Record<string, unknown>;
}

/**
 * Extracts tool calls embedded in a JSON markdown code fence.
 *
 * Matches ```json blocks whose body contains a top-level object with either
 * `"tool"` or `"name"` plus `"arguments"` (or `"input"` / `"parameters"`).
 * Also handles fenced arrays of such objects.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed tool calls found in fenced JSON blocks (may be empty).
 */
function parseJsonFences(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // Match ```json ... ``` blocks (case-insensitive language tag)
  const fencePattern = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const body = match[1].trim();
    if (!body) continue;

    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;

        const name = item.tool ?? item.name ?? item.function;
        const args =
          item.arguments ?? item.input ?? item.parameters ?? item.params ?? {};

        if (typeof name === 'string' && name.length > 0) {
          results.push({
            name,
            arguments: typeof args === 'object' && args !== null ? args : {},
          });
        }
      }
    } catch {
      // Malformed JSON — skip this fence silently
    }
  }

  return results;
}

/**
 * Extracts tool calls from ReAct-style `Action: ... / Input: ...` blocks.
 *
 * The parser is line-oriented: it scans for `Action:` lines and then looks
 * for a subsequent `Input:` line whose value is valid JSON.  An `Action:`
 * without a following `Input:` is accepted with an empty argument object.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed tool calls found via the Action/Input pattern (may be empty).
 */
function parseReActStyle(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // Match Action/Input pairs (multiline, case-insensitive keys)
  const actionPattern = /^[ \t]*Action\s*:\s*(.+)$/gim;
  let actionMatch: RegExpExecArray | null;

  while ((actionMatch = actionPattern.exec(text)) !== null) {
    const name = actionMatch[1].trim();
    if (!name) continue;

    // Look for a subsequent Input: line after this Action: line
    const afterAction = text.slice(actionMatch.index + actionMatch[0].length);
    const inputMatch = afterAction.match(/^[ \t]*Input\s*:\s*([\s\S]*?)(?=\n[ \t]*(?:Action|Thought|Observation)\s*:|$)/im);

    let args: Record<string, unknown> = {};
    if (inputMatch) {
      const rawInput = inputMatch[1].trim();
      if (rawInput) {
        try {
          const parsed = JSON.parse(rawInput);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            args = parsed;
          }
        } catch {
          // Non-JSON input — treat as a single string argument
          args = { input: rawInput };
        }
      }
    }

    results.push({ name, arguments: args });
  }

  return results;
}

/**
 * Deduplicate semantic duplicates while preserving first-seen order.
 *
 * Models sometimes emit the same tool call twice in different encodings
 * (for example a JSON fence followed by a ReAct `Action/Input` block). The
 * high-level tool loop should execute that intent once, not once per format.
 */
function dedupeToolCalls(calls: ParsedToolCall[]): ParsedToolCall[] {
  const seen = new Set<string>();
  const deduped: ParsedToolCall[] = [];

  for (const call of calls) {
    const key = `${call.name}\u0000${JSON.stringify(call.arguments ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(call);
  }

  return deduped;
}

/**
 * Parses tool invocations from an LLM's plain-text response.
 *
 * This is the primary entry point for the text-based tool-call fallback.
 * It first attempts to extract JSON tool calls from markdown code fences
 * (Format A), then falls back to ReAct-style `Action: / Input:` patterns
 * (Format B). Semantic duplicates are removed while preserving first-seen
 * order so the same tool invocation is not executed twice.
 *
 * @param text - Raw text from an LLM response.
 * @returns An array of parsed tool calls, or an empty array if none were found.
 *
 * @example
 * ```ts
 * const calls = parseToolCallsFromText(responseText);
 * for (const call of calls) {
 *   console.log(`Tool: ${call.name}, Args:`, call.arguments);
 * }
 * ```
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  if (!text || typeof text !== 'string') return [];

  const fromFences = parseJsonFences(text);
  const fromReAct = parseReActStyle(text);

  return dedupeToolCalls([...fromFences, ...fromReAct]);
}
