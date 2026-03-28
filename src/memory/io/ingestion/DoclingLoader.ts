/**
 * @fileoverview DoclingLoader — high-fidelity PDF/DOCX extraction via Python Docling.
 *
 * Docling (https://github.com/DS4SD/docling) is an IBM Research open-source
 * library that converts PDFs and office documents to structured JSON, preserving
 * tables, figures, and layout information far beyond what pure-JS text extraction
 * can achieve.
 *
 * This module provides a factory function {@link createDoclingLoader} that:
 * 1. Checks whether `python3 -m docling --version` succeeds in the current PATH.
 * 2. If it does, returns a Docling-backed loader instance that spawns a
 *    `python3 -m docling` subprocess for each document.
 * 3. If Docling is not installed, returns `null` gracefully.
 *
 * ### Opting in
 * ```sh
 * pip install docling
 * ```
 *
 * @module memory/ingestion/DoclingLoader
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type { IDocumentLoader } from './IDocumentLoader.js';
import type { LoadOptions, LoadedDocument, DocumentMetadata } from '../../io/facade/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions this loader can handle (Docling supports PDF and DOCX). */
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the lower-cased extension (with dot) of a file path.
 *
 * @param filePath - Absolute or relative file path.
 */
function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

// ---------------------------------------------------------------------------
// Docling JSON output shape (minimal — we only map what we need)
// ---------------------------------------------------------------------------

/**
 * Minimal representation of the JSON Docling emits when invoked with
 * `--output-format json`.  Only the fields we consume are typed here; all
 * others are captured in the spread catchall.
 *
 * @internal
 */
interface DoclingJsonOutput {
  /** Full extracted text (Docling v2+). */
  text?: string;

  /** Document metadata block. */
  metadata?: {
    title?: string;
    author?: string;
    pageCount?: number;
    page_count?: number;
  };

  /** Older Docling format: array of per-page text blocks. */
  pages?: Array<{ text?: string }>;

  /** Catch-all for forward compatibility. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// DoclingLoader (internal class)
// ---------------------------------------------------------------------------

/**
 * High-fidelity document loader that delegates to a `python3 -m docling`
 * subprocess.
 *
 * Consumers should use `createDoclingLoader()` rather than constructing
 * this class directly so that the Python availability check is always run
 * before first use.
 *
 * @implements {IDocumentLoader}
 */
class DoclingLoader implements IDocumentLoader {
  /** @inheritdoc */
  readonly supportedExtensions: string[] = [...SUPPORTED_EXTENSIONS];

  // -------------------------------------------------------------------------
  // canLoad
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  canLoad(source: string | Buffer): boolean {
    if (Buffer.isBuffer(source)) {
      // Without an extension we can't determine compatibility from bytes alone.
      return false;
    }
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(source) as '.pdf' | '.docx');
  }

  // -------------------------------------------------------------------------
  // load
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async load(source: string | Buffer, _options?: LoadOptions): Promise<LoadedDocument> {
    let filePath: string;
    let tempFile: string | null = null;

    if (Buffer.isBuffer(source)) {
      // Write buffer to a temp file so Docling has a real path to read.
      tempFile = path.join(os.tmpdir(), `docling-input-${Date.now()}.pdf`);
      await fs.writeFile(tempFile, source);
      filePath = tempFile;
    } else {
      filePath = source;
    }

    try {
      const jsonOutput = await this._runDocling(filePath);
      return this._mapToLoadedDocument(jsonOutput, Buffer.isBuffer(source) ? undefined : source);
    } finally {
      // Clean up any temp file we created.
      if (tempFile !== null) {
        await fs.unlink(tempFile).catch(() => {
          /* ignore cleanup errors */
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: subprocess invocation
  // -------------------------------------------------------------------------

  /**
   * Spawn `python3 -m docling --output-format json <filePath>` and collect
   * stdout.
   *
   * @param filePath - Absolute path to the PDF or DOCX file.
   * @returns Parsed Docling JSON output.
   * @throws When the subprocess exits with a non-zero code or stdout is not
   *         valid JSON.
   */
  private async _runDocling(filePath: string): Promise<DoclingJsonOutput> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('python3', ['-m', 'docling', '--output-format', 'json', filePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `DoclingLoader: python3 -m docling exited with code ${code}.\n${stderr.slice(0, 500)}`
            )
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as DoclingJsonOutput;
          resolve(parsed);
        } catch (err) {
          reject(
            new Error(
              `DoclingLoader: failed to parse Docling JSON output: ${String(err)}\n` +
                `stdout (first 500 chars): ${stdout.slice(0, 500)}`
            )
          );
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`DoclingLoader: failed to spawn python3: ${err.message}`));
      });
    });
  }

  // -------------------------------------------------------------------------
  // Private: JSON → LoadedDocument mapping
  // -------------------------------------------------------------------------

  /**
   * Convert a Docling JSON output object to a {@link LoadedDocument}.
   *
   * Handles both the newer (`text` top-level string) and older
   * (`pages[].text` array) Docling output shapes.
   *
   * @param json         - Parsed Docling JSON.
   * @param resolvedPath - Original source path for the `source` metadata field.
   */
  private _mapToLoadedDocument(json: DoclingJsonOutput, resolvedPath?: string): LoadedDocument {
    // Prefer top-level `text` (Docling v2+), fall back to concatenating pages.
    let content: string;
    if (typeof json['text'] === 'string') {
      content = json['text'];
    } else if (Array.isArray(json['pages'])) {
      content = json['pages']
        .map((p) => (typeof p['text'] === 'string' ? p['text'] : ''))
        .join('\n\n');
    } else {
      content = '';
    }

    const rawMeta = json['metadata'] ?? {};
    const pageCount: number | undefined =
      typeof rawMeta['pageCount'] === 'number'
        ? rawMeta['pageCount']
        : typeof rawMeta['page_count'] === 'number'
          ? rawMeta['page_count']
          : undefined;

    const meta: DocumentMetadata = {
      ...(typeof rawMeta['title'] === 'string' && rawMeta['title']
        ? { title: rawMeta['title'] }
        : {}),
      ...(typeof rawMeta['author'] === 'string' ? { author: rawMeta['author'] } : {}),
      ...(pageCount !== undefined ? { pageCount } : {}),
      ...(resolvedPath ? { source: resolvedPath } : {}),
    };

    return {
      content,
      metadata: meta,
      format: 'pdf',
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Checks whether `python3 -m docling` is available in the current environment
 * and, if so, returns a new Docling-backed loader instance; otherwise returns
 * `null`.
 *
 * The availability check runs `python3 -m docling --version` synchronously
 * via `spawnSync` — it exits quickly and is only called once during registry
 * initialisation.
 *
 * ### Usage
 * ```ts
 * import { createDoclingLoader } from './DoclingLoader.js';
 * import { PdfLoader } from './PdfLoader.js';
 *
 * const doclingLoader = createDoclingLoader();
 * const loader = new PdfLoader(null, doclingLoader);
 * ```
 *
 * @returns A Docling-backed loader instance when Docling is installed, or `null`.
 */
export function createDoclingLoader(): IDocumentLoader | null {
  try {
    const result = spawnSync('python3', ['-m', 'docling', '--version'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    // spawnSync throws when the binary cannot be found, and sets .error for
    // other failure modes.  A non-zero status also means docling is absent.
    if (result.error !== undefined || result.status !== 0) {
      return null;
    }
    return new DoclingLoader();
  } catch {
    // python3 is not in PATH or docling is not installed.
    return null;
  }
}
