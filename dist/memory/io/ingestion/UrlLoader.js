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
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Prefix patterns that identify an HTTP/HTTPS URL. */
const URL_PREFIXES = ['http://', 'https://'];
// ---------------------------------------------------------------------------
// UrlLoader
// ---------------------------------------------------------------------------
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
export class UrlLoader {
    /**
     * @param registry - The {@link LoaderRegistry} used to resolve format-specific
     *                   loaders once the remote content type is known.
     */
    constructor(registry) {
        this.registry = registry;
        /**
         * URLs have no file extension so this array is always empty.
         *
         * Routing to this loader must be performed via {@link canLoad} rather than
         * the registry's extension-based lookup.
         */
        this.supportedExtensions = [];
    }
    // -------------------------------------------------------------------------
    // canLoad
    // -------------------------------------------------------------------------
    /**
     * Returns `true` when `source` is a string that starts with `http://` or
     * `https://`.
     *
     * Buffer sources are always rejected — raw bytes cannot be a URL.
     *
     * @param source - Absolute file path, URL string, or raw bytes.
     */
    canLoad(source) {
        if (Buffer.isBuffer(source))
            return false;
        return URL_PREFIXES.some((prefix) => source.startsWith(prefix));
    }
    // -------------------------------------------------------------------------
    // load
    // -------------------------------------------------------------------------
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
    async load(source, options) {
        if (Buffer.isBuffer(source)) {
            throw new Error('UrlLoader: source must be a URL string, not a Buffer.');
        }
        const url = source;
        // Fetch the remote resource.
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`UrlLoader: HTTP ${response.status} ${response.statusText} for URL "${url}".`);
        }
        // Determine content type from the response header, stripping parameters
        // such as `; charset=utf-8`.
        const contentTypeHeader = response.headers.get('content-type') ?? '';
        const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();
        // ------------------------------------------------------------------
        // Delegate based on content type.
        // ------------------------------------------------------------------
        if (contentType.includes('text/html')) {
            // Fetch as text and pass as a UTF-8 Buffer to the HTML loader.
            const text = await response.text();
            const htmlBuffer = Buffer.from(text, 'utf8');
            const htmlLoader = this.registry.getLoader('.html');
            if (htmlLoader) {
                const doc = await htmlLoader.load(htmlBuffer, options);
                // Attach the URL as the source metadata since the loader receives a
                // Buffer and cannot derive the origin URL itself.
                return {
                    ...doc,
                    metadata: { ...doc.metadata, source: url },
                };
            }
            // Fallback: return raw HTML text if no HTML loader is registered.
            return {
                content: text,
                metadata: { source: url, wordCount: text.trim().split(/\s+/).length },
                format: 'html',
            };
        }
        if (contentType.includes('application/pdf')) {
            // Fetch as bytes and pass as a Buffer to the PDF loader.
            const bytes = await response.arrayBuffer();
            const pdfBuffer = Buffer.from(bytes);
            const pdfLoader = this.registry.getLoader('.pdf');
            if (pdfLoader) {
                const doc = await pdfLoader.load(pdfBuffer, options);
                return {
                    ...doc,
                    metadata: { ...doc.metadata, source: url },
                };
            }
            // Fallback: cannot parse PDF without a loader.
            throw new Error(`UrlLoader: received application/pdf from "${url}" but no PDF loader is registered.`);
        }
        // Default: treat the response body as plain UTF-8 text.
        const text = await response.text();
        return {
            content: text,
            metadata: {
                source: url,
                wordCount: text.trim() === '' ? 0 : text.trim().split(/\s+/).length,
            },
            format: 'text',
        };
    }
}
//# sourceMappingURL=UrlLoader.js.map