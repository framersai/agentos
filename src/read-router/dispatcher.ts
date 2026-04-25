/**
 * @file dispatcher.ts
 * @description Per-strategy execution layer for ReadRouter. Same
 * registry-of-functions pattern as ingest-router and memory-router.
 *
 * @module @framers/agentos/read-router/dispatcher
 */

import type { ReadStrategyId } from './routing-tables.js';

export type ReadStrategyExecutor<TOutcome, TPayload = undefined> = (
  query: string,
  evidence: readonly string[],
  payload: TPayload,
) => Promise<TOutcome>;

export interface ReadDispatchArgs<TPayload = undefined> {
  readonly strategy: ReadStrategyId;
  readonly query: string;
  readonly evidence: readonly string[];
  readonly payload?: TPayload;
}

export interface ReadDispatchResult<TOutcome> {
  readonly outcome: TOutcome;
  readonly strategy: ReadStrategyId;
}

export interface IReadDispatcher<TOutcome = unknown, TPayload = unknown> {
  dispatch(
    args: ReadDispatchArgs<TPayload>,
  ): Promise<ReadDispatchResult<TOutcome>>;
}

export class UnsupportedReadStrategyError extends Error {
  constructor(public readonly strategy: ReadStrategyId) {
    super(
      `ReadDispatcher: strategy '${strategy}' is not registered. ` +
        `Supply an executor for this strategy at construction.`,
    );
    this.name = 'UnsupportedReadStrategyError';
  }
}

export type ReadStrategyRegistry<TOutcome, TPayload> = Partial<
  Record<ReadStrategyId, ReadStrategyExecutor<TOutcome, TPayload>>
>;

export class FunctionReadDispatcher<TOutcome, TPayload = undefined>
  implements IReadDispatcher<TOutcome, TPayload>
{
  private readonly registry: ReadStrategyRegistry<TOutcome, TPayload>;

  constructor(registry: ReadStrategyRegistry<TOutcome, TPayload>) {
    this.registry = registry;
  }

  async dispatch(
    args: ReadDispatchArgs<TPayload>,
  ): Promise<ReadDispatchResult<TOutcome>> {
    const exec = this.registry[args.strategy];
    if (!exec) {
      throw new UnsupportedReadStrategyError(args.strategy);
    }
    const outcome = await exec(
      args.query,
      args.evidence,
      args.payload as TPayload,
    );
    return { outcome, strategy: args.strategy };
  }
}
