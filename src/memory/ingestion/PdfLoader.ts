/**
 * @fileoverview PdfLoader — loads `.pdf` documents using `unpdf`.
 *
 * Implements a tiered extraction strategy:
 * 1. **unpdf** (Tier 1, always available) — pure-JS text extraction via
 *    `getDocumentProxy` + `extractText`.  Fast and dependency-free.
 * 2. **OCR fallback** (Tier 2, opt-in) — Tesseract.js OCR, engaged when the
 *    unpdf extraction produces sparse text (< 50 chars per page on average).
 * 3. **Docling fallback** (Tier 3, opt-in) — Python `docling` subprocess, engaged
 *    when explicitly configured via the `docling` loader option.
 *
 * Both fallback loaders are optional and injected via constructor parameters;
 * callers supply them by calling `createOcrPdfLoader()` and
 * `createDoclingLoader()` and checking for non-null values.
 *
 * @module memory/ingestion/PdfLoader
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument, DocumentMetadata } from '../facade/types.js';
import { validatePath } from './pathUtils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions handled by this loader, each with a leading dot. */
const SUPPORTED_EXTENSIONS = ['.pdf'] as const;

/**
 * Minimum average character count per page below which the primary extraction
 * result is considered sparse and a fallback strategy is engaged.
 */
const SPARSE_THRESHOLD_CHARS_PER_PAGE = 50;

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
 * Determine whether extracted text is considered sparse given the page count.
 *
 * Sparse text typically indicates a scanned PDF where textual content was not
 * embedded during creation and OCR is required.
 *
 * @param text      - Full extracted text.
 * @param pageCount - Number of pages in the document.
 */
function isSparse(text: string, pageCount: number): boolean {
  if (pageCount <= 0) return false;
  const avgCharsPerPage = text.length / pageCount;
  return avgCharsPerPage < SPARSE_THRESHOLD_CHARS_PER_PAGE;
}

// ---------------------------------------------------------------------------
// PdfLoader
// ---------------------------------------------------------------------------

/**
 * Document loader for PDF files.
 *
 * ### Extraction tiers
 * 1. **unpdf** — always used as the primary extraction engine.  Performs
 *    pure-JS PDF text layer extraction with no native binaries required.
 * 2. **OCR fallback** (optional) — supplied at construction time and engaged
 *    automatically when unpdf yields sparse text (< 50 chars per page on
 *    average), indicating a scanned document.
 * 3. **Docling fallback** (optional) — when provided, takes precedence over both
 *    unpdf and OCR, yielding the highest-fidelity extraction at the cost of
 *    requiring a Python runtime.
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const ocrLoader    = createOcrPdfLoader();   // null if tesseract.js absent
 * const doclingLoader = createDoclingLoader(); // null if docling absent
 * const pdfLoader = new PdfLoader(ocrLoader, doclingLoader);
 * const doc = await pdfLoader.load('/reports/q3.pdf');
 * ```
 */
export class PdfLoader implements IDocumentLoader {
  /** @inheritdoc */
  readonly supportedExtensions: string[] = [...SUPPORTED_EXTENSIONS];

  /**
   * Optional OCR fallback loader, engaged when primary extraction is sparse.
   * Pass `null` to disable OCR fallback.
   */
  private readonly _ocrLoader: IDocumentLoader | null;

  /**
   * Optional Docling loader that, when present, takes precedence over the
   * entire unpdf + OCR pipeline.
   * Pass `null` to disable Docling.
   */
  private readonly _doclingLoader: IDocumentLoader | null;

  /**
   * Creates a new PdfLoader.
   *
   * @param ocrLoader - Optional OCR fallback (for example from `createOcrPdfLoader()`).
   * @param doclingLoader - Optional Docling loader (for example from `createDoclingLoader()`).
   */
  constructor(
    ocrLoader: IDocumentLoader | null = null,
    doclingLoader: IDocumentLoader | null = null
  ) {
    this._ocrLoader = ocrLoader;
    this._doclingLoader = doclingLoader;
  }

  // -------------------------------------------------------------------------
  // canLoad
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  canLoad(source: string | Buffer): boolean {
    if (Buffer.isBuffer(source)) {
      // Detect PDF magic bytes: %PDF- at offset 0.
      return (
        source.length >= 4 &&
        source[0] === 0x25 &&
        source[1] === 0x50 &&
        source[2] === 0x44 &&
        source[3] === 0x46
      );
    }
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(source) as '.pdf');
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async load(source: string | Buffer, options?: LoadOptions): Promise<LoadedDocument> {
    // Prefer Docling when available — highest fidelity.
    if (this._doclingLoader !== null) {
      return this._doclingLoader.load(source, options);
    }

    // Read bytes from disk if a path was supplied.
    let buffer: Buffer;
    let resolvedPath: string | undefined;

    if (Buffer.isBuffer(source)) {
      buffer = source;
    } else {
      resolvedPath = validatePath(source);
      buffer = await fs.readFile(resolvedPath);
    }

    // Primary extraction via unpdf.
    const { content, pageCount, title } = await this._extractWithUnpdf(buffer);

    // If primary extraction is sparse and OCR is available, delegate entirely
    // to the OCR loader which has access to image-level content.
    if (isSparse(content, pageCount) && this._ocrLoader !== null) {
      return this._ocrLoader.load(source, options);
    }

    const meta: DocumentMetadata = {
      pageCount,
      ...(title ? { title } : {}),
      ...(resolvedPath ? { source: resolvedPath } : {}),
    };

    return {
      content,
      metadata: meta,
      format: 'pdf',
    };
  }

  // -------------------------------------------------------------------------
  // Private: unpdf extraction
  // -------------------------------------------------------------------------

  /**
   * Extract text from a PDF buffer using the `unpdf` package.
   *
   * Returns the concatenated page text, the page count, and an optional title
   * string extracted from the PDF metadata dictionary when available.
   *
   * @param buffer - Raw PDF bytes.
   */
  private async _extractWithUnpdf(buffer: Buffer): Promise<{
    content: string;
    pageCount: number;
    title?: string;
  }> {
    // Dynamic import keeps unpdf tree-shakeable and avoids module-resolution
    // errors in environments that don't bundle the package.
    const { getDocumentProxy, extractText } = await import('unpdf');

    // getDocumentProxy accepts a Uint8Array — wrap the Node Buffer.
    const doc = await getDocumentProxy(new Uint8Array(buffer));

    // Extract all pages at once.
    const { text } = await extractText(doc, { mergePages: true });

    // Attempt to read the Title field from the PDF info dictionary.
    let title: string | undefined;
    try {
      const metadata = await doc.getMetadata();
      const info = metadata?.info as Record<string, unknown> | undefined;
      if (info && typeof info['Title'] === 'string' && info['Title'].trim()) {
        title = info['Title'].trim();
      }
    } catch {
      // Metadata access is optional — swallow errors silently.
    }

    const pageCount = doc.numPages ?? 0;

    return { content: text, pageCount, title };
  }
}
