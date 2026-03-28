/**
 * @fileoverview IDocumentLoader — contract for all document loading strategies.
 *
 * Every loader targets one or more file extensions and exposes a uniform
 * `load()` primitive that normalises diverse document formats into a single
 * {@link LoadedDocument} shape ready for chunking and indexing.
 *
 * @module memory/ingestion/IDocumentLoader
 */

import type { LoadOptions, LoadedDocument } from '../../io/facade/types.js';

/**
 * Unified interface for all document loaders in the AgentOS ingestion
 * pipeline.
 *
 * Implementations handle a specific set of file extensions and are
 * responsible for:
 * 1. Reading raw bytes from a file path or in-memory `Buffer`.
 * 2. Extracting plain-text `content` and structured `metadata`.
 * 3. Returning a {@link LoadedDocument} ready for downstream chunking.
 *
 * @example
 * ```ts
 * const loader: IDocumentLoader = new MarkdownLoader();
 * if (loader.canLoad('README.md')) {
 *   const doc = await loader.load('README.md');
 *   console.log(doc.metadata.title);
 * }
 * ```
 */
export interface IDocumentLoader {
  /**
   * File extensions this loader handles, each with a leading dot.
   *
   * Used by {@link LoaderRegistry} to route file paths to the correct loader.
   *
   * @example ['.md', '.mdx']
   */
  readonly supportedExtensions: string[];

  /**
   * Parses `source` and returns a normalised {@link LoadedDocument}.
   *
   * When `source` is a `string` the loader treats it as an absolute (or
   * resolvable) file path and reads the file from disk.  When `source` is a
   * `Buffer` the loader parses the bytes directly and derives as much
   * metadata as possible from the buffer content alone.
   *
   * @param source  - Absolute file path OR raw document bytes.
   * @param options - Optional hints such as a format override.
   * @returns A promise resolving to the fully-populated {@link LoadedDocument}.
   * @throws When the file cannot be read or the format is not parsable.
   */
  load(source: string | Buffer, options?: LoadOptions): Promise<LoadedDocument>;

  /**
   * Returns `true` when this loader is capable of handling `source`.
   *
   * For string sources the check is purely extension-based.  For `Buffer`
   * sources the loader may inspect magic bytes when relevant.
   *
   * @param source - Absolute file path or raw bytes.
   */
  canLoad(source: string | Buffer): boolean;
}
