/**
 * @fileoverview DocxLoader — loads `.docx` documents using `mammoth`.
 *
 * The `mammoth` library extracts raw text from OOXML (Office Open XML) Word
 * documents by stripping all formatting and returning the plain-text content.
 * This keeps the ingestion pipeline fast and dependency-light while still
 * producing high-quality text suitable for chunking and embedding.
 *
 * @module memory/ingestion/DocxLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
/**
 * Document loader for Microsoft Word (`.docx`) files.
 *
 * Uses `mammoth.extractRawText()` to strip all styling and return plain
 * prose text, which is then stored as the `content` field.  The `metadata`
 * block includes an approximate `wordCount`.
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new DocxLoader();
 * const doc = await loader.load('/docs/spec.docx');
 * console.log(doc.metadata.wordCount); // e.g. 1842
 * ```
 */
export declare class DocxLoader implements IDocumentLoader {
    /** @inheritdoc */
    readonly supportedExtensions: string[];
    /** @inheritdoc */
    canLoad(source: string | Buffer): boolean;
    /** @inheritdoc */
    load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument>;
}
//# sourceMappingURL=DocxLoader.d.ts.map