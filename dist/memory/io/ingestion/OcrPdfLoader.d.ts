/**
 * @fileoverview OcrPdfLoader — optional OCR-based PDF loader using Tesseract.js.
 *
 * This module provides a factory function {@link createOcrPdfLoader} that
 * attempts to lazy-load `tesseract.js` at runtime.  When the package is not
 * installed the factory returns `null` gracefully so callers can treat OCR as
 * fully opt-in without any hard dependency.
 *
 * ### Opting in
 * ```sh
 * pnpm add tesseract.js
 * ```
 *
 * Once installed, pass the result of {@link createOcrPdfLoader} to
 * {@link PdfLoader}'s constructor as the `ocrLoader` argument.
 *
 * @module memory/ingestion/OcrPdfLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
/**
 * Checks whether `tesseract.js` is available in the current environment and,
 * if so, returns a new OCR PDF loader instance; otherwise returns `null`.
 *
 * The check is performed by attempting to resolve the package path using
 * Node's `createRequire`.  This avoids a full async dynamic import at call
 * time while still being accurate.
 *
 * ### Usage
 * ```ts
 * import { createOcrPdfLoader } from './OcrPdfLoader.js';
 * import { PdfLoader } from './PdfLoader.js';
 *
 * const ocrLoader = createOcrPdfLoader();
 * const loader = new PdfLoader(ocrLoader);
 * ```
 *
 * @returns An OCR PDF loader instance when tesseract.js is installed, or
 *          `null` when it is not.
 */
export declare function createOcrPdfLoader(): IDocumentLoader | null;
//# sourceMappingURL=OcrPdfLoader.d.ts.map