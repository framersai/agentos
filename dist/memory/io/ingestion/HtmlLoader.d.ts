/**
 * @fileoverview HtmlLoader — basic HTML-to-text document loader.
 *
 * Converts `.html` and `.htm` files into plain text using lightweight regex
 * transformations.  This is intentionally a *simple* loader — it covers the
 * common case of stripping tag soup and decoding standard HTML entities.  For
 * complex documents (nested frames, JavaScript-rendered content) a headless
 * browser or DOM-parsing library would be more appropriate.
 *
 * Supported extensions: `.html`, `.htm`
 *
 * @module memory/ingestion/HtmlLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
/**
 * Basic document loader for HTML (`.html`, `.htm`) files.
 *
 * ### Text extraction strategy
 * 1. `<script>` and `<style>` blocks are removed entirely.
 * 2. Block-level elements (`<p>`, `<div>`, `<h1>`–`<h6>`, etc.) are replaced
 *    with newline characters to preserve paragraph structure.
 * 3. All remaining HTML tags are stripped.
 * 4. A common subset of HTML entities is decoded.
 * 5. Excessive whitespace is collapsed.
 *
 * ### Metadata
 * - `title` — extracted from the `<title>` element when present.
 * - `wordCount` — approximate count of words in the extracted text.
 * - `source` — absolute file path (when loaded from disk).
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new HtmlLoader();
 * const doc = await loader.load('/public/index.html');
 * console.log(doc.metadata.title); // e.g. 'Welcome to AgentOS'
 * ```
 */
export declare class HtmlLoader implements IDocumentLoader {
    /** @inheritdoc */
    readonly supportedExtensions: string[];
    /** @inheritdoc */
    canLoad(source: string | Buffer): boolean;
    /** @inheritdoc */
    load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument>;
}
//# sourceMappingURL=HtmlLoader.d.ts.map