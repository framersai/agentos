/**
 * @file GraphEvent.ts
 * @description Discriminated union of all runtime events emitted during an AgentOS graph run,
 * plus a `GraphEventEmitter` that supports both listener-based and async-iterable consumption.
 *
 * Events are emitted in strict causal order within a single run. Consumers may subscribe via
 * `on()` / `off()` for push-based handling, or via `stream()` for pull-based async iteration.
 */
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
    constructor() {
        /** Registered push-based listener callbacks. */
        this.listeners = [];
        /**
         * `true` after `close()` has been called. Once closed, `emit()` becomes a no-op
         * and all active `stream()` generators are drained and terminated.
         */
        this.closed = false;
        // ---------------------------------------------------------------------------
        // Pull-based API (async iterable)
        // ---------------------------------------------------------------------------
        /**
         * Internal set of per-stream event dispatch functions.
         * Each active `stream()` generator registers one entry here.
         */
        this.streamDispatchers = new Set();
        /**
         * Internal set of per-stream close signals.
         * Each active `stream()` generator registers one entry here.
         */
        this.streamCompleters = new Set();
    }
    // ---------------------------------------------------------------------------
    // Push-based API
    // ---------------------------------------------------------------------------
    /**
     * Registers a callback that is invoked synchronously for every subsequent `emit()` call.
     *
     * @param listener - Function to call with each emitted `GraphEvent`.
     */
    on(listener) {
        this.listeners.push(listener);
    }
    /**
     * Removes a previously registered listener.
     * If the listener was not registered, this is a no-op.
     *
     * @param listener - The exact function reference passed to `on()`.
     */
    off(listener) {
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
    emit(event) {
        if (this.closed)
            return;
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
    close() {
        if (this.closed)
            return;
        this.closed = true;
        // Signal each active stream generator to complete.
        for (const complete of this.streamCompleters) {
            complete();
        }
    }
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
    async *stream() {
        // Per-generator queue of events waiting to be yielded.
        const queue = [];
        // When non-null, a pending `await next` in the generator loop is resolved here.
        let pendingResolve = null;
        /**
         * Called by `emit()` — either resolves a waiting generator or enqueues the event.
         */
        const dispatch = (event) => {
            if (pendingResolve !== null) {
                const resolve = pendingResolve;
                pendingResolve = null;
                resolve({ value: event, done: false });
            }
            else {
                queue.push(event);
            }
        };
        /** Called by `close()` — wakes up a waiting generator so it can drain and exit. */
        const complete = () => {
            if (pendingResolve !== null) {
                const resolve = pendingResolve;
                pendingResolve = null;
                // Signal the generator loop to re-check the closed flag.
                resolve({ value: undefined, done: true });
            }
        };
        this.streamDispatchers.add(dispatch);
        this.streamCompleters.add(complete);
        try {
            // If the emitter was already closed before stream() was called, drain nothing.
            while (!this.closed || queue.length > 0) {
                if (queue.length > 0) {
                    // There are queued events — yield them immediately without suspending.
                    yield queue.shift();
                }
                else if (this.closed) {
                    // Queue is empty and emitter is closed — we are done.
                    break;
                }
                else {
                    // Queue is empty and emitter is still open — suspend until the next event.
                    const result = await new Promise((resolve) => {
                        pendingResolve = resolve;
                    });
                    if (result.done) {
                        // `complete()` was called — drain remaining queue items then exit.
                        while (queue.length > 0) {
                            yield queue.shift();
                        }
                        break;
                    }
                    yield result.value;
                }
            }
        }
        finally {
            // Always clean up registrations, even if the caller breaks out of the for-await loop.
            this.streamDispatchers.delete(dispatch);
            this.streamCompleters.delete(complete);
            if (pendingResolve !== null) {
                // Resolve any dangling promise to avoid memory leaks.
                const resolve = pendingResolve;
                pendingResolve = null;
                resolve({ value: undefined, done: true });
            }
        }
    }
}
//# sourceMappingURL=GraphEvent.js.map