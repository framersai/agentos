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
export declare function parseToolCallsFromText(text: string): ParsedToolCall[];
//# sourceMappingURL=TextToolCallParser.d.ts.map