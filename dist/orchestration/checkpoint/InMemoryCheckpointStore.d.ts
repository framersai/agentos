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
export declare class InMemoryCheckpointStore implements ICheckpointStore {
    /** Primary storage map — checkpoint.id → Checkpoint. */
    private readonly _checkpoints;
    /** {@inheritDoc ICheckpointStore.save} */
    save(checkpoint: Checkpoint): Promise<void>;
    /** {@inheritDoc ICheckpointStore.get} */
    get(checkpointId: string): Promise<Checkpoint | null>;
    /** {@inheritDoc ICheckpointStore.load} */
    load(runId: string, nodeId?: string): Promise<Checkpoint | null>;
    /** {@inheritDoc ICheckpointStore.latest} */
    latest(runId: string): Promise<Checkpoint | null>;
    /** {@inheritDoc ICheckpointStore.list} */
    list(graphId: string, options?: {
        limit?: number;
        runId?: string;
    }): Promise<CheckpointMetadata[]>;
    /** {@inheritDoc ICheckpointStore.delete} */
    delete(checkpointId: string): Promise<void>;
    /** {@inheritDoc ICheckpointStore.fork} */
    fork(checkpointId: string, patchState?: Partial<GraphState>): Promise<string>;
}
//# sourceMappingURL=InMemoryCheckpointStore.d.ts.map