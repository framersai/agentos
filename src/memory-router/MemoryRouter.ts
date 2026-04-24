/**
 * @file MemoryRouter.ts
 * @description Top-level orchestrator that composes the LLM-as-judge
 * classifier and the pure `selectBackend` decision function into a single
 * per-query routing call.
 *
 * MemoryRouter is deliberately a THIN composition layer. It:
 *   1. Runs the classifier on the incoming query → category + token counts.
 *   2. Resolves the routing table from (preset | custom table | custom mapping).
 *   3. Calls the pure selectBackend to get the routing decision.
 *   4. Returns a {@link MemoryRouterDecision} bundling both.
 *
 * It does NOT execute the recall — backend execution is the job of
 * {@link IMemoryDispatcher}. This split keeps the router pure-enough to
 * be used in both "decide only" flows (benchmarks, dashboards, dry-runs)
 * and "decide + execute" flows (production queries).
 *
 * @module @framers/agentos/memory-router/MemoryRouter
 */

import type {
  IMemoryClassifier,
  MemoryClassifierResult,
} from './classifier.js';
import {
  DEFAULT_MEMORY_BACKEND_COSTS,
  type MemoryBackendCostPoint,
} from './backend-costs.js';
import {
  PRESET_TABLES,
  type MemoryBackendId,
  type MemoryQueryCategory,
  type MemoryRouterPreset,
  type RoutingTable,
} from './routing-tables.js';
import {
  selectBackend,
  type MemoryBudgetMode,
  type MemoryRoutingDecision,
} from './select-backend.js';
import type {
  IMemoryDispatcher,
  MemoryDispatchResult,
} from './dispatcher.js';

// ============================================================================
// Public types
// ============================================================================

/**
 * Per-query USD budget policy. Combined into a single nested object so
 * consumers can enable budget enforcement without flat-argument sprawl.
 */
export interface MemoryBudgetPolicy {
  /**
   * Budget ceiling per query in USD. When omitted, routing passes
   * through the table's pick regardless of cost.
   */
  readonly perQueryUsd?: number;
  /**
   * How to handle budget overrun. Default `cheapest-fallback` for
   * production safety (silently downgrades rather than throwing).
   * See {@link MemoryBudgetMode}.
   */
  readonly mode?: MemoryBudgetMode;
}

/**
 * Constructor options for {@link MemoryRouter}.
 */
export interface MemoryRouterOptions {
  /** LLM-as-judge classifier. Usually {@link LLMMemoryClassifier}. */
  readonly classifier: IMemoryClassifier;
  /**
   * Shipping preset to use. Defaults to `minimize-cost` — the same
   * Pareto-best-for-cost preset we use on LongMemEval-S Phase B.
   */
  readonly preset?: MemoryRouterPreset;
  /**
   * Optional custom routing table override. When provided, replaces the
   * preset's default table. The `preset` field is still used for
   * telemetry labeling and must match.
   */
  readonly routingTable?: RoutingTable;
  /**
   * Optional per-category routing override that patches the resolved
   * routing table. Useful when a workload needs to change a single
   * category's dispatch without rewriting the whole table.
   */
  readonly mapping?: Partial<Record<MemoryQueryCategory, MemoryBackendId>>;
  /**
   * Optional budget policy. When omitted, no budget is enforced.
   */
  readonly budget?: MemoryBudgetPolicy;
  /**
   * Optional custom backend cost-points (for workloads whose cost /
   * accuracy profile diverges from LongMemEval-S Phase B). When omitted,
   * uses {@link DEFAULT_MEMORY_BACKEND_COSTS}.
   */
  readonly backendCosts?: Readonly<
    Record<MemoryBackendId, MemoryBackendCostPoint>
  >;
  /**
   * Default for {@link MemoryClassifierClassifyOptions.useFewShotPrompt}
   * on every `decide()` call. Callers can still override per-call.
   */
  readonly useFewShotPrompt?: boolean;
  /**
   * Optional dispatcher. When supplied, {@link MemoryRouter.decideAndDispatch}
   * is usable; otherwise callers must use {@link MemoryRouter.decide} and
   * execute the chosen backend themselves.
   */
  readonly dispatcher?: IMemoryDispatcher<unknown, unknown>;
}

/**
 * Per-call options for {@link MemoryRouter.decide}.
 */
export interface MemoryRouterDecideOptions {
  /**
   * Ground-truth category, passed through to the routing decision for
   * telemetry. Not used in production. Benchmark adapters pass this when
   * the gold label is available so downstream analysis can distinguish
   * classifier misroutes from architectural misses.
   */
  readonly groundTruthCategory?: MemoryQueryCategory | null;
  /**
   * Per-call override of the few-shot prompt variant. When omitted,
   * inherits the router's constructor-scoped default.
   */
  readonly useFewShotPrompt?: boolean;
}

/**
 * Bundled result of a `decide()` call. Carries the classifier result
 * (for cost tracking + debugging) alongside the routing decision.
 */
export interface MemoryRouterDecision {
  readonly classifier: MemoryClassifierResult;
  readonly routing: MemoryRoutingDecision;
}

/**
 * Bundled result of a `decideAndDispatch()` call. Combines the full
 * {@link MemoryRouterDecision} with the dispatched traces so telemetry
 * and answer-generation can consume both in one step.
 */
export interface MemoryRouterDispatchedDecision<TTrace> {
  readonly decision: MemoryRouterDecision;
  readonly traces: TTrace[];
  readonly backend: MemoryBackendId;
}

/**
 * Thrown when `decideAndDispatch` is called on a router that was
 * constructed without a dispatcher.
 */
export class MemoryRouterDispatcherMissingError extends Error {
  constructor() {
    super(
      'MemoryRouter.decideAndDispatch requires a dispatcher. ' +
        'Either pass a dispatcher in options, or call `decide` and dispatch yourself.',
    );
    this.name = 'MemoryRouterDispatcherMissingError';
  }
}

// ============================================================================
// Class
// ============================================================================

/**
 * The public MemoryRouter primitive. One instance per memory-recall
 * endpoint; construct once at app startup with the chosen preset and
 * reuse across queries.
 *
 * @example Basic min-cost routing
 * ```ts
 * import { LLMMemoryClassifier, MemoryRouter } from '@framers/agentos/memory-router';
 *
 * const router = new MemoryRouter({
 *   classifier: new LLMMemoryClassifier({ llm: myOpenAIAdapter }),
 *   preset: 'minimize-cost',
 * });
 *
 * const decision = await router.decide("What's my current job title?");
 * console.log(decision.classifier.category); // 'knowledge-update'
 * console.log(decision.routing.chosenBackend); // 'canonical-hybrid'
 * console.log(decision.routing.estimatedCostUsd); // 0.0189
 * ```
 *
 * @example With a strict budget
 * ```ts
 * const router = new MemoryRouter({
 *   classifier: myClassifier,
 *   preset: 'maximize-accuracy',
 *   budget: { perQueryUsd: 0.025, mode: 'cheapest-fallback' },
 * });
 * ```
 */
export class MemoryRouter {
  private readonly classifier: IMemoryClassifier;
  private readonly preset: MemoryRouterPreset;
  private readonly routingTable: RoutingTable;
  private readonly budgetPerQuery: number | null;
  private readonly budgetMode: MemoryBudgetMode;
  private readonly backendCosts: Readonly<
    Record<MemoryBackendId, MemoryBackendCostPoint>
  >;
  private readonly defaultUseFewShotPrompt: boolean;
  private readonly dispatcher: IMemoryDispatcher<unknown, unknown> | null;

  constructor(options: MemoryRouterOptions) {
    this.classifier = options.classifier;
    this.preset = options.preset ?? 'minimize-cost';
    this.dispatcher = options.dispatcher ?? null;

    // Resolve routing table: explicit > preset's default.
    const baseTable = options.routingTable ?? PRESET_TABLES[this.preset];

    // Apply optional per-category mapping override.
    if (options.mapping) {
      const patched: Record<MemoryQueryCategory, MemoryBackendId> = {
        ...baseTable.defaultMapping,
      };
      for (const key of Object.keys(options.mapping) as MemoryQueryCategory[]) {
        const override = options.mapping[key];
        if (override) patched[key] = override;
      }
      this.routingTable = Object.freeze({
        preset: baseTable.preset,
        defaultMapping: Object.freeze(patched),
      });
    } else {
      this.routingTable = baseTable;
    }

    this.budgetPerQuery = options.budget?.perQueryUsd ?? null;
    this.budgetMode = options.budget?.mode ?? 'cheapest-fallback';
    this.backendCosts = options.backendCosts ?? DEFAULT_MEMORY_BACKEND_COSTS;
    this.defaultUseFewShotPrompt = options.useFewShotPrompt ?? false;
  }

  /**
   * Decide-only routing. Classifies the query, picks a backend, returns
   * both pieces. Does NOT execute the recall — pair with an
   * {@link IMemoryDispatcher} for the end-to-end flow, or call
   * {@link MemoryRouter.decideAndDispatch} if a dispatcher is wired.
   *
   * @param query - The user's memory-recall query text.
   * @param options - Per-call overrides (ground-truth telemetry, prompt variant).
   * @returns A {@link MemoryRouterDecision} bundling classifier + routing results.
   */
  async decide(
    query: string,
    options?: MemoryRouterDecideOptions,
  ): Promise<MemoryRouterDecision> {
    const useFewShot =
      options?.useFewShotPrompt ?? this.defaultUseFewShotPrompt;
    const classifierOptions = useFewShot
      ? { useFewShotPrompt: true }
      : undefined;

    const classifier = await this.classifier.classify(query, classifierOptions);

    const routing = selectBackend({
      predictedCategory: classifier.category,
      groundTruthCategory: options?.groundTruthCategory ?? null,
      config: {
        table: this.routingTable,
        budgetPerQuery: this.budgetPerQuery,
        budgetMode: this.budgetMode,
        backendCosts: this.backendCosts,
      },
    });

    return { classifier, routing };
  }

  /**
   * Decide + dispatch in one call. Requires the router to have been
   * constructed with a {@link IMemoryDispatcher}.
   *
   * @typeParam TTrace - Caller's trace shape (passed through verbatim).
   * @typeParam TPayload - Caller's payload shape for the dispatcher.
   * @param query - User memory-recall query.
   * @param dispatchPayload - Optional payload forwarded to the dispatcher's
   *   per-backend executor (e.g. topK, retrieval policy).
   * @param options - Per-call overrides (ground-truth telemetry, prompt variant).
   *
   * @throws {@link MemoryRouterDispatcherMissingError} when no dispatcher
   *   was supplied at construction.
   */
  async decideAndDispatch<TTrace, TPayload = undefined>(
    query: string,
    dispatchPayload?: TPayload,
    options?: MemoryRouterDecideOptions,
  ): Promise<MemoryRouterDispatchedDecision<TTrace>> {
    if (!this.dispatcher) {
      throw new MemoryRouterDispatcherMissingError();
    }

    const decision = await this.decide(query, options);
    const dispatched = (await this.dispatcher.dispatch({
      backend: decision.routing.chosenBackend,
      query,
      payload: dispatchPayload as unknown,
    })) as MemoryDispatchResult<TTrace>;

    return {
      decision,
      traces: dispatched.traces,
      backend: dispatched.backend,
    };
  }
}
