/**
 * @file GraphEvent.ts
 * @description Discriminated union of all runtime events emitted during an AgentOS graph run,
 * plus a `GraphEventEmitter` that supports both listener-based and async-iterable consumption.
 *
 * Events are emitted in strict causal order within a single run. Consumers may subscribe via
 * `on()` / `off()` for push-based handling, or via `stream()` for pull-based async iteration.
 */

import type { GraphState } from '../ir/types.js';

// ---------------------------------------------------------------------------
// GraphEvent discriminated union
// ---------------------------------------------------------------------------

/**
 * All runtime events emitted by the graph executor.
 *
 * Every variant carries a `type` discriminant so consumers can narrow with a
 * simple `switch (event.type)` or exhaustive-check library.
 */
export type GraphEvent =
  /** Emitted once when the executor accepts a new run request. */
  | { type: 'run_start'; runId: string; graphId: string }

  /** Emitted immediately before a node's executor is called. */
  | { type: 'node_start'; nodeId: string; state: Partial<GraphState> }

  /**
   * Emitted after a node's executor returns successfully.
   * `durationMs` is wall-clock time from `node_start` to `node_end`.
   */
  | { type: 'node_end'; nodeId: string; output: unknown; durationMs: number }

  /** Emitted when the executor resolves a routing condition and moves to the next node. */
  | { type: 'edge_transition'; sourceId: string; targetId: string; edgeType: string }

  /**
   * Streaming token delta from an LLM (GMI) node.
   * Multiple deltas are emitted per node; concatenate `content` to reconstruct the full response.
   */
  | { type: 'text_delta'; nodeId: string; content: string }

  /** Emitted when a node issues a tool call to the tool catalogue. */
  | { type: 'tool_call'; nodeId: string; toolName: string; args: unknown }

  /** Emitted when a tool call returns (whether success or structured error). */
  | { type: 'tool_result'; nodeId: string; toolName: string; result: unknown }

  /**
   * Emitted after each guardrail evaluation.
   * `passed: false` indicates a violation; `action` mirrors `GuardrailPolicy.onViolation`.
   */
  | { type: 'guardrail_result'; nodeId: string; guardrailId: string; passed: boolean; action: string }

  /** Emitted after the runtime successfully persists a checkpoint snapshot. */
  | { type: 'checkpoint_saved'; checkpointId: string; nodeId: string }

  /**
   * Emitted when graph execution is suspended mid-run.
   * - `human_approval`     — node requires operator sign-off before proceeding.
   * - `error`              — unrecoverable error after exhausting retry budget.
   * - `guardrail_violation` — a `block` guardrail fired, halting the run.
   */
  | { type: 'interrupt'; nodeId: string; reason: 'human_approval' | 'error' | 'guardrail_violation' }

  /** Emitted after memory traces are loaded into `GraphState.memory` for a node. */
  | { type: 'memory_read'; nodeId: string; traceCount: number }

  /** Emitted after a memory trace is staged or committed for a node. */
  | { type: 'memory_write'; nodeId: string; traceType: string }

  /** Emitted after `DiscoveryPolicy`-triggered capability discovery completes. */
  | { type: 'discovery_result'; nodeId: string; toolsFound: string[] }

  /**
   * Emitted once when the graph run concludes normally.
   * `totalDurationMs` is wall-clock time from `run_start` to `run_end`.
   */
  | { type: 'run_end'; runId: string; finalOutput: unknown; totalDurationMs: number }

  /** Emitted when a node's wall-clock execution time exceeds `GraphNode.timeout`. */
  | { type: 'node_timeout'; nodeId: string; timeoutMs: number }

  /**
   * Emitted for unhandled exceptions or structured runtime errors.
   * `nodeId` is absent for graph-level errors that occur outside any node's scope.
   */
  | { type: 'error'; nodeId?: string; error: { message: string; code: string } };

// ---------------------------------------------------------------------------
// GraphEventEmitter
// ---------------------------------------------------------------------------

/**
 * Lightweight event emitter for `GraphEvent` values.
 *
 * Supports both:
 * - **Push-based** consumption via `on()` / `off()` callbacks.
 * - **Pull-based** consumption via the `stream()` async generator.
 *
 * The emitter is single-use: once `close()` is called it is permanently closed
 * and subsequent `emit()` calls are silently ignored.
 *
 * @example
 * ```ts
 * const emitter = new GraphEventEmitter();
 *
 * // Pull-based — collect events in order
 * async function consume() {
 *   for await (const event of emitter.stream()) {
 *     console.log(event.type);
 *   }
 * }
 *
 * emitter.emit({ type: 'run_start', runId: 'r1', graphId: 'g1' });
 * emitter.close();
 * await consume(); // logs 'run_start'
 * ```
 */
export class GraphEventEmitter {
  /** Registered push-based listener callbacks. */
  private readonly listeners: Array<(event: GraphEvent) => void> = [];

  /**
   * `true` after `close()` has been called. Once closed, `emit()` becomes a no-op
   * and all active `stream()` generators are drained and terminated.
   */
  private closed = false;

  // ---------------------------------------------------------------------------
  // Push-based API
  // ---------------------------------------------------------------------------

  /**
   * Registers a callback that is invoked synchronously for every subsequent `emit()` call.
   *
   * @param listener - Function to call with each emitted `GraphEvent`.
   */
  on(listener: (event: GraphEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Removes a previously registered listener.
   * If the listener was not registered, this is a no-op.
   *
   * @param listener - The exact function reference passed to `on()`.
   */
  off(listener: (event: GraphEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Dispatches `event` to all registered listeners and any active `stream()` generators.
   * If `close()` has already been called, this method is a no-op.
   *
   * @param event - The `GraphEvent` to dispatch.
   */
  emit(event: GraphEvent): void {
    if (this.closed) return;

    // Notify all push-based listeners synchronously.
    for (const listener of this.listeners) {
      listener(event);
    }

    // Notify all active stream generators via their internal dispatch functions.
    for (const dispatch of this.streamDispatchers) {
      dispatch(event);
    }
  }

  /**
   * Permanently closes the emitter.
   *
   * - Future `emit()` calls are silently ignored.
   * - Active `stream()` generators are signalled to drain their queues and return.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    // Signal each active stream generator to complete.
    for (const complete of this.streamCompleters) {
      complete();
    }
  }

  // ---------------------------------------------------------------------------
  // Pull-based API (async iterable)
  // ---------------------------------------------------------------------------

  /**
   * Internal set of per-stream event dispatch functions.
   * Each active `stream()` generator registers one entry here.
   */
  private readonly streamDispatchers = new Set<(event: GraphEvent) => void>();

  /**
   * Internal set of per-stream close signals.
   * Each active `stream()` generator registers one entry here.
   */
  private readonly streamCompleters = new Set<() => void>();

  /**
   * Returns an `AsyncGenerator` that yields every `GraphEvent` emitted after the
   * call to `stream()`, in the exact order they were emitted.
   *
   * The generator completes (returns) when `close()` is called on the emitter
   * and any queued events have been yielded.
   *
   * Multiple concurrent `stream()` calls are supported; each gets an independent
   * copy of the event stream.
   *
   * @example
   * ```ts
   * for await (const event of emitter.stream()) {
   *   if (event.type === 'run_end') break;
   * }
   * ```
   */
  async *stream(): AsyncGenerator<GraphEvent> {
    // Per-generator queue of events waiting to be yielded.
    const queue: GraphEvent[] = [];

    // When non-null, a pending `await next` in the generator loop is resolved here.
    let pendingResolve: ((value: IteratorResult<GraphEvent>) => void) | null = null;

    /**
     * Called by `emit()` — either resolves a waiting generator or enqueues the event.
     */
    const dispatch = (event: GraphEvent): void => {
      if (pendingResolve !== null) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value: event, done: false });
      } else {
        queue.push(event);
      }
    };

    /** Called by `close()` — wakes up a waiting generator so it can drain and exit. */
    const complete = (): void => {
      if (pendingResolve !== null) {
        const resolve = pendingResolve;
        pendingResolve = null;
        // Signal the generator loop to re-check the closed flag.
        resolve({ value: undefined as unknown as GraphEvent, done: true });
      }
    };

    this.streamDispatchers.add(dispatch);
    this.streamCompleters.add(complete);

    try {
      // If the emitter was already closed before stream() was called, drain nothing.
      while (!this.closed || queue.length > 0) {
        if (queue.length > 0) {
          // There are queued events — yield them immediately without suspending.
          yield queue.shift()!;
        } else if (this.closed) {
          // Queue is empty and emitter is closed — we are done.
          break;
        } else {
          // Queue is empty and emitter is still open — suspend until the next event.
          const result = await new Promise<IteratorResult<GraphEvent>>((resolve) => {
            pendingResolve = resolve;
          });

          if (result.done) {
            // `complete()` was called — drain remaining queue items then exit.
            while (queue.length > 0) {
              yield queue.shift()!;
            }
            break;
          }

          yield result.value;
        }
      }
    } finally {
      // Always clean up registrations, even if the caller breaks out of the for-await loop.
      this.streamDispatchers.delete(dispatch);
      this.streamCompleters.delete(complete);
      if (pendingResolve !== null) {
        // Resolve any dangling promise to avoid memory leaks.
        const resolve = pendingResolve as (value: IteratorResult<GraphEvent>) => void;
        pendingResolve = null;
        resolve({ value: undefined as unknown as GraphEvent, done: true });
      }
    }
  }
}
