/**
 * @fileoverview Tests for FolderScanner, MultimodalAggregator, and UrlLoader.
 *
 * Each test that requires disk I/O creates a fresh temporary directory in
 * `beforeEach` and removes it in `afterEach` to prevent cross-test pollution.
 *
 * @module memory/ingestion/__tests__/scanner.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FolderScanner } from '../FolderScanner.js';
import { MultimodalAggregator } from '../MultimodalAggregator.js';
import { UrlLoader } from '../UrlLoader.js';
import { LoaderRegistry } from '../LoaderRegistry.js';
import type { ExtractedImage } from '../../facade/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a unique temporary directory path guaranteed to not exist yet. */
function uniqueTmpDir(): string {
  return path.join(
    os.tmpdir(),
    `agentos-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = uniqueTmpDir();
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// FolderScanner
// ---------------------------------------------------------------------------

describe('FolderScanner', () => {
  /**
   * Creates a basic directory tree used by multiple tests:
   *
   * ```
   * tmpDir/
   *   test.txt
   *   test.md
   *   subdir/
   *     nested.txt
   * ```
   */
  async function createBasicTree(): Promise<void> {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'Hello from txt', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'test.md'), '# Hello\n\nFrom md.', 'utf8');
    const subdir = path.join(tmpDir, 'subdir');
    await fs.mkdir(subdir, { recursive: true });
    await fs.writeFile(path.join(subdir, 'nested.txt'), 'Nested content', 'utf8');
  }

  // -------------------------------------------------------------------------

  it('recursively scans a directory and loads all supported files', async () => {
    await createBasicTree();

    const registry = new LoaderRegistry();
    const scanner = new FolderScanner(registry);

    const result = await scanner.scan(tmpDir, { recursive: true });

    // 3 files: test.txt, test.md, subdir/nested.txt
    expect(result.documents).toHaveLength(3);
    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);

    // Verify that document content is non-empty.
    for (const doc of result.documents) {
      expect(doc.content.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------

  it('applies an include glob filter — only .md files are returned', async () => {
    await createBasicTree();

    const registry = new LoaderRegistry();
    const scanner = new FolderScanner(registry);

    const result = await scanner.scan(tmpDir, {
      recursive: true,
      include: ['**/*.md'],
    });

    // Only test.md should match.
    expect(result.documents).toHaveLength(1);
    expect(result.succeeded).toHaveLength(1);
    expect(result.succeeded[0]).toMatch(/test\.md$/);
  });

  // -------------------------------------------------------------------------

  it('applies an exclude glob filter — nested file is excluded', async () => {
    await createBasicTree();

    const registry = new LoaderRegistry();
    const scanner = new FolderScanner(registry);

    const result = await scanner.scan(tmpDir, {
      recursive: true,
      exclude: ['**/subdir/**'],
    });

    // subdir/nested.txt should be excluded, leaving test.txt and test.md.
    expect(result.documents).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    const paths = result.succeeded;
    const hasNested = paths.some((p) => p.includes('subdir'));
    expect(hasNested).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('calls the onProgress callback for each file with the correct index and total', async () => {
    await createBasicTree();

    const registry = new LoaderRegistry();
    const scanner = new FolderScanner(registry);

    const calls: Array<{ file: string; index: number; total: number }> = [];

    await scanner.scan(tmpDir, {
      recursive: true,
      onProgress: (file, index, total) => {
        calls.push({ file, index, total });
      },
    });

    // 3 files → 3 callback invocations.
    expect(calls).toHaveLength(3);

    // All invocations should report the same total (3).
    for (const call of calls) {
      expect(call.total).toBe(3);
    }

    // Indices should be 1, 2, 3 (1-based, in order).
    const indices = calls.map((c) => c.index).sort((a, b) => a - b);
    expect(indices).toEqual([1, 2, 3]);

    // Each `file` value should be an absolute path string.
    for (const call of calls) {
      expect(path.isAbsolute(call.file)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------

  it('adds files with unsupported extensions to failed[] without throwing', async () => {
    // Write a .txt file (supported) and a .xyz file (not supported).
    await fs.writeFile(path.join(tmpDir, 'good.txt'), 'Valid content', 'utf8');
    // A .xyz file has no registered loader; the registry will throw, which
    // FolderScanner should catch and record.  However, FolderScanner filters
    // by registered extensions *before* attempting to load, so unsupported
    // extensions simply never enter the queue.
    //
    // To exercise the error path we install a fake loader that always throws.
    const registry = new LoaderRegistry();

    const alwaysThrowLoader = {
      supportedExtensions: ['.badext'],
      canLoad: (s: string | Buffer) => typeof s === 'string' && s.endsWith('.badext'),
      load: async () => { throw new Error('Intentional loader failure'); },
    };
    registry.register(alwaysThrowLoader);

    await fs.writeFile(path.join(tmpDir, 'broken.badext'), 'data', 'utf8');

    const scanner = new FolderScanner(registry);
    const result = await scanner.scan(tmpDir, { recursive: true });

    // good.txt should succeed.
    expect(result.succeeded.some((p) => p.endsWith('good.txt'))).toBe(true);

    // broken.badext should land in failed[], not throw.
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].path).toMatch(/broken\.badext$/);
    expect(result.failed[0].error).toContain('Intentional loader failure');
  });
});

// ---------------------------------------------------------------------------
// MultimodalAggregator
// ---------------------------------------------------------------------------

describe('MultimodalAggregator', () => {
  /** Factory helper for creating minimal ExtractedImage stubs. */
  function makeImage(overrides?: Partial<ExtractedImage>): ExtractedImage {
    return {
      data: Buffer.from('fake-image-bytes'),
      mimeType: 'image/png',
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------

  it('adds captions via the describeImage function when images lack one', async () => {
    const describeImage = vi.fn(async (_buf: Buffer, _mime: string) => 'A beautiful sunset');

    const aggregator = new MultimodalAggregator({ describeImage });

    const images: ExtractedImage[] = [
      makeImage(),                          // no caption
      makeImage({ caption: 'pre-existing' }), // already captioned
    ];

    const result = await aggregator.processImages(images);

    expect(result).toHaveLength(2);

    // First image gets a new caption.
    expect(result[0].caption).toBe('A beautiful sunset');

    // Second image retains its existing caption; describeImage should NOT
    // have been called for it.
    expect(result[1].caption).toBe('pre-existing');
    expect(describeImage).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------

  it('returns images unchanged when no describeImage function is configured', async () => {
    const aggregator = new MultimodalAggregator(); // no config

    const images: ExtractedImage[] = [
      makeImage(),
      makeImage({ caption: 'existing caption' }),
    ];

    const result = await aggregator.processImages(images);

    expect(result).toHaveLength(2);
    expect(result[0].caption).toBeUndefined();
    expect(result[1].caption).toBe('existing caption');
  });

  // -------------------------------------------------------------------------

  it('does not propagate errors from describeImage — failed images retain original state', async () => {
    const describeImage = vi.fn(async () => {
      throw new Error('Vision LLM unavailable');
    });

    const aggregator = new MultimodalAggregator({ describeImage });
    const images: ExtractedImage[] = [makeImage()];

    // Should not throw.
    const result = await aggregator.processImages(images);

    expect(result).toHaveLength(1);
    // Caption remains undefined because the LLM failed.
    expect(result[0].caption).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UrlLoader
// ---------------------------------------------------------------------------

describe('UrlLoader', () => {
  // -------------------------------------------------------------------------

  it('canLoad returns true for http:// and https:// URLs', () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    expect(loader.canLoad('http://example.com/page')).toBe(true);
    expect(loader.canLoad('https://example.com/report.pdf')).toBe(true);
    expect(loader.canLoad('https://subdomain.example.org/path/to/doc')).toBe(true);
  });

  // -------------------------------------------------------------------------

  it('canLoad returns false for file paths and non-HTTP schemes', () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    expect(loader.canLoad('/absolute/file/path.txt')).toBe(false);
    expect(loader.canLoad('relative/path.md')).toBe(false);
    expect(loader.canLoad('ftp://example.com/file')).toBe(false);
    expect(loader.canLoad('file:///local/path')).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('canLoad returns false for Buffer sources', () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    expect(loader.canLoad(Buffer.from('https://example.com'))).toBe(false);
  });

  // -------------------------------------------------------------------------

  it('has an empty supportedExtensions array', () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    expect(loader.supportedExtensions).toEqual([]);
  });

  // -------------------------------------------------------------------------

  it('load throws when source is a Buffer', async () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    await expect(
      loader.load(Buffer.from('https://example.com')),
    ).rejects.toThrow(/must be a URL string/i);
  });

  // -------------------------------------------------------------------------

  it('fetches HTML URL and delegates to HtmlLoader, setting source metadata', async () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    // Stub global fetch so no real network call is made.
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/html; charset=utf-8']]),
      text: async () => '<html><head><title>Mocked Page</title></head><body><p>Content</p></body></html>',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    // Temporarily replace global fetch.
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const doc = await loader.load('https://example.com/page');

      expect(doc.format).toBe('html');
      expect(doc.metadata.source).toBe('https://example.com/page');
      expect(doc.metadata.title).toBe('Mocked Page');
      expect(doc.content).toContain('Content');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------

  it('falls back to plain text for unrecognised content types', async () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    const plainText = 'Hello, plain text response!';

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => plainText,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const doc = await loader.load('https://example.com/notes.txt');

      expect(doc.format).toBe('text');
      expect(doc.content).toBe(plainText);
      expect(doc.metadata.source).toBe('https://example.com/notes.txt');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------

  it('throws on non-2xx HTTP responses', async () => {
    const registry = new LoaderRegistry();
    const loader = new UrlLoader(registry);

    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Map(),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      await expect(loader.load('https://example.com/missing')).rejects.toThrow(/HTTP 404/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
