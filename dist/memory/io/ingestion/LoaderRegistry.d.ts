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
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
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
export declare class LoaderRegistry {
    /**
     * Internal map from lower-cased extension (with dot) to the loader
     * responsible for that extension.
     *
     * When multiple loaders claim the same extension the last one registered
     * wins (newest-registration-wins semantics), allowing callers to override
     * built-in loaders.
     */
    private readonly _loaders;
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
    constructor();
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
    register(loader: IDocumentLoader): void;
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
    getLoader(extensionOrPath: string): IDocumentLoader | undefined;
    /**
     * Return a sorted array of all extensions currently registered.
     *
     * Each extension is returned with a leading dot in lower-case, e.g.
     * `['.csv', '.htm', '.html', '.json', '.md', …]`.
     *
     * @returns Sorted array of registered extension strings.
     */
    getSupportedExtensions(): string[];
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
    loadFile(filePath: string, options?: LoadOptions): Promise<LoadedDocument>;
}
//# sourceMappingURL=LoaderRegistry.d.ts.map