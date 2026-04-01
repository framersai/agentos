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
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Extensions this loader handles. */
const SUPPORTED_EXTENSIONS = ['.pdf'];
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Returns the lower-cased extension (with dot) of a file path.
 *
 * @param filePath - Absolute or relative file path.
 */
function extOf(filePath) {
    return path.extname(filePath).toLowerCase();
}
// ---------------------------------------------------------------------------
// OcrPdfLoader (internal class)
// ---------------------------------------------------------------------------
/**
 * Internal loader implementation. Consumers should use `createOcrPdfLoader()`
 * rather than instantiating this class directly, as the factory performs the
 * availability check and returns `null` when tesseract.js is absent.
 *
 * @implements {IDocumentLoader}
 */
class OcrPdfLoader {
    constructor() {
        /** @inheritdoc */
        this.supportedExtensions = [...SUPPORTED_EXTENSIONS];
    }
    // -------------------------------------------------------------------------
    // canLoad
    // -------------------------------------------------------------------------
    /** @inheritdoc */
    canLoad(source) {
        if (Buffer.isBuffer(source)) {
            // Detect PDF magic bytes: %PDF- at offset 0.
            return (source.length >= 4 &&
                source[0] === 0x25 &&
                source[1] === 0x50 &&
                source[2] === 0x44 &&
                source[3] === 0x46);
        }
        return SUPPORTED_EXTENSIONS.includes(extOf(source));
    }
    // -------------------------------------------------------------------------
    // load
    // -------------------------------------------------------------------------
    /** @inheritdoc */
    async load(source, _options) {
        let buffer;
        let resolvedPath;
        if (Buffer.isBuffer(source)) {
            buffer = source;
        }
        else {
            resolvedPath = source;
            buffer = await fs.readFile(resolvedPath);
        }
        // Attempt to dynamically import tesseract.js.  The import is wrapped in
        // try/catch so a missing package yields a clear message rather than a
        // cryptic MODULE_NOT_FOUND stack trace.  We use `any` here so that the
        // optional peer dependency does not require installed type declarations.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let Tesseract;
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — optional peer dependency; types not guaranteed to be installed
            Tesseract = await import('tesseract.js');
        }
        catch {
            throw new Error('OcrPdfLoader: tesseract.js is not installed.  ' +
                'Run `pnpm add tesseract.js` (or the equivalent for your package manager) ' +
                'to enable OCR-based PDF extraction.');
        }
        // Perform OCR on the raw PDF bytes.
        // Tesseract.js accepts a Buffer, base64 string, Blob, or image URL.
        // For PDF buffers we pass the raw bytes and let Tesseract handle decoding.
        const { data: { text }, } = await Tesseract.recognize(buffer, 'eng', {
            logger: () => {
                /* suppress progress output */
            },
        });
        const meta = {
            ...(resolvedPath ? { source: resolvedPath } : {}),
        };
        return {
            content: text,
            metadata: meta,
            format: 'pdf',
        };
    }
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
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
export function createOcrPdfLoader() {
    try {
        // createRequire lets us resolve package paths from an ESM context without
        // actually importing the module.  If resolve throws, the package is absent.
        const require = createRequire(import.meta.url);
        require.resolve('tesseract.js');
        // Package is resolvable — return a loader instance.
        return new OcrPdfLoader();
    }
    catch {
        // Package not installed — OCR is unavailable.
        return null;
    }
}
//# sourceMappingURL=OcrPdfLoader.js.map