/**
 * @fileoverview Centralized JSON extraction from messy LLM output.
 *
 * LLMs return structured data in many formats: raw JSON, markdown-fenced
 * blocks, JSON wrapped in prose, JSONL, or JSON preceded by chain-of-thought
 * `<thinking>` blocks. This module handles all of them with a priority-ordered
 * extraction pipeline.
 *
 * Replaces the ad-hoc `JSON.parse` + `match()` + `split('\n')` patterns
 * duplicated across 30+ files in AgentOS and wilds-ai.
 *
 * @module agentos/core/validation/extractJson
 */
/**
 * Extract JSON from raw LLM output text.
 *
 * Tries multiple extraction strategies in priority order:
 * 1. Raw JSON (entire string is valid JSON)
 * 2. Markdown fenced blocks (```json ... ``` or ``` ... ```)
 * 3. Strip `<thinking>` blocks, then retry
 * 4. First `{...}` or `[...]` via greedy brace/bracket matching
 * 5. JSONL (multiple JSON objects on separate lines → array)
 *
 * @param rawText - Raw LLM output that may contain JSON
 * @returns Extracted JSON string, or null if no valid JSON found
 *
 * @example
 * ```ts
 * extractJson('```json\n{"key": "value"}\n```') // '{"key": "value"}'
 * extractJson('<thinking>hmm</thinking>\n{"a":1}') // '{"a":1}'
 * extractJson('no json here') // null
 * ```
 */
export declare function extractJson(rawText: string): string | null;
//# sourceMappingURL=extractJson.d.ts.map