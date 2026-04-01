/**
 * @fileoverview FolderScanner — recursive directory walker for the ingestion
 * pipeline.
 *
 * FolderScanner is NOT an {@link IDocumentLoader}; instead it orchestrates a
 * `LoaderRegistry` to batch-process every file in a directory tree. It
 * supports glob-based include/exclude filters via `minimatch`, per-file
 * progress callbacks, and graceful error collection so a single unreadable file
 * never aborts a whole scan.
 *
 * @module memory/ingestion/FolderScanner
 */
import type { LoadedDocument } from '../../io/facade/types.js';
import type { LoaderRegistry } from './LoaderRegistry.js';
/**
 * Configuration options for `FolderScanner.scan()`.
 */
export interface FolderScanOptions {
    /**
     * Whether to descend into sub-directories.
     *
     * When `false` only the direct children of `dirPath` are considered.
     *
     * @default true
     */
    recursive?: boolean;
    /**
     * Glob patterns that a file path must match at least one of in order to be
     * processed.  Patterns are evaluated against the path *relative* to the
     * scanned root directory using {@link minimatch}.
     *
     * When omitted every file with a registered extension is processed.
     *
     * @example ['**\/*.pdf', '**\/*.md']
     */
    include?: string[];
    /**
     * Glob patterns that cause a file to be skipped when its relative path
     * matches any of them.  Evaluated *after* `include`.
     *
     * @example ['**\/node_modules\/**', '**\/.git\/**']
     */
    exclude?: string[];
    /**
     * Called after each file attempt (success *or* failure).
     *
     * @param file  - Absolute path of the file that was just processed.
     * @param index - 1-based index of the file in the total discovered list.
     * @param total - Total number of matching files discovered before processing began.
     */
    onProgress?: (file: string, index: number, total: number) => void;
}
/**
 * The aggregated result of a `FolderScanner.scan()` call.
 */
export interface FolderScanResult {
    /**
     * Successfully loaded documents, one per processed file.
     */
    documents: LoadedDocument[];
    /**
     * Absolute paths of files that were loaded without error.
     */
    succeeded: string[];
    /**
     * Files that could not be processed, with per-file error messages.
     */
    failed: Array<{
        path: string;
        error: string;
    }>;
}
/**
 * Recursively scans a directory and loads every file whose extension has a
 * registered loader in the supplied `LoaderRegistry`.
 *
 * ### Example
 * ```ts
 * const registry = new LoaderRegistry();
 * const scanner  = new FolderScanner(registry);
 *
 * const result = await scanner.scan('/knowledge-base', {
 *   recursive:  true,
 *   include:    ['**\/*.md', '**\/*.pdf'],
 *   exclude:    ['**\/node_modules\/**'],
 *   onProgress: (file, i, total) => console.log(`${i}/${total} ${file}`),
 * });
 *
 * console.log(`Loaded ${result.documents.length} documents`);
 * console.log(`Failed: ${result.failed.length}`);
 * ```
 */
export declare class FolderScanner {
    private readonly registry;
    /**
     * @param registry - The `LoaderRegistry` used to dispatch each file to
     *                   the appropriate loader.
     */
    constructor(registry: LoaderRegistry);
    /**
     * Walk `dirPath` and load every matching file.
     *
     * Files are discovered first and then loaded sequentially.  Errors thrown
     * by individual loaders are caught and accumulated in
     * the returned `failed` list rather than propagating.
     *
     * @param dirPath - Absolute path to the directory to scan.
     * @param options - Optional include/exclude filters and progress callback.
     * @returns A promise that resolves to a `FolderScanResult`.
     *
     * @throws {Error} When `dirPath` cannot be read as a directory (e.g.
     *                 it does not exist or is a regular file).
     */
    scan(dirPath: string, options?: FolderScanOptions): Promise<FolderScanResult>;
}
//# sourceMappingURL=FolderScanner.d.ts.map