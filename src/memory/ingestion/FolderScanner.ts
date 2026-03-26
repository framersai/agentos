/**
 * @fileoverview FolderScanner — recursive directory walker for the ingestion
 * pipeline.
 *
 * FolderScanner is NOT an {@link IDocumentLoader}; instead it orchestrates a
 * {@link LoaderRegistry} to batch-process every file in a directory tree.  It
 * supports glob-based include/exclude filters via `minimatch`, per-file
 * progress callbacks, and graceful error collection so a single unreadable file
 * never aborts a whole scan.
 *
 * @module memory/ingestion/FolderScanner
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { LoadedDocument } from '../facade/types.js';
import type { LoaderRegistry } from './LoaderRegistry.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Configuration options for {@link FolderScanner.scan}.
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
 * The aggregated result of a {@link FolderScanner.scan} call.
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
  failed: Array<{ path: string; error: string }>;
}

// ---------------------------------------------------------------------------
// FolderScanner
// ---------------------------------------------------------------------------

/**
 * Recursively scans a directory and loads every file whose extension has a
 * registered loader in the supplied {@link LoaderRegistry}.
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
export class FolderScanner {
  /**
   * @param registry - The {@link LoaderRegistry} used to dispatch each file to
   *                   the appropriate loader.
   */
  constructor(private readonly registry: LoaderRegistry) {}

  // -------------------------------------------------------------------------
  // scan
  // -------------------------------------------------------------------------

  /**
   * Walk `dirPath` and load every matching file.
   *
   * Files are discovered first and then loaded sequentially.  Errors thrown
   * by individual loaders are caught and accumulated in
   * {@link FolderScanResult.failed} rather than propagating.
   *
   * @param dirPath - Absolute path to the directory to scan.
   * @param options - Optional include/exclude filters and progress callback.
   * @returns A promise that resolves to a {@link FolderScanResult}.
   *
   * @throws {Error} When `dirPath` cannot be read as a directory (e.g.
   *                 it does not exist or is a regular file).
   */
  async scan(dirPath: string, options: FolderScanOptions = {}): Promise<FolderScanResult> {
    const {
      recursive = true,
      include,
      exclude,
      onProgress,
    } = options;

    // ------------------------------------------------------------------
    // 1. Discover all candidate file paths.
    // ------------------------------------------------------------------

    const allEntries = await fs.readdir(dirPath, { recursive, withFileTypes: true });

    // Filter to only regular files whose extension is registered.
    const supportedExtensions = new Set(this.registry.getSupportedExtensions());

    const candidatePaths: string[] = [];

    for (const entry of allEntries) {
      // Skip directories (readdir with recursive:true includes dirs too).
      if (!entry.isFile()) continue;

      // Build the absolute path.  In Node 20+ with recursive:true the
      // `parentPath` property is set; older versions use `path` (deprecated).
      // We fall back gracefully.
      const parentPath =
        (entry as { parentPath?: string; path?: string }).parentPath ??
        (entry as { parentPath?: string; path?: string }).path ??
        dirPath;
      const absolutePath = path.join(parentPath, entry.name);

      // Check that the extension has a registered loader.
      const ext = path.extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(ext)) continue;

      // Build relative path for glob matching.
      const relativePath = path.relative(dirPath, absolutePath);

      // Apply include filter — file must match at least one pattern.
      if (include && include.length > 0) {
        const matches = include.some((pattern) =>
          minimatch(relativePath, pattern, { dot: true }),
        );
        if (!matches) continue;
      }

      // Apply exclude filter — file must NOT match any pattern.
      if (exclude && exclude.length > 0) {
        const excluded = exclude.some((pattern) =>
          minimatch(relativePath, pattern, { dot: true }),
        );
        if (excluded) continue;
      }

      candidatePaths.push(absolutePath);
    }

    // ------------------------------------------------------------------
    // 2. Load each candidate file, collecting results and errors.
    // ------------------------------------------------------------------

    const documents: LoadedDocument[] = [];
    const succeeded: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (let i = 0; i < candidatePaths.length; i++) {
      const filePath = candidatePaths[i];

      try {
        const doc = await this.registry.loadFile(filePath);
        documents.push(doc);
        succeeded.push(filePath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ path: filePath, error: message });
      }

      // Fire progress callback (1-based index).
      onProgress?.(filePath, i + 1, candidatePaths.length);
    }

    return { documents, succeeded, failed };
  }
}
