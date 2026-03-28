/**
 * @fileoverview HtmlLoader — basic HTML-to-text document loader.
 *
 * Converts `.html` and `.htm` files into plain text using lightweight regex
 * transformations.  This is intentionally a *simple* loader — it covers the
 * common case of stripping tag soup and decoding standard HTML entities.  For
 * complex documents (nested frames, JavaScript-rendered content) a headless
 * browser or DOM-parsing library would be more appropriate.
 *
 * Supported extensions: `.html`, `.htm`
 *
 * @module memory/ingestion/HtmlLoader
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument, DocumentMetadata } from '../../io/facade/types.js';
import { validatePath } from './pathUtils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions handled by this loader, each with a leading dot. */
const SUPPORTED_EXTENSIONS = ['.html', '.htm'] as const;

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

/**
 * Strip all HTML/XML tags from a string.
 *
 * Handles multi-line tags and self-closing tags.  Does **not** attempt to
 * parse the HTML into a DOM; purely textual.
 *
 * @param html - Raw HTML string.
 */
function stripTags(html: string): string {
  // Remove `<script>…</script>` and `<style>…</style>` blocks entirely so
  // their content doesn't leak into the extracted text.
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // Replace block-level elements with newlines to preserve paragraph breaks.
  text = text.replace(/<\/?(p|div|section|article|header|footer|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n');

  // Replace `<br>` and `<hr>` with newlines.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n');

  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, '');

  return text;
}

/**
 * Decode a small but common set of named and numeric HTML entities.
 *
 * Covers the most frequently encountered entities in prose documents.
 * Full entity decoding would require an external library; this subset handles
 * ~95% of real-world cases without dependencies.
 *
 * @param text - Text containing HTML entity references.
 */
function decodeEntities(text: string): string {
  return text
    // Named character entities (most common subset).
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&ldquo;/gi, '\u201C')
    .replace(/&rdquo;/gi, '\u201D')
    .replace(/&copy;/gi, '©')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    // Numeric decimal entities: &#160; &#8212; etc.
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 10)),
    )
    // Numeric hexadecimal entities: &#x00A0; &#x2014; etc.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    );
}

/**
 * Extract the text content of the first `<title>` element, if present.
 *
 * Returns `undefined` when no `<title>` tag is found.
 *
 * @param html - Raw HTML string.
 */
function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  // Decode entities inside the title and trim surrounding whitespace.
  return decodeEntities(match[1]).trim() || undefined;
}

/**
 * Collapse repeated whitespace and blank lines in extracted text.
 *
 * Runs of more than two consecutive newlines are folded to two (paragraph
 * boundary).  Runs of horizontal whitespace within a line are collapsed to a
 * single space.
 *
 * @param text - Text with raw whitespace inherited from the HTML source.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')          // Collapse horizontal runs.
    .replace(/\n{3,}/g, '\n\n')       // Collapse blank-line runs.
    .trim();
}

/**
 * Approximate word count.
 *
 * @param text - Plain text string.
 */
function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/**
 * Returns the lower-cased extension of a file path.
 *
 * @param filePath - File path string.
 */
function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

// ---------------------------------------------------------------------------
// HtmlLoader
// ---------------------------------------------------------------------------

/**
 * Basic document loader for HTML (`.html`, `.htm`) files.
 *
 * ### Text extraction strategy
 * 1. `<script>` and `<style>` blocks are removed entirely.
 * 2. Block-level elements (`<p>`, `<div>`, `<h1>`–`<h6>`, etc.) are replaced
 *    with newline characters to preserve paragraph structure.
 * 3. All remaining HTML tags are stripped.
 * 4. A common subset of HTML entities is decoded.
 * 5. Excessive whitespace is collapsed.
 *
 * ### Metadata
 * - `title` — extracted from the `<title>` element when present.
 * - `wordCount` — approximate count of words in the extracted text.
 * - `source` — absolute file path (when loaded from disk).
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new HtmlLoader();
 * const doc = await loader.load('/public/index.html');
 * console.log(doc.metadata.title); // e.g. 'Welcome to AgentOS'
 * ```
 */
export class HtmlLoader implements IDocumentLoader {
  /** @inheritdoc */
  readonly supportedExtensions: string[] = [...SUPPORTED_EXTENSIONS];

  // -------------------------------------------------------------------------
  // canLoad
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  canLoad(source: string | Buffer): boolean {
    if (Buffer.isBuffer(source)) {
      return false;
    }
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(source));
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument> {
    let html: string;
    let resolvedPath: string | undefined;

    if (Buffer.isBuffer(source)) {
      html = source.toString('utf8');
    } else {
      resolvedPath = validatePath(source);
      const bytes = await fs.readFile(resolvedPath);
      html = bytes.toString('utf8');
    }

    // ---- Extract title before stripping tags ----
    const title = extractTitle(html);

    // ---- Convert HTML to plain text ----
    const rawText = stripTags(html);
    const decoded = decodeEntities(rawText);
    const content = normaliseWhitespace(decoded);

    // ---- Assemble metadata ----
    const meta: DocumentMetadata = {
      ...(title !== undefined ? { title } : {}),
      wordCount: wordCount(content),
      ...(resolvedPath ? { source: resolvedPath } : {}),
    };

    return {
      content,
      metadata: meta,
      format: 'html',
    };
  }
}
