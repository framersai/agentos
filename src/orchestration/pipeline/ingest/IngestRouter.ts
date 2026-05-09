/**
 * @file IngestRouter.ts
 * @description Top-level input-stage orchestrator that composes the
 * ingest classifier and the pure {@link selectIngestStrategy} into a
 * single per-content routing call.
 *
 * Same shape as MemoryRouter (recall-stage) so Cognitive Pipeline can
 * compose them uniformly. Decide-only and decide+dispatch
 * flows are both supported.
 *
 * @module @framers/agentos/ingest-router/IngestRouter
 */

import type {
  IIngestClassifier,
  IngestClassifierResult,
} from './classifier.js';
import {
  DEFAULT_INGEST_COSTS,
  type IngestStrategyCostPoint,
} from './costs.js';
import {
  PRESET_INGEST_TABLES,
  type IngestContentKind,
  type IngestRouterPreset,
  type IngestRoutingTable,
  type IngestStrategyId,
} from './routing-tables.js';
import {
  selectIngestStrategy,
  type IngestBudgetMode,
  type IngestRoutingDecision,
} from './select-strategy.js';
import type {
  IIngestDispatcher,
  IngestDispatchResult,
} from './dispatcher.js';

export interface IngestBudgetPolicy {
  readonly perIngestUsd?: number;
  readonly mode?: IngestBudgetMode;
}

export interface IngestRouterOptions {
  readonly classifier: IIngestClassifier;
  readonly preset?: IngestRouterPreset;
  readonly routingTable?: IngestRoutingTable;
  readonly mapping?: Partial<Record<IngestContentKind, IngestStrategyId>>;
  readonly budget?: IngestBudgetPolicy;
  readonly strategyCosts?: Readonly<
    Record<IngestStrategyId, IngestStrategyCostPoint>
  >;
  readonly useFewShotPrompt?: boolean;
  readonly dispatcher?: IIngestDispatcher<unknown, unknown>;
}

export interface IngestRouterDecideOptions {
  /**
   * Optional manual override of the classifier. When set, the classifier
   * is NOT invoked and the routing table is consulted with this kind
   * directly. Useful when the caller already knows the content kind
   * (e.g., file extension determines code vs structured-data).
   */
  readonly manualKind?: IngestContentKind;
  readonly groundTruthKind?: IngestContentKind | null;
  readonly useFewShotPrompt?: boolean;
}

export interface IngestRouterDecision {
  readonly classifier: IngestClassifierResult;
  readonly routing: IngestRoutingDecision;
}

export interface IngestRouterDispatchedResult<TOutcome> {
  readonly decision: IngestRouterDecision;
  readonly outcome: TOutcome;
  readonly strategy: IngestStrategyId;
}

export class IngestRouterDispatcherMissingError extends Error {
  constructor() {
    super(
      'IngestRouter.decideAndDispatch requires a dispatcher. ' +
        'Either pass a dispatcher in options or call `decide` and dispatch yourself.',
    );
    this.name = 'IngestRouterDispatcherMissingError';
  }
}

/**
 * Public input-stage orchestrator. One instance per ingest endpoint;
 * reuse across content events.
 */
export class IngestRouter {
  private readonly classifier: IIngestClassifier;
  private readonly preset: IngestRouterPreset;
  private readonly routingTable: IngestRoutingTable;
  private readonly budgetPerIngestUsd: number | null;
  private readonly budgetMode: IngestBudgetMode;
  private readonly strategyCosts: Readonly<
    Record<IngestStrategyId, IngestStrategyCostPoint>
  >;
  private readonly defaultUseFewShotPrompt: boolean;
  private readonly dispatcher: IIngestDispatcher<unknown, unknown> | null;

  constructor(options: IngestRouterOptions) {
    this.classifier = options.classifier;
    this.preset = options.preset ?? 'raw-chunks';
    this.dispatcher = options.dispatcher ?? null;

    const baseTable = options.routingTable ?? PRESET_INGEST_TABLES[this.preset];
    if (options.mapping) {
      const patched: Record<IngestContentKind, IngestStrategyId> = {
        ...baseTable.defaultMapping,
      };
      for (const key of Object.keys(options.mapping) as IngestContentKind[]) {
        const ov = options.mapping[key];
        if (ov) patched[key] = ov;
      }
      this.routingTable = Object.freeze({
        preset: baseTable.preset,
        defaultMapping: Object.freeze(patched),
      });
    } else {
      this.routingTable = baseTable;
    }

    this.budgetPerIngestUsd = options.budget?.perIngestUsd ?? null;
    this.budgetMode = options.budget?.mode ?? 'cheapest-fallback';
    this.strategyCosts = options.strategyCosts ?? DEFAULT_INGEST_COSTS;
    this.defaultUseFewShotPrompt = options.useFewShotPrompt ?? false;
  }

  async decide(
    content: string,
    options?: IngestRouterDecideOptions,
  ): Promise<IngestRouterDecision> {
    let classifier: IngestClassifierResult;
    if (options?.manualKind) {
      classifier = {
        kind: options.manualKind,
        tokensIn: 0,
        tokensOut: 0,
        model: 'manual',
      };
    } else {
      const useFewShot =
        options?.useFewShotPrompt ?? this.defaultUseFewShotPrompt;
      classifier = await this.classifier.classify(
        content,
        useFewShot ? { useFewShotPrompt: true } : undefined,
      );
    }

    const routing = selectIngestStrategy({
      predictedKind: classifier.kind,
      groundTruthKind: options?.groundTruthKind ?? null,
      config: {
        table: this.routingTable,
        budgetPerIngestUsd: this.budgetPerIngestUsd,
        budgetMode: this.budgetMode,
        strategyCosts: this.strategyCosts,
      },
    });

    return { classifier, routing };
  }

  async decideAndDispatch<TOutcome, TPayload = undefined>(
    content: string,
    dispatchPayload?: TPayload,
    options?: IngestRouterDecideOptions,
  ): Promise<IngestRouterDispatchedResult<TOutcome>> {
    if (!this.dispatcher) {
      throw new IngestRouterDispatcherMissingError();
    }

    const decision = await this.decide(content, options);
    const dispatched = (await this.dispatcher.dispatch({
      strategy: decision.routing.chosenStrategy,
      content,
      payload: dispatchPayload as unknown,
    })) as IngestDispatchResult<TOutcome>;

    return {
      decision,
      outcome: dispatched.outcome,
      strategy: dispatched.strategy,
    };
  }
}
