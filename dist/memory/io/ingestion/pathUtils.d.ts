/**
 * @fileoverview Path validation utilities for the ingestion pipeline.
 *
 * Provides a {@link validatePath} helper that resolves a file path to its
 * canonical absolute form and checks for directory traversal sequences
 * (`..`) that could escape a trusted base directory.
 *
 * @module memory/ingestion/pathUtils
 */
/**
 * Validates that a file path does not contain path traversal sequences and
 * optionally enforces containment within a base directory.
 *
 * The path is first resolved to an absolute canonical form using
 * {@link path.resolve}.
 *
 * - When `baseDir` is supplied the resolved path must start with the
 *   resolved base directory; otherwise an error is thrown.
 * - When `baseDir` is omitted the function checks whether the original
 *   `filePath` contains `..` segments.  If it does, an error is thrown
 *   because the intent is ambiguous and may indicate a traversal attack.
 *
 * @param filePath - The raw file path to validate (may be relative).
 * @param baseDir  - Optional trusted root directory that the resolved path
 *                   must reside within.
 * @returns The resolved absolute path (safe to use for file I/O).
 * @throws {Error} When the path contains traversal sequences or escapes
 *                 `baseDir`.
 *
 * @example
 * ```ts
 * const safe = validatePath('/data/docs/../secrets/key.pem', '/data/docs');
 * // throws: "Path traversal detected …"
 *
 * const ok = validatePath('/data/docs/readme.md', '/data/docs');
 * // returns '/data/docs/readme.md'
 * ```
 */
export declare function validatePath(filePath: string, baseDir?: string): string;
//# sourceMappingURL=pathUtils.d.ts.map