/**
 * @fileoverview TextLoader — loads plain-text, CSV/TSV, JSON, and YAML files.
 *
 * This is the most general-purpose loader in the AgentOS ingestion pipeline.
 * It handles six extensions that all share the same fundamental operation:
 * read raw text and attach lightweight metadata derived from the file content
 * and extension.
 *
 * Supported extensions: `.txt`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`
 *
 * @module memory/ingestion/TextLoader
 */
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';
/**
 * Loader for plain-text, CSV, TSV, JSON, and YAML files.
 *
 * The loader performs minimal transformation:
 * - **`.json`** — re-serialises with pretty-printing so stored content is
 *   consistently formatted.
 * - **`.yaml` / `.yml`** — the `yaml` package is used to parse and re-dump
 *   for consistent formatting; falls back to raw text on parse error.
 * - All other extensions — content is returned as-is.
 *
 * Metadata includes the approximate `wordCount` and a `format` label derived
 * from the file extension.
 *
 * @implements {IDocumentLoader}
 *
 * @example
 * ```ts
 * const loader = new TextLoader();
 * const doc = await loader.load('/data/notes.txt');
 * console.log(doc.metadata.wordCount); // e.g. 312
 * ```
 */
export declare class TextLoader implements IDocumentLoader {
    /** @inheritdoc */
    readonly supportedExtensions: string[];
    /** @inheritdoc */
    canLoad(source: string | Buffer): boolean;
    /** @inheritdoc */
    load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument>;
    /**
     * Normalises raw file content based on the detected extension.
     *
     * - JSON files are pretty-printed.
     * - YAML files are parsed and re-dumped for consistent formatting.
     * - All other formats are returned unchanged.
     *
     * @param raw - Raw UTF-8 string read from the source.
     * @param ext - Lower-cased extension with leading dot.
     */
    private _normalise;
    /**
     * Parse and re-serialise YAML content for consistent formatting.
     *
     * Uses the `yaml` package that is already a production dependency of the
     * `@framers/agentos` package.  Falls back to the original raw string on
     * any parse error so the loader never throws on malformed YAML.
     *
     * @param raw - Raw YAML string.
     */
    private _prettyYaml;
}
//# sourceMappingURL=TextLoader.d.ts.map