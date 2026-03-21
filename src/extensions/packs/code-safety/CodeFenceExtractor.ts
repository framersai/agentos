/**
 * @file CodeFenceExtractor.ts
 * @description Extracts code blocks from Markdown-fenced text and provides
 * heuristic language detection for blocks that lack an explicit language tag.
 *
 * ## Overview
 *
 * Markdown triple-backtick fences are the primary source of code blocks that
 * the code safety scanner needs to examine.  This module handles:
 *
 * 1. **Extraction** — parsing ` ```lang\ncode\n``` ` fences with correct
 *    byte offsets so violations can be mapped back to the original text.
 *
 * 2. **Alias normalisation** — common informal language aliases such as `ts`,
 *    `js`, `py`, and `sh` are canonicalised to their full names before being
 *    stored in {@link CodeBlock.language}.
 *
 * 3. **Language detection** — a cascade of heuristic patterns identifies the
 *    most likely programming language for blocks that omit a language tag.
 *
 * @module code-safety/CodeFenceExtractor
 */

import type { CodeBlock } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regular expression that matches a complete Markdown code fence.
 *
 * Groups:
 * 1. Optional language identifier after the opening backticks (may be empty).
 * 2. The code content between the fences (may include newlines).
 *
 * The `g` flag enables repeated `exec()` calls to find all fences in a text.
 * The `s` (dotAll) flag ensures `.` inside group 2 matches newlines so
 * multi-line code bodies are captured correctly.
 */
const CODE_FENCE_RE = /^```([^\n`]*)\n([\s\S]*?)^```\s*$/gm;

/**
 * Map of informal language aliases to their canonical normalised names.
 *
 * Keys are lower-cased alias strings; values are the normalised names used
 * throughout the scanner and rule {@link ICodeSafetyRule.patterns} maps.
 *
 * Only short-hand aliases are listed here.  Full canonical names (e.g.
 * `'python'`, `'javascript'`) pass through unchanged.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  // JavaScript aliases
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // TypeScript aliases
  ts: 'typescript',
  tsx: 'typescript',

  // Python aliases
  py: 'python',
  py3: 'python',
  python3: 'python',

  // Shell / Bash aliases
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ksh: 'bash',

  // SQL aliases
  mysql: 'sql',
  psql: 'sql',
  sqlite: 'sql',
  pgsql: 'sql',
};

// ---------------------------------------------------------------------------
// Language detection heuristics
// ---------------------------------------------------------------------------

/**
 * Heuristic cascade used by {@link detectLanguage} to infer the programming
 * language of a code snippet when no explicit language tag is available.
 *
 * Each entry defines:
 * - `language` — the normalised language name to return on a match
 * - `patterns` — array of RegExp; ANY match triggers identification
 *
 * The cascade is evaluated in declaration order; the **first** language whose
 * patterns match wins.  Languages with more distinctive syntax are listed
 * earlier to avoid misidentification.
 */
const DETECTION_CASCADE: Array<{ language: string; patterns: RegExp[] }> = [
  {
    // Python is identified by def/class declarations and import style.
    language: 'python',
    patterns: [
      /\bdef\s+\w+\s*\(/,       // function definition: def foo(
      /\bfrom\s+\w[\w.]*\s+import\b/, // from module import ...
      /^import\s+\w/m,           // top-level import statement
      /:\s*$\n\s{4}/m,           // indented block after colon (typical Python)
    ],
  },
  {
    // SQL is identified by DML/DDL keywords (case-insensitive).
    language: 'sql',
    patterns: [
      /\bSELECT\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bDROP\s+TABLE\b/i,
    ],
  },
  {
    // Ruby: class ... end, each do ... end blocks, or string interpolation #{}.
    language: 'ruby',
    patterns: [
      /\bclass\s+\w+\s*<\s*\w/,    // class Foo < Bar
      /\.\s*each\s+do\s*\|/,       // .each do |x|
      /#\{[^}]+\}/,                // string interpolation #{expr}
      /\bend\s*$/m,                // end keyword at line end
    ],
  },
  {
    // PHP: opening tag or $variable = ...
    language: 'php',
    patterns: [
      /<\?php\b/,
      /\$[a-zA-Z_]\w*\s*=/,        // $var = value
    ],
  },
  {
    // Bash: shebang line or classic if [ ... ] test expressions.
    language: 'bash',
    patterns: [
      /^#!\s*\/(?:bin\/(?:ba)?sh|usr\/bin\/env\s+(?:ba)?sh)/m, // shebang
      /\bif\s+\[/,                  // if [ condition ]
      /\becho\s+["']/,              // echo "..."
      /\$\(\s*\w+/,                 // command substitution $(cmd
    ],
  },
  {
    // Go: package declaration or func keyword.
    language: 'go',
    patterns: [
      /^package\s+\w+/m,            // package main
      /\bfunc\s+\w+\s*\(/,          // func foo(
      /\bfmt\.Print/,               // fmt.Println(...)
    ],
  },
  {
    // Java: public class or System.out usage.
    language: 'java',
    patterns: [
      /\bpublic\s+class\s+\w+/,     // public class Foo
      /\bSystem\.out\.\w+\s*\(/,    // System.out.println(
      /\bimport\s+java\./,          // import java.util.*
    ],
  },
  {
    // JavaScript/TypeScript: function declarations, arrow functions, require().
    // Listed AFTER Ruby/PHP/Bash/Go/Java so those more distinctive patterns win.
    language: 'javascript',
    patterns: [
      /\bfunction\s+\w+\s*\(/,      // function foo(
      /\bconst\s+\w+\s*=/,          // const x =
      /=>/,                          // arrow function =>
      /\brequire\s*\(/,             // require(...)
      /\bconsole\.\w+\s*\(/,        // console.log(
    ],
  },
];

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Extract all Markdown triple-backtick code fences from a text string.
 *
 * Each returned {@link CodeBlock} includes:
 * - The raw code inside the fence (without delimiter lines)
 * - The normalised language tag (or `null` when none was provided)
 * - The start/end offsets of the **entire fence** (including delimiters) in
 *   the original `text` string
 *
 * ### Extraction rules
 * - Only **closed** fences (opening ` ``` ` matched by a closing ` ``` `) are
 *   returned.  Unclosed fences are silently ignored.
 * - Language aliases are normalised via {@link normaliseLanguage}.
 * - Blocks with empty code content are still returned (e.g. an empty snippet).
 *
 * @param text - Raw Markdown or freeform text that may contain code fences.
 * @returns Array of {@link CodeBlock}s in document order.
 *
 * @example
 * ```ts
 * const blocks = extractCodeBlocks('```python\nprint("hi")\n```');
 * // → [{ code: 'print("hi")\n', language: 'python', start: 0, end: 23 }]
 * ```
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  // Guard against empty / non-string input to avoid regex edge cases.
  if (!text || typeof text !== 'string') {
    return [];
  }

  const blocks: CodeBlock[] = [];

  // Reset lastIndex before iteration to guard against stale state if the
  // same regex object is somehow shared across calls (shouldn't happen with
  // module-level const, but defensive programming is cheap here).
  CODE_FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = CODE_FENCE_RE.exec(text)) !== null) {
    // match[0] = full match (opening fence + code + closing fence)
    // match[1] = optional language tag (may be empty string)
    // match[2] = code content

    const rawLang = match[1].trim();
    const code = match[2]; // raw code string between the fences

    // Normalise the language tag: empty string → null, alias → canonical name.
    const language = rawLang.length > 0 ? normaliseLanguage(rawLang) : null;

    // Record offsets of the entire fence in the original text.
    const start = match.index;
    const end = match.index + match[0].length;

    blocks.push({ code, language, start, end });
  }

  return blocks;
}

/**
 * Attempt to identify the programming language of a code snippet using a
 * cascade of heuristic RegExp patterns.
 *
 * The cascade is evaluated in order; the **first** language whose patterns
 * produce a match is returned.  This means languages with more distinctive
 * syntax should be tested before languages with generic constructs
 * (the cascade order is tuned accordingly).
 *
 * @param code - Raw source code string to analyse.
 * @returns Normalised language identifier (e.g. `'python'`), or `null` when
 *          no language can be determined with confidence.
 *
 * @example
 * ```ts
 * detectLanguage('SELECT * FROM users');       // → 'sql'
 * detectLanguage('def greet(name): pass');     // → 'python'
 * detectLanguage('hello world');               // → null
 * ```
 */
export function detectLanguage(code: string): string | null {
  if (!code || typeof code !== 'string') {
    return null;
  }

  for (const { language, patterns } of DETECTION_CASCADE) {
    // A language is identified when ANY of its patterns match the code.
    if (patterns.some((re) => re.test(code))) {
      return language;
    }
  }

  // No cascade entry matched — language is unknown.
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a raw language tag from a code fence to a canonical name.
 *
 * Applies lower-casing first, then checks the {@link LANGUAGE_ALIASES} map
 * for known short-hand aliases.  If the tag is not an alias, the lower-cased
 * tag itself is returned as-is (e.g. `'python'`, `'ruby'`, `'go'`).
 *
 * @param rawLang - Raw language tag string from the opening fence line.
 * @returns Canonical, lower-cased language identifier.
 *
 * @internal
 */
function normaliseLanguage(rawLang: string): string {
  const lower = rawLang.toLowerCase();
  return LANGUAGE_ALIASES[lower] ?? lower;
}
