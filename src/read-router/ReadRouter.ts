/**
 * @file ReadRouter.ts
 * @description Top-level read-stage orchestrator composing the read-intent
 * classifier with the pure {@link selectReadStrategy} into a single
 * per-query routing call.
 *
 * @module @framers/agentos/read-router/ReadRouter
 */

import type {
  IReadIntentClassifier,
  ReadIntentClassifierResult,
} from './classifier.js';
import { DEFAULT_READ_COSTS, type ReadStrategyCostPoint } from './costs.js';
import {
  PRESET_READ_TABLES,
  type ReadIntent,
  type ReadRouterPreset,
  type ReadRoutingTable,
  type ReadStrategyId,
} from './routing-tables.js';
import {
  selectReadStrategy,
  type ReadBudgetMode,
  type ReadRoutingDecision,
} from './select-strategy.js';
import type {
  IReadDispatcher,
  ReadDispatchResult,
} from './dispatcher.js';

export interface ReadBudgetPolicy {
  readonly perReadUsd?: number;
  readonly mode?: ReadBudgetMode;
}

export interface ReadRouterOptions {
  readonly classifier: IReadIntentClassifier;
  readonly preset?: ReadRouterPreset;
  readonly routingTable?: ReadRoutingTable;
  readonly mapping?: Partial<Record<ReadIntent, ReadStrategyId>>;
  readonly budget?: ReadBudgetPolicy;
  readonly strategyCosts?: Readonly<
    Record<ReadStrategyId, ReadStrategyCostPoint>
  >;
  readonly useFewShotPrompt?: boolean;
  readonly dispatcher?: IReadDispatcher<unknown, unknown>;
}

export interface ReadRouterDecideOptions {
  readonly manualIntent?: ReadIntent;
  readonly groundTruthIntent?: ReadIntent | null;
  readonly useFewShotPrompt?: boolean;
}

export interface ReadRouterDecision {
  readonly classifier: ReadIntentClassifierResult;
  readonly routing: ReadRoutingDecision;
}

export interface ReadRouterDispatchedResult<TOutcome> {
  readonly decision: ReadRouterDecision;
  readonly outcome: TOutcome;
  readonly strategy: ReadStrategyId;
}

export class ReadRouterDispatcherMissingError extends Error {
  constructor() {
    super(
      'ReadRouter.decideAndDispatch requires a dispatcher. ' +
        'Either pass a dispatcher in options or call `decide` and dispatch yourself.',
    );
    this.name = 'ReadRouterDispatcherMissingError';
  }
}

export class ReadRouter {
  private readonly classifier: IReadIntentClassifier;
  private readonly preset: ReadRouterPreset;
  private readonly routingTable: ReadRoutingTable;
  private readonly budgetPerReadUsd: number | null;
  private readonly budgetMode: ReadBudgetMode;
  private readonly strategyCosts: Readonly<
    Record<ReadStrategyId, ReadStrategyCostPoint>
  >;
  private readonly defaultUseFewShotPrompt: boolean;
  private readonly dispatcher: IReadDispatcher<unknown, unknown> | null;

  constructor(options: ReadRouterOptions) {
    this.classifier = options.classifier;
    this.preset = options.preset ?? 'precise-fact';
    this.dispatcher = options.dispatcher ?? null;

    const baseTable = options.routingTable ?? PRESET_READ_TABLES[this.preset];
    if (options.mapping) {
      const patched: Record<ReadIntent, ReadStrategyId> = {
        ...baseTable.defaultMapping,
      };
      for (const key of Object.keys(options.mapping) as ReadIntent[]) {
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

    this.budgetPerReadUsd = options.budget?.perReadUsd ?? null;
    this.budgetMode = options.budget?.mode ?? 'cheapest-fallback';
    this.strategyCosts = options.strategyCosts ?? DEFAULT_READ_COSTS;
    this.defaultUseFewShotPrompt = options.useFewShotPrompt ?? false;
  }

  async decide(
    query: string,
    evidence: readonly string[],
    options?: ReadRouterDecideOptions,
  ): Promise<ReadRouterDecision> {
    let classifier: ReadIntentClassifierResult;
    if (options?.manualIntent) {
      classifier = {
        intent: options.manualIntent,
        tokensIn: 0,
        tokensOut: 0,
        model: 'manual',
      };
    } else {
      const useFewShot =
        options?.useFewShotPrompt ?? this.defaultUseFewShotPrompt;
      classifier = await this.classifier.classify(
        query,
        evidence,
        useFewShot ? { useFewShotPrompt: true } : undefined,
      );
    }

    const routing = selectReadStrategy({
      predictedIntent: classifier.intent,
      groundTruthIntent: options?.groundTruthIntent ?? null,
      config: {
        table: this.routingTable,
        budgetPerReadUsd: this.budgetPerReadUsd,
        budgetMode: this.budgetMode,
        strategyCosts: this.strategyCosts,
      },
    });

    return { classifier, routing };
  }

  async decideAndDispatch<TOutcome, TPayload = undefined>(
    query: string,
    evidence: readonly string[],
    dispatchPayload?: TPayload,
    options?: ReadRouterDecideOptions,
  ): Promise<ReadRouterDispatchedResult<TOutcome>> {
    if (!this.dispatcher) {
      throw new ReadRouterDispatcherMissingError();
    }

    const decision = await this.decide(query, evidence, options);
    const dispatched = (await this.dispatcher.dispatch({
      strategy: decision.routing.chosenStrategy,
      query,
      evidence,
      payload: dispatchPayload as unknown,
    })) as ReadDispatchResult<TOutcome>;

    return {
      decision,
      outcome: dispatched.outcome,
      strategy: dispatched.strategy,
    };
  }
}
