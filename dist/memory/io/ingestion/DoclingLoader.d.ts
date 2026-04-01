/**
 * @fileoverview DoclingLoader — high-fidelity PDF/DOCX extraction via Python Docling.
 *
 * Docling (https://github.com/DS4SD/docling) is an IBM Research open-source
 * library that converts PDFs and office documents to structured JSON, preserving
 * tables, figures, and layout information far beyond what pure-JS text extraction
 * can achieve.
 *
 * This module provides a factory function {@link createDoclingLoader} that:
 * 1. Checks whether `python3 -m docling --version` succeeds in the current PATH.
 * 2. If it does, returns a Docling-backed loader instance that spawns a
 *    `python3 -m docling` subprocess for each document.
 * 3. If Docling is not installed, returns `null` gracefully.
 *
 * ### Opting in
 * ```sh
 * pip install docling
 * ```
 *
 * @module memory/ingestion/DoclingLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
/**
 * Checks whether `python3 -m docling` is available in the current environment
 * and, if so, returns a new Docling-backed loader instance; otherwise returns
 * `null`.
 *
 * The availability check runs `python3 -m docling --version` synchronously
 * via `spawnSync` — it exits quickly and is only called once during registry
 * initialisation.
 *
 * ### Usage
 * ```ts
 * import { createDoclingLoader } from './DoclingLoader.js';
 * import { PdfLoader } from './PdfLoader.js';
 *
 * const doclingLoader = createDoclingLoader();
 * const loader = new PdfLoader(null, doclingLoader);
 * ```
 *
 * @returns A Docling-backed loader instance when Docling is installed, or `null`.
 */
export declare function createDoclingLoader(): IDocumentLoader | null;
//# sourceMappingURL=DoclingLoader.d.ts.map