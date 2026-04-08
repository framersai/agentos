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
export function extractJson(rawText: string): string | null {
  if (!rawText || rawText.trim().length === 0) return null;

  const trimmed = rawText.trim();

  // Strategy 1: Raw JSON — entire string is valid JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Not valid raw JSON — fall through to other strategies
    }
  }

  // Strategy 2: Markdown fenced blocks — ```json ... ``` or ``` ... ```
  const fencedMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fencedMatch) {
    const content = fencedMatch[1].trim();
    try {
      JSON.parse(content);
      return content;
    } catch {
      // Fenced block wasn't valid JSON — fall through
    }
  }

  // Strategy 3: Strip <thinking>...</thinking> blocks, then retry.
  // Chain-of-thought reasoning often precedes the actual JSON output.
  if (trimmed.includes('<thinking>')) {
    const stripped = trimmed.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    if (stripped.length > 0 && stripped !== trimmed) {
      const result = extractJson(stripped);
      if (result) return result;
    }
  }

  // Strategy 4: JSONL — multiple JSON objects on separate lines.
  // Common in MemoryObserver and MemoryReflector output where the LLM
  // outputs one JSON object per observation/trace on its own line.
  // Checked BEFORE brace matching so multi-line output isn't truncated
  // to just the first object.
  const lines = trimmed.split('\n').filter((l) => l.trim());
  if (lines.length >= 2) {
    const jsonObjects: unknown[] = [];
    for (const line of lines) {
      const clean = line.trim();
      try {
        const parsed = JSON.parse(clean);
        if (typeof parsed === 'object' && parsed !== null) {
          jsonObjects.push(parsed);
        }
      } catch {
        // Skip non-JSON lines (common in LLM output with commentary)
      }
    }
    if (jsonObjects.length >= 2) {
      return JSON.stringify(jsonObjects);
    }
  }

  // Strategy 5: First {...} or [...] via greedy brace/bracket matching.
  // Handles JSON embedded in prose like "Here is the result: {...} done."
  const braceResult = extractByBraceMatching(trimmed);
  if (braceResult) return braceResult;

  return null;
}

/**
 * Extract the first balanced JSON object or array from text using
 * brace/bracket depth counting. Handles nested structures and
 * string escaping correctly.
 *
 * @param text - Text that may contain embedded JSON
 * @returns Extracted JSON string, or null if no balanced structure found
 */
function extractByBraceMatching(text: string): string | null {
  // Find the first { or [
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');

  // Pick whichever comes first
  let start: number;
  let openChar: string;
  let closeChar: string;

  if (objectStart === -1 && arrayStart === -1) return null;
  if (objectStart === -1) {
    start = arrayStart;
    openChar = '[';
    closeChar = ']';
  } else if (arrayStart === -1) {
    start = objectStart;
    openChar = '{';
    closeChar = '}';
  } else if (objectStart <= arrayStart) {
    start = objectStart;
    openChar = '{';
    closeChar = '}';
  } else {
    start = arrayStart;
    openChar = '[';
    closeChar = ']';
  }

  // Walk forward counting depth, handling string escaping.
  // This correctly handles nested {"a": {"b": [1, 2]}} structures
  // and escaped quotes inside strings like {"content": "she said \"hello\""}.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;

    if (depth === 0) {
      const candidate = text.slice(start, i + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return null;
      }
    }
  }

  return null;
}
