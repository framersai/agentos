/**
 * @fileoverview UrlLoader — fetch-and-delegate loader for HTTP/HTTPS URLs.
 *
 * `UrlLoader` implements {@link IDocumentLoader} and handles `http://` and
 * `https://` sources.  It fetches the remote resource, inspects the
 * `Content-Type` response header, and delegates to the most appropriate
 * registered loader:
 *
 * - `text/html` → {@link HtmlLoader} (via the registry)
 * - `application/pdf` → {@link PdfLoader} (via the registry)
 * - Anything else → raw UTF-8 text, format `'text'`
 *
 * Because URLs have no file extension in the traditional sense,
 * `supportedExtensions` is deliberately empty.  Routing to `UrlLoader` must
 * be done explicitly — either by calling `UrlLoader.load()` directly or by
 * checking `UrlLoader.canLoad()` before dispatching.
 *
 * @module memory/ingestion/UrlLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
import type { LoaderRegistry } from './LoaderRegistry.js';
/**
 * An {@link IDocumentLoader} that fetches a remote URL and delegates parsing
 * to the appropriate registered loader based on the response `Content-Type`.
 *
 * ### Supported content types
 * | Content-Type          | Delegates to          |
 * |-----------------------|-----------------------|
 * | `text/html`           | HtmlLoader (registry) |
 * | `application/pdf`     | PdfLoader  (registry) |
 * | Everything else       | Plain UTF-8 text      |
 *
 * ### Example
 * ```ts
 * const registry = new LoaderRegistry();
 * const urlLoader = new UrlLoader(registry);
 *
 * // Register so the registry also dispatches URLs via canLoad checks.
 * // (Optional — UrlLoader can be used standalone too.)
 *
 * if (urlLoader.canLoad('https://example.com/report.pdf')) {
 *   const doc = await urlLoader.load('https://example.com/report.pdf');
 *   console.log(doc.format); // 'pdf'
 * }
 * ```
 *
 * @implements {IDocumentLoader}
 */
export declare class UrlLoader implements IDocumentLoader {
    private readonly registry;
    /**
     * URLs have no file extension so this array is always empty.
     *
     * Routing to this loader must be performed via {@link canLoad} rather than
     * the registry's extension-based lookup.
     */
    readonly supportedExtensions: string[];
    /**
     * @param registry - The {@link LoaderRegistry} used to resolve format-specific
     *                   loaders once the remote content type is known.
     */
    constructor(registry: LoaderRegistry);
    /**
     * Returns `true` when `source` is a string that starts with `http://` or
     * `https://`.
     *
     * Buffer sources are always rejected — raw bytes cannot be a URL.
     *
     * @param source - Absolute file path, URL string, or raw bytes.
     */
    canLoad(source: string | Buffer): boolean;
    /**
     * Fetch `source` over HTTP/HTTPS and return a {@link LoadedDocument}.
     *
     * The response body is buffered in memory and then handed to the appropriate
     * sub-loader according to the `Content-Type` header:
     *
     * - `text/html` → fetched as text, passed to the HTML loader as a `Buffer`.
     * - `application/pdf` → fetched as bytes, passed to the PDF loader as a
     *    `Buffer`.
     * - Anything else → returned as plain text with format `'text'` and
     *   `source` metadata set to the URL.
     *
     * @param source  - HTTP/HTTPS URL string.
     * @param options - Optional load hints forwarded to the delegated loader.
     * @returns A promise resolving to the {@link LoadedDocument}.
     *
     * @throws {Error} When `source` is a `Buffer` (URLs must be strings).
     * @throws {Error} When the HTTP request fails (network error or non-2xx
     *                 status).
     */
    load(source: string | Buffer, options?: LoadOptions): Promise<LoadedDocument>;
}
//# sourceMappingURL=UrlLoader.d.ts.map