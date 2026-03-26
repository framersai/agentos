/**
 * @file InMemoryCheckpointStore.ts
 * @description In-memory implementation of `ICheckpointStore` backed by a `Map<string, Checkpoint>`.
 *
 * Intended for unit tests, local development, and ephemeral graph runs where durability is
 * not required. All data is lost when the process exits.
 *
 * Thread-safety note: Node.js is single-threaded so no explicit locking is needed, but callers
 * should be aware that concurrent async operations on the same store instance may interleave.
 */

import type { GraphState } from '../ir/types.js';
import type { Checkpoint, CheckpointMetadata, ICheckpointStore } from './ICheckpointStore.js';

/**
 * Derives a `CheckpointMetadata` descriptor from a full `Checkpoint` without copying the
 * heavyweight `state` payload.
 *
 * `stateSize` is approximated via `JSON.stringify` length — sufficient for ranking and
 * display purposes; no guarantee of byte-level accuracy.
 *
 * @internal
 */
function toMetadata(checkpoint: Checkpoint): CheckpointMetadata {
  return {
    id: checkpoint.id,
    runId: checkpoint.runId,
    graphId: checkpoint.graphId,
    nodeId: checkpoint.nodeId,
    timestamp: checkpoint.timestamp,
    stateSize: JSON.stringify(checkpoint.state).length,
    hasMemorySnapshot: checkpoint.memorySnapshot !== undefined,
  };
}

/**
 * In-memory `ICheckpointStore` implementation.
 *
 * All checkpoints are stored in a `Map` keyed by checkpoint `id`. Scans are O(n) over
 * the number of stored checkpoints — acceptable for test workloads; a production store
 * should use indexed secondary keys (runId, graphId).
 *
 * @example
 * ```ts
 * const store = new InMemoryCheckpointStore();
 * await store.save(checkpoint);
 * const restored = await store.latest(runId);
 * ```
 */
export class InMemoryCheckpointStore implements ICheckpointStore {
  /** Primary storage map — checkpoint.id → Checkpoint. */
  private readonly _checkpoints = new Map<string, Checkpoint>();

  /** {@inheritDoc ICheckpointStore.save} */
  async save(checkpoint: Checkpoint): Promise<void> {
    this._checkpoints.set(checkpoint.id, checkpoint);
  }

  /** {@inheritDoc ICheckpointStore.get} */
  async get(checkpointId: string): Promise<Checkpoint | null> {
    return this._checkpoints.get(checkpointId) ?? null;
  }

  /** {@inheritDoc ICheckpointStore.load} */
  async load(runId: string, nodeId?: string): Promise<Checkpoint | null> {
    const candidates = Array.from(this._checkpoints.values()).filter(
      (cp) => cp.runId === runId && (nodeId === undefined || cp.nodeId === nodeId)
    );

    if (candidates.length === 0) return null;

    // Return the most recently saved checkpoint among the matches.
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    return candidates[0]!;
  }

  /** {@inheritDoc ICheckpointStore.latest} */
  async latest(runId: string): Promise<Checkpoint | null> {
    return this.load(runId);
  }

  /** {@inheritDoc ICheckpointStore.list} */
  async list(
    graphId: string,
    options?: { limit?: number; runId?: string }
  ): Promise<CheckpointMetadata[]> {
    let results = Array.from(this._checkpoints.values()).filter(
      (cp) => cp.graphId === graphId && (options?.runId === undefined || cp.runId === options.runId)
    );

    // Most-recent-first ordering.
    results.sort((a, b) => b.timestamp - a.timestamp);

    if (options?.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results.map(toMetadata);
  }

  /** {@inheritDoc ICheckpointStore.delete} */
  async delete(checkpointId: string): Promise<void> {
    this._checkpoints.delete(checkpointId);
  }

  /** {@inheritDoc ICheckpointStore.fork} */
  async fork(checkpointId: string, patchState?: Partial<GraphState>): Promise<string> {
    const source = this._checkpoints.get(checkpointId);
    if (!source) {
      throw new Error(`InMemoryCheckpointStore.fork: checkpoint "${checkpointId}" not found`);
    }

    // Deep clone so mutations to the forked checkpoint cannot affect the source.
    const forked: Checkpoint = structuredClone(source);

    // Assign fresh identifiers so the fork is a distinct run.
    forked.runId = crypto.randomUUID();
    forked.id = crypto.randomUUID();
    forked.timestamp = Date.now();

    // Apply optional state patches — each partition is merged independently.
    if (patchState !== undefined) {
      if (patchState.input !== undefined) {
        Object.assign(forked.state.input as object, patchState.input);
      }
      if (patchState.scratch !== undefined) {
        Object.assign(forked.state.scratch as object, patchState.scratch);
      }
      if (patchState.artifacts !== undefined) {
        Object.assign(forked.state.artifacts as object, patchState.artifacts);
      }
      if (patchState.diagnostics !== undefined) {
        Object.assign(forked.state.diagnostics, patchState.diagnostics);
      }
    }

    await this.save(forked);
    return forked.runId;
  }
}
