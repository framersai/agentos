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
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
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
export declare class PdfLoader implements IDocumentLoader {
    /** @inheritdoc */
    readonly supportedExtensions: string[];
    /**
     * Optional OCR fallback loader, engaged when primary extraction is sparse.
     * Pass `null` to disable OCR fallback.
     */
    private readonly _ocrLoader;
    /**
     * Optional Docling loader that, when present, takes precedence over the
     * entire unpdf + OCR pipeline.
     * Pass `null` to disable Docling.
     */
    private readonly _doclingLoader;
    /**
     * Creates a new PdfLoader.
     *
     * @param ocrLoader - Optional OCR fallback (for example from `createOcrPdfLoader()`).
     * @param doclingLoader - Optional Docling loader (for example from `createDoclingLoader()`).
     */
    constructor(ocrLoader?: IDocumentLoader | null, doclingLoader?: IDocumentLoader | null);
    /** @inheritdoc */
    canLoad(source: string | Buffer): boolean;
    /** @inheritdoc */
    load(source: string | Buffer, options?: LoadOptions): Promise<LoadedDocument>;
    /**
     * Extract text from a PDF buffer using the `unpdf` package.
     *
     * Returns the concatenated page text, the page count, and an optional title
     * string extracted from the PDF metadata dictionary when available.
     *
     * @param buffer - Raw PDF bytes.
     */
    private _extractWithUnpdf;
}
//# sourceMappingURL=PdfLoader.d.ts.map