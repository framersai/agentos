/**
 * @fileoverview Tests for the HNSW sidecar index companion.
 * @module memory/store/__tests__/HnswSidecar.test
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HnswSidecar } from '../HnswSidecar.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Whether hnswlib-node is available in this environment. */
let hnswAvailable = true;

try {
  await import('hnswlib-node');
} catch {
  hnswAvailable = false;
}

describe('HnswSidecar', () => {
  let tmpDir: string;
  let sidecar: HnswSidecar;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hnsw-test-'));
    sidecar = new HnswSidecar({
      sqlitePath: join(tmpDir, 'brain.sqlite'),
      dimensions: 4,
      autoThreshold: 3, // Low threshold for testing
    });
  });

  afterEach(() => {
    sidecar.destroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!hnswAvailable)('is not active before threshold or init', async () => {
    // Sidecar should not be active before init
    expect(sidecar.isActive).toBe(false);
    await sidecar.init();
    // Still not active — no existing index on disk
    expect(sidecar.isActive).toBe(false);
  });

  it.skipIf(!hnswAvailable)('activates after rebuildFromData', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
      { id: 'b', embedding: [0, 1, 0, 0] },
      { id: 'c', embedding: [0, 0, 1, 0] },
    ]);
    expect(sidecar.isActive).toBe(true);
    expect(sidecar.size).toBe(3);
  });

  it.skipIf(!hnswAvailable)('queries nearest neighbors correctly', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
      { id: 'b', embedding: [0.9, 0.1, 0, 0] },
      { id: 'c', embedding: [0, 0, 1, 0] },
    ]);

    const results = sidecar.query([1, 0, 0, 0], 2);
    expect(results.length).toBe(2);
    // 'a' is closest to [1,0,0,0], 'b' is second closest
    expect(results[0].id).toBe('a');
    expect(results[1].id).toBe('b');
  });

  it.skipIf(!hnswAvailable)('returns empty for inactive sidecar', () => {
    const results = sidecar.query([1, 0, 0, 0], 5);
    expect(results).toEqual([]);
  });

  it.skipIf(!hnswAvailable)('persists to disk and reloads', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'x', embedding: [0.5, 0.5, 0, 0] },
      { id: 'y', embedding: [0, 0, 0.5, 0.5] },
    ]);

    // Verify files exist on disk
    expect(existsSync(join(tmpDir, 'brain.hnsw'))).toBe(true);
    expect(existsSync(join(tmpDir, 'brain.hnsw.map.json'))).toBe(true);

    // Create a new sidecar pointing at the same directory
    const sidecar2 = new HnswSidecar({
      sqlitePath: join(tmpDir, 'brain.sqlite'),
      dimensions: 4,
    });
    await sidecar2.init();
    expect(sidecar2.isActive).toBe(true);
    expect(sidecar2.size).toBe(2);

    // Query should still work
    const results = sidecar2.query([0.5, 0.5, 0, 0], 1);
    expect(results[0].id).toBe('x');
    sidecar2.destroy();
  });

  it.skipIf(!hnswAvailable)('handles remove by marking deleted', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
      { id: 'b', embedding: [0, 1, 0, 0] },
    ]);

    sidecar.remove('a');
    expect(sidecar.size).toBe(1);

    // Query should not return 'a'
    const results = sidecar.query([1, 0, 0, 0], 2);
    expect(results.every(r => r.id !== 'a')).toBe(true);
  });

  it.skipIf(!hnswAvailable)('adds vectors incrementally after activation', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
    ]);

    // Add more vectors incrementally
    await sidecar.add('b', [0, 1, 0, 0], 2);
    await sidecar.add('c', [0, 0, 1, 0], 3);

    expect(sidecar.size).toBe(3);
    const results = sidecar.query([0, 1, 0, 0], 1);
    expect(results[0].id).toBe('b');
  });

  it.skipIf(!hnswAvailable)('skips duplicate adds', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
    ]);

    await sidecar.add('a', [1, 0, 0, 0], 2); // Duplicate — should be ignored
    expect(sidecar.size).toBe(1);
  });

  it.skipIf(!hnswAvailable)('destroy removes files from disk', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
    ]);

    expect(existsSync(join(tmpDir, 'brain.hnsw'))).toBe(true);
    sidecar.destroy();
    expect(existsSync(join(tmpDir, 'brain.hnsw'))).toBe(false);
    expect(sidecar.isActive).toBe(false);
  });

  it.skipIf(!hnswAvailable)('skips dimension-mismatched vectors in rebuild', async () => {
    await sidecar.init();
    await sidecar.rebuildFromData([
      { id: 'a', embedding: [1, 0, 0, 0] },
      { id: 'bad', embedding: [1, 0] }, // Wrong dimensions — should be skipped
      { id: 'c', embedding: [0, 0, 1, 0] },
    ]);
    expect(sidecar.size).toBe(2);
  });
});
