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

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument, DocumentMetadata } from '../facade/types.js';
import { validatePath } from './pathUtils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions handled by this loader, all lower-cased with a leading dot. */
const SUPPORTED_EXTENSIONS = ['.txt', '.csv', '.tsv', '.json', '.yaml', '.yml'] as const;

/** Union of supported extension strings (for type narrowing). */
type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the lower-cased extension (with dot) of a file path, or an empty
 * string when the path has no extension.
 *
 * @param filePath - Absolute or relative file path string.
 */
function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Count the approximate number of words in a string.
 *
 * Splits on runs of whitespace — fast and allocation-light for the typical
 * document sizes encountered during ingestion.
 *
 * @param text - Raw text to count.
 */
function wordCount(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/**
 * Maps a file extension to a human-readable format label returned inside
 * `LoadedDocument.format`.
 *
 * @param ext - Lower-cased extension including leading dot.
 */
function formatLabel(ext: SupportedExt | string): string {
  switch (ext as SupportedExt) {
    case '.txt':
      return 'txt';
    case '.csv':
      return 'csv';
    case '.tsv':
      return 'tsv';
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    default:
      return 'txt';
  }
}

/**
 * For JSON files: parse, then re-serialise with two-space indentation.
 *
 * This makes the stored `content` more human-readable and consistent
 * regardless of how the source file was originally formatted.
 *
 * Returns `raw` unchanged when parsing fails (e.g. when a `.json` file
 * contains invalid JSON) so the loader never throws on bad input.
 *
 * @param raw - Raw UTF-8 content of the JSON file.
 */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Invalid JSON — return raw text so the caller still gets something.
    return raw;
  }
}

// ---------------------------------------------------------------------------
// TextLoader
// ---------------------------------------------------------------------------

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
export class TextLoader implements IDocumentLoader {
  /** @inheritdoc */
  readonly supportedExtensions: string[] = [...SUPPORTED_EXTENSIONS];

  // -------------------------------------------------------------------------
  // canLoad
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  canLoad(source: string | Buffer): boolean {
    // Buffer sources: we have no extension to check, so we conservatively
    // return false unless the caller passes a string path.
    if (Buffer.isBuffer(source)) {
      return false;
    }
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(source));
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument> {
    let raw: string;
    let resolvedPath: string | undefined;
    let ext: string;

    if (Buffer.isBuffer(source)) {
      // In-memory buffer: treat as plain text, no extension info available.
      raw = source.toString('utf8');
      ext = '.txt';
    } else {
      // File path: validate against traversal and read from disk.
      resolvedPath = validatePath(source);
      ext = extOf(source);
      const bytes = await fs.readFile(resolvedPath);
      raw = bytes.toString('utf8');
    }

    // ---- Content normalisation ----
    const content = this._normalise(raw, ext as SupportedExt);

    // ---- Metadata assembly ----
    const meta: DocumentMetadata = {
      wordCount: wordCount(raw),
      format: formatLabel(ext),
      ...(resolvedPath ? { source: resolvedPath } : {}),
    };

    return {
      content,
      metadata: meta,
      format: formatLabel(ext),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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
  private _normalise(raw: string, ext: SupportedExt | string): string {
    switch (ext as SupportedExt) {
      case '.json':
        return prettyJson(raw);

      case '.yaml':
      case '.yml':
        return this._prettyYaml(raw);

      default:
        // .txt, .csv, .tsv — return raw content unchanged.
        return raw;
    }
  }

  /**
   * Parse and re-serialise YAML content for consistent formatting.
   *
   * Uses the `yaml` package that is already a production dependency of the
   * `@framers/agentos` package.  Falls back to the original raw string on
   * any parse error so the loader never throws on malformed YAML.
   *
   * @param raw - Raw YAML string.
   */
  private _prettyYaml(raw: string): string {
    try {
      const parsed: unknown = parseYaml(raw);
      return stringifyYaml(parsed);
    } catch {
      return raw;
    }
  }
}
