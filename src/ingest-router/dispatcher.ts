/**
 * @file dispatcher.ts
 * @description Backend-execution layer for {@link IngestRouter}.
 *
 * Same routing-table-of-functions pattern as memory-router's
 * {@link FunctionMemoryDispatcher}. Caller registers per-strategy
 * executors at construction; dispatcher picks the right one per call.
 *
 * @module @framers/agentos/ingest-router/dispatcher
 */

import type { IngestStrategyId } from './routing-tables.js';

export type IngestStrategyExecutor<TOutcome, TPayload = undefined> = (
  content: string,
  payload: TPayload,
) => Promise<TOutcome>;

export interface IngestDispatchArgs<TPayload = undefined> {
  readonly strategy: IngestStrategyId;
  readonly content: string;
  readonly payload?: TPayload;
}

export interface IngestDispatchResult<TOutcome> {
  readonly outcome: TOutcome;
  readonly strategy: IngestStrategyId;
}

export interface IIngestDispatcher<TOutcome = unknown, TPayload = unknown> {
  dispatch(
    args: IngestDispatchArgs<TPayload>,
  ): Promise<IngestDispatchResult<TOutcome>>;
}

export class UnsupportedIngestStrategyError extends Error {
  constructor(public readonly strategy: IngestStrategyId) {
    super(
      `IngestDispatcher: strategy '${strategy}' is not registered. ` +
        `Supply an executor for this strategy at construction.`,
    );
    this.name = 'UnsupportedIngestStrategyError';
  }
}

export type IngestStrategyRegistry<TOutcome, TPayload> = Partial<
  Record<IngestStrategyId, IngestStrategyExecutor<TOutcome, TPayload>>
>;

export class FunctionIngestDispatcher<TOutcome, TPayload = undefined>
  implements IIngestDispatcher<TOutcome, TPayload>
{
  private readonly registry: IngestStrategyRegistry<TOutcome, TPayload>;

  constructor(registry: IngestStrategyRegistry<TOutcome, TPayload>) {
    this.registry = registry;
  }

  async dispatch(
    args: IngestDispatchArgs<TPayload>,
  ): Promise<IngestDispatchResult<TOutcome>> {
    const exec = this.registry[args.strategy];
    if (!exec) {
      throw new UnsupportedIngestStrategyError(args.strategy);
    }
    const outcome = await exec(args.content, args.payload as TPayload);
    return { outcome, strategy: args.strategy };
  }
}
