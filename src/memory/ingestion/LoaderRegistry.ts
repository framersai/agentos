/**
 * @fileoverview LoaderRegistry — extension-to-loader routing table.
 *
 * The registry maintains a map of file extensions to {@link IDocumentLoader}
 * implementations and provides a convenience `loadFile()` method that
 * auto-detects the format from a file path before delegating to the
 * appropriate loader.
 *
 * On construction the registry pre-registers five built-in loaders:
 * {@link TextLoader}, {@link MarkdownLoader}, {@link HtmlLoader},
 * {@link PdfLoader}, and {@link DocxLoader}.  In addition, the optional
 * OCR and Docling-backed loaders are registered when their
 * respective factories return non-null values (i.e. when `tesseract.js` and
 * `python3 -m docling` are available in the environment).
 *
 * Additional loaders can be added at runtime via {@link LoaderRegistry.register}.
 *
 * @module memory/ingestion/LoaderRegistry
 */

import path from 'node:path';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../facade/types.js';
import { TextLoader } from './TextLoader.js';
import { MarkdownLoader } from './MarkdownLoader.js';
import { HtmlLoader } from './HtmlLoader.js';
import { PdfLoader } from './PdfLoader.js';
import { DocxLoader } from './DocxLoader.js';
import { createOcrPdfLoader } from './OcrPdfLoader.js';
import { createDoclingLoader } from './DoclingLoader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the normalised extension from an arbitrary string.
 *
 * Accepts both bare extensions (`.pdf`, `pdf`) and full file paths
 * (`/docs/report.pdf`).  Always returns lower-cased with a leading dot, or
 * an empty string when no extension can be determined.
 *
 * @param extensionOrPath - Bare extension or full file path.
 *
 * @example
 * normaliseExt('.PDF')       // → '.pdf'
 * normaliseExt('file.PDF')   // → '.pdf'
 * normaliseExt('pdf')        // → '.pdf'
 * normaliseExt('/notes.md')  // → '.md'
 */
function normaliseExt(extensionOrPath: string): string {
  // If the input looks like a bare extension (with or without dot), normalise
  // it directly without treating it as a path.  A bare extension contains no
  // directory separators and at most one dot at position 0.
  const hasSeparator = extensionOrPath.includes('/') || extensionOrPath.includes('\\');
  const hasDotInMiddle = extensionOrPath.lastIndexOf('.') > 0;

  if (!hasSeparator && !hasDotInMiddle) {
    // Bare extension like 'pdf' or '.pdf'.
    const stripped = extensionOrPath.startsWith('.') ? extensionOrPath.slice(1) : extensionOrPath;
    return stripped ? `.${stripped.toLowerCase()}` : '';
  }

  return path.extname(extensionOrPath).toLowerCase();
}

// ---------------------------------------------------------------------------
// LoaderRegistry
// ---------------------------------------------------------------------------

/**
 * Central registry mapping file extensions to {@link IDocumentLoader}
 * implementations.
 *
 * ### Built-in loaders (registered automatically)
 * | Extensions                                         | Loader                |
 * |----------------------------------------------------|-----------------------|
 * | `.txt`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`  | {@link TextLoader}    |
 * | `.md`, `.mdx`                                     | {@link MarkdownLoader} |
 * | `.html`, `.htm`                                   | {@link HtmlLoader}    |
 * | `.pdf`                                            | {@link PdfLoader}     |
 * | `.docx`                                           | {@link DocxLoader}    |
 *
 * ### Conditional loaders (registered when available)
 * | Condition                     | Loader                                                  |
 * |-------------------------------|---------------------------------------------------------|
 * | `tesseract.js` installed      | factory from {@link createOcrPdfLoader} (overrides PDF) |
 * | `python3 -m docling` available | factory from {@link createDoclingLoader} (overrides PDF + DOCX) |
 *
 * ### Registering a custom loader
 * ```ts
 * const registry = new LoaderRegistry();
 * registry.register(new PdfLoader());
 * const doc = await registry.loadFile('/reports/q3.pdf');
 * ```
 *
 * ### Using loadFile
 * ```ts
 * const registry = new LoaderRegistry();
 * const doc = await registry.loadFile('/notes/meeting.md');
 * console.log(doc.metadata.title);
 * ```
 */
export class LoaderRegistry {
  /**
   * Internal map from lower-cased extension (with dot) to the loader
   * responsible for that extension.
   *
   * When multiple loaders claim the same extension the last one registered
   * wins (newest-registration-wins semantics), allowing callers to override
   * built-in loaders.
   */
  private readonly _loaders: Map<string, IDocumentLoader> = new Map();

  /**
   * Creates a new registry pre-populated with the built-in loaders.
   *
   * Loader registration order determines conflict resolution: later
   * registrations override earlier ones for the same extension.
   *
   * Registration order:
   * 1. {@link TextLoader}, {@link MarkdownLoader}, {@link HtmlLoader} — core text formats.
   * 2. {@link PdfLoader} (with injected OCR + Docling loaders) — PDF extraction.
   * 3. {@link DocxLoader} — DOCX extraction.
   * 4. Optional: an override from {@link createOcrPdfLoader} when `tesseract.js` is installed.
   * 5. Optional: an override from {@link createDoclingLoader} when Python Docling is available.
   *    The Docling-backed loader supports both `.pdf` and `.docx`, so it supersedes both
   *    PdfLoader and DocxLoader when present.
   */
  constructor() {
    // Core text-format loaders.
    this.register(new TextLoader());
    this.register(new MarkdownLoader());
    this.register(new HtmlLoader());

    // Probe optional loaders before constructing PdfLoader so we can inject
    // them as fallbacks rather than having two separate registered instances.
    const ocrLoader = createOcrPdfLoader();
    const doclingLoader = createDoclingLoader();

    // PDF loader — passes optional fallbacks into the tier system.
    this.register(new PdfLoader(ocrLoader, doclingLoader));

    // DOCX loader.
    this.register(new DocxLoader());

    // When Docling is available register it separately so it also overrides
    // the DOCX extension (Docling supports both .pdf and .docx).
    if (doclingLoader !== null) {
      this.register(doclingLoader);
    }
  }

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  /**
   * Register a loader for all extensions it declares.
   *
   * If a previously registered loader already handles one of the extension,
   * it is replaced.  This makes it trivial to swap in a higher-fidelity
   * implementation for any format.
   *
   * @param loader - The loader instance to register.
   *
   * @example
   * ```ts
   * registry.register(new PdfLoader());
   * ```
   */
  register(loader: IDocumentLoader): void {
    for (const ext of loader.supportedExtensions) {
      this._loaders.set(ext.toLowerCase(), loader);
    }
  }

  // -------------------------------------------------------------------------
  // getLoader
  // -------------------------------------------------------------------------

  /**
   * Retrieve the loader registered for `extensionOrPath`.
   *
   * Both bare extensions (`.md`, `md`) and full file paths
   * (`/docs/guide.md`) are accepted.
   *
   * @param extensionOrPath - File extension or full path.
   * @returns The matching {@link IDocumentLoader}, or `undefined` when no
   *          loader is registered for the detected extension.
   *
   * @example
   * ```ts
   * const loader = registry.getLoader('.md');
   * const loader2 = registry.getLoader('README.md');
   * ```
   */
  getLoader(extensionOrPath: string): IDocumentLoader | undefined {
    const ext = normaliseExt(extensionOrPath);
    return this._loaders.get(ext);
  }

  // -------------------------------------------------------------------------
  // getSupportedExtensions
  // -------------------------------------------------------------------------

  /**
   * Return a sorted array of all extensions currently registered.
   *
   * Each extension is returned with a leading dot in lower-case, e.g.
   * `['.csv', '.htm', '.html', '.json', '.md', …]`.
   *
   * @returns Sorted array of registered extension strings.
   */
  getSupportedExtensions(): string[] {
    return [...this._loaders.keys()].sort();
  }

  // -------------------------------------------------------------------------
  // loadFile
  // -------------------------------------------------------------------------

  /**
   * Convenience method: detect format from `filePath`, find the matching
   * loader, and delegate to its `load()` method.
   *
   * @param filePath - Absolute (or resolvable relative) file path.
   * @param options  - Optional load hints forwarded to the loader.
   * @returns A promise resolving to the {@link LoadedDocument}.
   *
   * @throws {Error} When no loader is registered for the file's extension.
   * @throws {Error} When the underlying loader's `load()` throws.
   *
   * @example
   * ```ts
   * const doc = await registry.loadFile('/notes/architecture.md');
   * ```
   */
  async loadFile(filePath: string, options?: LoadOptions): Promise<LoadedDocument> {
    const loader = this.getLoader(filePath);

    if (!loader) {
      const ext = normaliseExt(filePath);
      throw new Error(
        `LoaderRegistry: no loader registered for extension "${ext}" (file: "${filePath}"). ` +
          `Supported extensions: ${this.getSupportedExtensions().join(', ')}.`
      );
    }

    return loader.load(filePath, options);
  }
}
