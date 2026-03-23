/**
 * @file index.ts
 * @description Public barrel for the orchestration checkpoint subsystem.
 *
 * Exports the `ICheckpointStore` interface, the `Checkpoint` and `CheckpointMetadata`
 * types, and the built-in `InMemoryCheckpointStore` implementation.
 */

export * from './ICheckpointStore.js';
export { InMemoryCheckpointStore } from './InMemoryCheckpointStore.js';
