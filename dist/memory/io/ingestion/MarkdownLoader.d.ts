/**
 * @fileoverview MarkdownLoader — loads `.md` and `.mdx` documents.
 *
 * Parses YAML front-matter using the `gray-matter` library, strips it from
 * the returned content, and promotes key metadata fields (title, author,
 * createdAt, etc.) into the {@link DocumentMetadata} shape.
 *
 * When no `title` key is present in the front-matter the loader falls back
 * to extracting the first ATX heading (`# …`) from the document body.
 *
 * @module memory/ingestion/MarkdownLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
/**
 * Document loader for Markdown (`.md`) and MDX (`.mdx`) files.
 *
 * ### Front-matter handling
 * YAML front-matter delimited by `---` is parsed via `gray-matter`.  All
 * key-value pairs are merged into {@link DocumentMetadata} as-is, with a
 * handful of well-known keys (`title`, `author`, `createdAt`, `modifiedAt`,
 * `language`) mapped to the corresponding typed metadata fields.
 *
 * ### Title extraction fallback
 * When the front-matter does **not** contain a `title` field the loader
 * searches the document body for the first level-1 ATX heading (`# Title`)
 * and uses that as the title.
 *
 * ### Returned content
 * The `content` field in the returned {@link LoadedDocument} contains the
 * Markdown body **without** the front-matter block.
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new MarkdownLoader();
 * const doc = await loader.load('/docs/architecture.md');
 * console.log(doc.metadata.title); // from front-matter or first # heading
 * ```
 */
export declare class MarkdownLoader implements IDocumentLoader {
    /** @inheritdoc */
    readonly supportedExtensions: string[];
    /** @inheritdoc */
    canLoad(source: string | Buffer): boolean;
    /** @inheritdoc */
    load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument>;
}
//# sourceMappingURL=MarkdownLoader.d.ts.map