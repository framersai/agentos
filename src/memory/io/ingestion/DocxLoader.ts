/**
 * @fileoverview DocxLoader — loads `.docx` documents using `mammoth`.
 *
 * The `mammoth` library extracts raw text from OOXML (Office Open XML) Word
 * documents by stripping all formatting and returning the plain-text content.
 * This keeps the ingestion pipeline fast and dependency-light while still
 * producing high-quality text suitable for chunking and embedding.
 *
 * @module memory/ingestion/DocxLoader
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument, DocumentMetadata } from '../../io/facade/types.js';
import { validatePath } from './pathUtils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions handled by this loader, each with a leading dot. */
const SUPPORTED_EXTENSIONS = ['.docx'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the lower-cased extension (with dot) of a file path.
 *
 * @param filePath - Absolute or relative file path.
 */
function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Count the approximate number of words in a string.
 *
 * Splits on runs of whitespace — intentionally lightweight for the typical
 * document sizes encountered during ingestion.
 *
 * @param text - Raw text to count.
 */
function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// DocxLoader
// ---------------------------------------------------------------------------

/**
 * Document loader for Microsoft Word (`.docx`) files.
 *
 * Uses `mammoth.extractRawText()` to strip all styling and return plain
 * prose text, which is then stored as the `content` field.  The `metadata`
 * block includes an approximate `wordCount`.
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new DocxLoader();
 * const doc = await loader.load('/docs/spec.docx');
 * console.log(doc.metadata.wordCount); // e.g. 1842
 * ```
 */
export class DocxLoader implements IDocumentLoader {
  /** @inheritdoc */
  readonly supportedExtensions: string[] = [...SUPPORTED_EXTENSIONS];

  // -------------------------------------------------------------------------
  // canLoad
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  canLoad(source: string | Buffer): boolean {
    if (Buffer.isBuffer(source)) {
      // OOXML magic: PK zip signature (0x50 0x4B 0x03 0x04).
      // .docx files are ZIP archives — check for the PK header.
      return source.length >= 4 &&
        source[0] === 0x50 && source[1] === 0x4B &&
        source[2] === 0x03 && source[3] === 0x04;
    }
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(source) as '.docx');
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument> {
    let buffer: Buffer;
    let resolvedPath: string | undefined;

    if (Buffer.isBuffer(source)) {
      buffer = source;
    } else {
      resolvedPath = validatePath(source);
      buffer = await fs.readFile(resolvedPath);
    }

    // mammoth.extractRawText strips all OOXML formatting and returns plain text.
    // The `buffer` option accepts a Node Buffer directly (no temp file needed).
    const result = await mammoth.extractRawText({ buffer });

    // `result.value` is the extracted text; `result.messages` holds any
    // conversion warnings (ignored here — they're rarely actionable for
    // text-only extraction).
    const content = result.value;

    const meta: DocumentMetadata = {
      wordCount: wordCount(content),
      ...(resolvedPath ? { source: resolvedPath } : {}),
    };

    return {
      content,
      metadata: meta,
      format: 'docx',
    };
  }
}
