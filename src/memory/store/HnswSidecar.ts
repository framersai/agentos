/**
 * @fileoverview HNSW sidecar index for SqliteBrain.
 * @module memory/store/HnswSidecar
 *
 * Maintains an HNSW index file alongside brain.sqlite for O(log n)
 * approximate nearest neighbor search. SQLite remains the source of
 * truth; the HNSW index is rebuildable from SQLite data at any time.
 *
 * Auto-activates when trace count exceeds threshold (default: 1000).
 * Below that, brute-force cosine in the Memory facade is fast enough.
 *
 * Architecture:
 * ```
 * ~/.wunderland/agents/{name}/
 *   ├── brain.sqlite   ← source of truth
 *   └── brain.hnsw     ← HNSW index (rebuildable)
 *        brain.hnsw.map.json ← label↔id mapping
 * ```
 */

import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HnswSidecarConfig {
  /** Path to brain.sqlite — HNSW file will be at same dir with .hnsw extension. */
  sqlitePath: string;
  /** Embedding dimensions. */
  dimensions: number;
  /** Auto-build threshold. Below this count, brute-force is used. @default 1000 */
  autoThreshold?: number;
  /** HNSW M parameter (connections per node). @default 16 */
  m?: number;
  /** HNSW efConstruction (build quality). @default 200 */
  efConstruction?: number;
  /** HNSW efSearch (query quality). @default 50 */
  efSearch?: number;
}

/** Result from a KNN query. */
export interface HnswQueryResult {
  /** Trace ID. */
  id: string;
  /** Distance from query vector (lower = closer for cosine distance). */
  distance: number;
}

// ---------------------------------------------------------------------------
// HnswSidecar
// ---------------------------------------------------------------------------

export class HnswSidecar {
  private index: any = null; // HierarchicalNSW instance (dynamic import)
  private HierarchicalNSW: any = null; // Constructor reference
  private readonly indexPath: string;
  private readonly mapPath: string;
  private readonly config: Required<HnswSidecarConfig>;

  /** Maps HNSW internal integer labels → trace ID strings. */
  private labelToId: Map<number, string> = new Map();
  /** Maps trace ID strings → HNSW internal integer labels. */
  private idToLabel: Map<string, number> = new Map();
  private nextLabel = 0;
  private _isActive = false;
  private _hnswAvailable: boolean | null = null;

  constructor(config: HnswSidecarConfig) {
    this.config = {
      autoThreshold: 1000,
      m: 16,
      efConstruction: 200,
      efSearch: 50,
      ...config,
    };
    this.indexPath = join(dirname(this.config.sqlitePath), 'brain.hnsw');
    this.mapPath = this.indexPath + '.map.json';
  }

  /** Whether the HNSW index is currently active and queryable. */
  get isActive(): boolean {
    return this._isActive;
  }

  /** Number of vectors currently indexed. */
  get size(): number {
    return this.labelToId.size;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the sidecar. Loads existing index from disk if present.
   * If hnswlib-node is not installed, silently stays inactive.
   */
  async init(): Promise<void> {
    if (!(await this._ensureHnswlib())) return;

    if (existsSync(this.indexPath) && existsSync(this.mapPath)) {
      try {
        await this._loadFromDisk();
      } catch {
        // Corrupt index — will rebuild when threshold is reached
        this._isActive = false;
        this.index = null;
      }
    }
  }

  /**
   * Add a vector to the index. If below threshold, does nothing.
   * If threshold is crossed, caller should call rebuildFromData().
   *
   * @param traceId    - The trace ID to associate with this vector.
   * @param embedding  - The embedding vector.
   * @param totalCount - Current total trace count (to check threshold).
   */
  async add(traceId: string, embedding: number[], totalCount: number): Promise<void> {
    if (!this._isActive) {
      // If we just crossed the threshold, caller needs to rebuildFromData()
      if (totalCount >= this.config.autoThreshold) return;
      return;
    }
    if (!this.index) return;
    if (this.idToLabel.has(traceId)) return; // Already indexed

    // Resize if needed
    const currentMax = this.index.getMaxElements();
    if (this.nextLabel >= currentMax) {
      this.index.resizeIndex(currentMax + 1000);
    }

    const label = this.nextLabel++;
    this.index.addPoint(embedding, label);
    this.labelToId.set(label, traceId);
    this.idToLabel.set(traceId, label);
  }

  /**
   * Query the HNSW index for top-K nearest neighbors.
   * Returns trace IDs sorted by distance (closest first).
   *
   * @param embedding - Query vector.
   * @param topK      - Number of results to return.
   * @returns Array of { id, distance } sorted by distance ascending.
   */
  query(embedding: number[], topK: number): HnswQueryResult[] {
    if (!this._isActive || !this.index) return [];

    const currentCount = this.index.getCurrentCount();
    if (currentCount === 0) return [];

    const k = Math.min(topK, currentCount);
    const result = this.index.searchKnn(embedding, k);
    const hits: HnswQueryResult[] = [];

    for (let i = 0; i < result.neighbors.length; i++) {
      const label = result.neighbors[i];
      const id = this.labelToId.get(label);
      if (id) {
        hits.push({ id, distance: result.distances[i] });
      }
    }

    return hits;
  }

  /**
   * Remove a trace from the index by marking its label as deleted.
   * HNSW doesn't support true deletion — cleaned up on rebuild.
   *
   * @param traceId - The trace ID to remove.
   */
  remove(traceId: string): void {
    const label = this.idToLabel.get(traceId);
    if (label !== undefined && this.index) {
      try {
        this.index.markDelete(label);
      } catch {
        // markDelete may not be available in all hnswlib-node versions
      }
      this.labelToId.delete(label);
      this.idToLabel.delete(traceId);
    }
  }

  /**
   * Rebuild the entire index from a set of id/embedding pairs.
   * Called on first threshold crossing or when brain.hnsw is missing/corrupt.
   *
   * @param data - Array of { id, embedding } to index.
   */
  async rebuildFromData(data: { id: string; embedding: number[] }[]): Promise<void> {
    if (data.length === 0) return;
    if (!(await this._ensureHnswlib())) return;

    const dim = this.config.dimensions;
    this.index = new this.HierarchicalNSW('cosine', dim);
    this.index.initIndex(
      Math.max(data.length + 1000, data.length * 1.2 | 0),
      this.config.m,
      this.config.efConstruction,
    );
    this.index.setEf(this.config.efSearch);

    this.labelToId.clear();
    this.idToLabel.clear();
    this.nextLabel = 0;

    for (const { id, embedding } of data) {
      if (embedding.length !== dim) continue; // Skip dimension mismatches
      const label = this.nextLabel++;
      this.index.addPoint(embedding, label);
      this.labelToId.set(label, id);
      this.idToLabel.set(id, label);
    }

    this._isActive = true;
    this._saveToDisk();
  }

  /**
   * Persist index and label map to disk.
   * Called after rebuildFromData() and periodically after adds.
   */
  saveToDisk(): void {
    this._saveToDisk();
  }

  /**
   * Delete index files from disk and deactivate.
   */
  destroy(): void {
    this._isActive = false;
    this.index = null;
    this.labelToId.clear();
    this.idToLabel.clear();
    this.nextLabel = 0;
    try {
      if (existsSync(this.indexPath)) unlinkSync(this.indexPath);
      if (existsSync(this.mapPath)) unlinkSync(this.mapPath);
    } catch {
      // Best effort cleanup
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Try to load hnswlib-node. Returns false if not installed. */
  private async _ensureHnswlib(): Promise<boolean> {
    if (this._hnswAvailable === true) return true;
    if (this._hnswAvailable === false) return false;

    try {
      const mod = await import('hnswlib-node');
      this.HierarchicalNSW = mod.HierarchicalNSW;
      this._hnswAvailable = true;
      return true;
    } catch {
      this._hnswAvailable = false;
      return false;
    }
  }

  /** Load index + label map from disk. */
  private async _loadFromDisk(): Promise<void> {
    if (!(await this._ensureHnswlib())) return;

    const dim = this.config.dimensions;
    this.index = new this.HierarchicalNSW('cosine', dim);
    this.index.readIndexSync(this.indexPath);
    this.index.setEf(this.config.efSearch);

    // Load label map
    const raw = readFileSync(this.mapPath, 'utf-8');
    const data = JSON.parse(raw) as {
      labelToId: [number, string][];
      nextLabel: number;
    };

    this.labelToId = new Map(data.labelToId);
    this.idToLabel = new Map(
      data.labelToId.map(([label, id]) => [id, label]),
    );
    this.nextLabel = data.nextLabel ?? this.labelToId.size;
    this._isActive = true;
  }

  /** Persist index + label map to disk. */
  private _saveToDisk(): void {
    if (!this.index) return;
    try {
      this.index.writeIndexSync(this.indexPath);
      writeFileSync(
        this.mapPath,
        JSON.stringify({
          labelToId: Array.from(this.labelToId.entries()),
          nextLabel: this.nextLabel,
        }),
      );
    } catch {
      // Best effort — index can always be rebuilt from SQLite
    }
  }
}
