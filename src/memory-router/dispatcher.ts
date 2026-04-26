/**
 * @file dispatcher.ts
 * @description Backend-execution layer for {@link MemoryRouter}.
 *
 * A dispatcher turns a {@link MemoryBackendId} + a query into actual
 * recall results. Because backend execution depends on how the caller's
 * memory state is wired — `canonical-hybrid` needs only a query against a
 * standing {@link Memory}, whereas `observational-memory-*` backends need
 * ingest-time OM setup — the dispatcher is an injection point rather than
 * a monolithic implementation.
 *
 * The shipping dispatcher, {@link FunctionMemoryDispatcher}, uses a
 * routing-table-of-functions pattern: the caller provides `{ [backend]:
 * (query, payload?) => Promise<traces> }` at construction, and the
 * dispatcher picks the right function per call. This gives consumers:
 *   - full control over per-backend execution (connect to a standing
 *     HybridRetriever, a live OM ingest pipeline, a remote service, a
 *     cache, anything),
 *   - the ability to opt-out of backends they don't need (omitted keys
 *     raise a typed {@link UnsupportedMemoryBackendError} at dispatch
 *     time),
 *   - full type-safety on the per-call `payload` (passed through to the
 *     per-backend function verbatim).
 *
 * Callers who want to ship quickly with just canonical-hybrid can pass
 * only `{ 'canonical-hybrid': (q) => mem.recall(q, { limit, policy }) }`
 * and get end-to-end routing without touching the OM backends.
 *
 * @module @framers/agentos/memory-router/dispatcher
 */

import type { MemoryBackendId } from './routing-tables.js';
import type { RetrievalConfigId } from './retrieval-config.js';

// ============================================================================
// Public types
// ============================================================================

/**
 * Optional execution context passed as the third argument to a
 * {@link MemoryBackendExecutor}. Carries cross-cutting per-call hints
 * the dispatcher knows about but the user-defined payload should not
 * have to encode (e.g. the {@link RetrievalConfigId} chosen by the
 * augmented router).
 *
 * Existing executors with the older two-argument signature
 * `(query, payload) => traces` remain assignable to
 * {@link MemoryBackendExecutor} because the context arg is optional —
 * functions are contravariant in their parameters and JavaScript
 * silently ignores unused trailing arguments.
 */
export interface MemoryBackendExecutorContext {
  /**
   * Augmented router's per-query retrieval-config pick. When set, the
   * executor SHOULD apply the corresponding flags
   * (see `RETRIEVAL_CONFIG_SPECS`) to its retrieval pipeline.
   * Undefined when the dispatcher was called via the legacy backend-
   * only path.
   */
  readonly retrievalConfig?: RetrievalConfigId;
}

/**
 * Per-backend execution function. Takes the query string + an optional
 * caller-defined payload (e.g. topK, retrieval policy, session filter),
 * returns the trace array.
 *
 * The optional third arg, {@link MemoryBackendExecutorContext}, carries
 * cross-cutting hints the dispatcher routes through — currently the
 * augmented router's per-query {@link RetrievalConfigId}. Executors
 * written before augmented routing existed remain assignable because
 * the third arg is optional.
 *
 * @typeParam TTrace - Shape of the trace the caller's memory layer emits.
 *   Defaults to the {@link ScoredTrace} shape from `@framers/agentos/memory`
 *   but any shape is accepted since the dispatcher is a pass-through.
 * @typeParam TPayload - Shape of the optional payload argument.
 */
export type MemoryBackendExecutor<TTrace, TPayload = undefined> = (
  query: string,
  payload: TPayload,
  context?: MemoryBackendExecutorContext,
) => Promise<TTrace[]>;

/**
 * Args passed to {@link IMemoryDispatcher.dispatch}.
 */
export interface MemoryDispatchArgs<TPayload = undefined> {
  readonly backend: MemoryBackendId;
  readonly query: string;
  /** Optional payload forwarded to the per-backend executor verbatim. */
  readonly payload?: TPayload;
  /**
   * Optional augmented-router pick. When supplied, the dispatcher
   * forwards it as the third executor arg
   * ({@link MemoryBackendExecutorContext.retrievalConfig}). Existing
   * legacy callers omit this field; existing executors ignore the
   * third arg unless they opt in.
   */
  readonly retrievalConfig?: RetrievalConfigId;
}

/**
 * Result of a dispatch call. Carries the traces plus the backend that
 * produced them (for telemetry + logging).
 */
export interface MemoryDispatchResult<TTrace> {
  readonly traces: TTrace[];
  readonly backend: MemoryBackendId;
}

/**
 * The public dispatcher contract. Callers either use the built-in
 * {@link FunctionMemoryDispatcher} or implement this interface with
 * their own backend registry.
 */
export interface IMemoryDispatcher<TTrace = unknown, TPayload = unknown> {
  dispatch(
    args: MemoryDispatchArgs<TPayload>,
  ): Promise<MemoryDispatchResult<TTrace>>;
}

/**
 * Thrown when a dispatch call requests a backend that the dispatcher
 * was not configured to support. Lets callers surface missing-backend
 * bugs at the point of call rather than silently falling through.
 */
export class UnsupportedMemoryBackendError extends Error {
  constructor(public readonly backend: MemoryBackendId) {
    super(
      `MemoryDispatcher: backend '${backend}' is not registered. ` +
        `Supply an executor for this backend at construction time.`,
    );
    this.name = 'UnsupportedMemoryBackendError';
  }
}

// ============================================================================
// Reference implementation
// ============================================================================

/**
 * Map of backend-id to executor function. Any subset of
 * {@link MemoryBackendId} values may be registered; unregistered
 * backends throw at dispatch time.
 */
export type MemoryBackendRegistry<TTrace, TPayload> = Partial<
  Record<MemoryBackendId, MemoryBackendExecutor<TTrace, TPayload>>
>;

/**
 * Built-in dispatcher that looks up a caller-supplied per-backend
 * executor and invokes it with the query (+ optional payload).
 *
 * The generic parameters let each deployment type its trace shape and
 * payload shape independently — a canonical-hybrid-only deployment can
 * use `FunctionMemoryDispatcher<ScoredTrace, { topK: number }>`, while a
 * mixed deployment can use `FunctionMemoryDispatcher<ScoredTrace, { topK:
 * number; retrievalPolicy: MemoryRetrievalPolicy }>`.
 *
 * @example canonical-hybrid-only (simplest case)
 * ```ts
 * const dispatcher = new FunctionMemoryDispatcher<ScoredTrace, { topK: number }>({
 *   'canonical-hybrid': async (query, { topK }) =>
 *     mem.recall(query, { limit: topK }),
 * });
 * ```
 *
 * @example Production routing with three backends
 * ```ts
 * const dispatcher = new FunctionMemoryDispatcher<ScoredTrace, RetrievalPayload>({
 *   'canonical-hybrid': async (q, p) => hybridRetriever.retrieve(q, p),
 *   'observational-memory-v10': async (q, p) => omPipeline.recall(q, p),
 *   'observational-memory-v11': async (q, p) => omPipelineV11.recall(q, p),
 * });
 * ```
 */
export class FunctionMemoryDispatcher<TTrace, TPayload = undefined>
  implements IMemoryDispatcher<TTrace, TPayload>
{
  private readonly registry: MemoryBackendRegistry<TTrace, TPayload>;

  constructor(registry: MemoryBackendRegistry<TTrace, TPayload>) {
    this.registry = registry;
  }

  async dispatch(
    args: MemoryDispatchArgs<TPayload>,
  ): Promise<MemoryDispatchResult<TTrace>> {
    const executor = this.registry[args.backend];
    if (!executor) {
      throw new UnsupportedMemoryBackendError(args.backend);
    }
    // Preserve the legacy two-argument call shape on legacy dispatch
    // calls (no retrievalConfig). Only pass the context arg when the
    // augmented router has supplied a retrievalConfig — keeps existing
    // mocks asserting `executor(query, payload)` working unchanged.
    const traces =
      args.retrievalConfig !== undefined
        ? await executor(args.query, args.payload as TPayload, {
            retrievalConfig: args.retrievalConfig,
          })
        : await executor(args.query, args.payload as TPayload);
    return { traces, backend: args.backend };
  }
}
