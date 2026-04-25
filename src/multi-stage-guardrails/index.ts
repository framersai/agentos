/**
 * AgentOS MultiStageGuardrails Module
 *
 * Composition primitive that wires the LLM-as-judge stages of the
 * agentos pipeline into one orchestrator. Each stage is independent and
 * optional — wire only the stages you need, or compose all four.
 *
 * **The four stages:**
 *
 * ```
 *   Content                 Query                    Query
 *      │                      │                       │
 *      ▼                      ▼                       ▼
 *  ┌─────────┐          ┌─────────────┐         ┌─────────────┐
 *  │ Ingest  │          │   Recall    │         │    Read     │
 *  │ Stage   │          │   Stage     │         │   Stage     │
 *  │ (input) │          │  (memory)   │         │  (reader)   │
 *  └─────────┘          └─────────────┘         └─────────────┘
 *      │                      │                       │
 *      ▼                      ▼                       ▼
 *  Memory state          Retrieved traces         Final answer
 * ```
 *
 * Plus the existing output-stage `core/guardrails` and
 * `agentos-ext-grounding-guard` which validate the answer post-generation.
 *
 * **Why a composition primitive:** each individual router is independently
 * useful and ships with its own classifier + dispatcher + table machinery.
 * MultiStageGuardrails gives consumers a single object to coordinate the
 * stages without duplicating per-stage wiring. It does NOT add new
 * routing logic — it's a thin facade over the four primitives.
 *
 * The interfaces below ({@link IngestStage}, {@link RecallStage},
 * {@link ReadStage}) are deliberately minimal so consumers can wire any
 * implementation:
 *
 * - The shipping `IngestRouter` / `MemoryRouter` / `ReadRouter` classes
 *   each satisfy the corresponding stage interface via thin adapters
 *   (see `agentosStageAdapters` below).
 * - Custom implementations (rule-based, ML-driven, mock for tests) can
 *   satisfy the same interfaces and slot in.
 *
 * @module @framers/agentos/multi-stage-guardrails
 */

// ============================================================================
// Stage interfaces
// ============================================================================

/**
 * Generic decision metadata bundled with each stage's result. Stages
 * report enough information for downstream telemetry without leaking
 * stage-specific types into the orchestrator.
 */
export interface IngestStageResult {
  readonly writtenTraces: number;
  readonly strategy: string;
  readonly ingestRouterDecision: unknown;
}

export interface RecallStageResult<TTrace> {
  readonly traces: TTrace[];
  readonly backend: string;
  readonly memoryRouterDecision: unknown;
}

export interface ReadStageResult<TOutcome> {
  readonly outcome: TOutcome;
  readonly strategy: string;
  readonly readRouterDecision: unknown;
}

/**
 * Pluggable input-stage. Wrap an {@link IngestRouter} or any equivalent
 * implementation that turns content into stored traces.
 */
export interface IngestStage {
  ingest(content: string, payload?: unknown): Promise<IngestStageResult>;
}

/**
 * Pluggable recall-stage. Wrap a {@link MemoryRouter} or any equivalent
 * implementation that turns a query into retrieved traces.
 */
export interface RecallStage<TTrace> {
  recall(query: string, payload?: unknown): Promise<RecallStageResult<TTrace>>;
}

/**
 * Pluggable read-stage. Wrap a {@link ReadRouter} or any equivalent
 * implementation that turns a query+evidence pair into a final answer.
 */
export interface ReadStage<TTrace, TOutcome> {
  read(
    query: string,
    traces: TTrace[],
    payload?: unknown,
  ): Promise<ReadStageResult<TOutcome>>;
}

// ============================================================================
// Combined output for end-to-end flow
// ============================================================================

export interface RecallAndReadResult<TTrace, TOutcome> {
  readonly recallStage: RecallStageResult<TTrace>;
  readonly readStage: ReadStageResult<TOutcome>;
  readonly outcome: TOutcome;
}

// ============================================================================
// Constructor options
// ============================================================================

export interface MultiStageGuardrailsOptions<TTrace, TOutcome> {
  readonly ingest?: IngestStage;
  readonly recall?: RecallStage<TTrace>;
  readonly read?: ReadStage<TTrace, TOutcome>;
}

// ============================================================================
// Errors
// ============================================================================

export class MissingStageError extends Error {
  constructor(stage: 'IngestStage' | 'RecallStage' | 'ReadStage') {
    super(
      `MultiStageGuardrails: ${stage} is not configured. ` +
        `Pass it in options at construction.`,
    );
    this.name = 'MissingStageError';
  }
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Top-level pipeline composition. One instance per agent / endpoint;
 * reuse across requests.
 *
 * @example Full pipeline
 * ```ts
 * import { MultiStageGuardrails } from '@framers/agentos/multi-stage-guardrails';
 * import { ingestRouterAsStage } from '@framers/agentos/multi-stage-guardrails';
 *
 * const guardrails = new MultiStageGuardrails({
 *   ingest: ingestRouterAsStage(myIngestRouter),
 *   recall: memoryRouterAsStage(myMemoryRouter),
 *   read: readRouterAsStage(myReadRouter),
 * });
 *
 * await guardrails.ingest(newContent);
 * const { outcome } = await guardrails.recallAndRead("what's my latest job?");
 * ```
 */
export class MultiStageGuardrails<TTrace, TOutcome> {
  private readonly ingestStage: IngestStage | null;
  private readonly recallStage: RecallStage<TTrace> | null;
  private readonly readStage: ReadStage<TTrace, TOutcome> | null;

  constructor(options: MultiStageGuardrailsOptions<TTrace, TOutcome>) {
    this.ingestStage = options.ingest ?? null;
    this.recallStage = options.recall ?? null;
    this.readStage = options.read ?? null;
  }

  get hasIngestStage(): boolean {
    return this.ingestStage !== null;
  }
  get hasRecallStage(): boolean {
    return this.recallStage !== null;
  }
  get hasReadStage(): boolean {
    return this.readStage !== null;
  }

  async ingest(content: string, payload?: unknown): Promise<IngestStageResult> {
    if (!this.ingestStage) throw new MissingStageError('IngestStage');
    return this.ingestStage.ingest(content, payload);
  }

  async recall(
    query: string,
    payload?: unknown,
  ): Promise<RecallStageResult<TTrace>> {
    if (!this.recallStage) throw new MissingStageError('RecallStage');
    return this.recallStage.recall(query, payload);
  }

  async read(
    query: string,
    traces: TTrace[],
    payload?: unknown,
  ): Promise<ReadStageResult<TOutcome>> {
    if (!this.readStage) throw new MissingStageError('ReadStage');
    return this.readStage.read(query, traces, payload);
  }

  /**
   * Recall traces for the query, then run the reader on those traces.
   * Standard "ask a question, get an answer" path.
   */
  async recallAndRead(
    query: string,
    recallPayload?: unknown,
    readPayload?: unknown,
  ): Promise<RecallAndReadResult<TTrace, TOutcome>> {
    if (!this.recallStage) throw new MissingStageError('RecallStage');
    if (!this.readStage) throw new MissingStageError('ReadStage');

    const recallStage = await this.recallStage.recall(query, recallPayload);
    const readStage = await this.readStage.read(
      query,
      recallStage.traces,
      readPayload,
    );

    return {
      recallStage,
      readStage,
      outcome: readStage.outcome,
    };
  }
}

// ============================================================================
// Adapters: shipping routers → stage interfaces
// ============================================================================

/**
 * Wrap an {@link IngestRouter} as an {@link IngestStage}. The IngestRouter
 * must have been constructed with a dispatcher; otherwise the stage will
 * throw on every call.
 */
export function ingestRouterAsStage<TOutcome extends { writtenTraces?: number }>(
  router: {
    decideAndDispatch: (
      content: string,
      payload?: unknown,
    ) => Promise<{
      decision: { routing: { chosenStrategy: string } };
      outcome: TOutcome;
    }>;
  },
): IngestStage {
  return {
    async ingest(content: string, payload?: unknown): Promise<IngestStageResult> {
      const result = await router.decideAndDispatch(content, payload);
      return {
        writtenTraces: result.outcome.writtenTraces ?? 0,
        strategy: result.decision.routing.chosenStrategy,
        ingestRouterDecision: result.decision,
      };
    },
  };
}

/**
 * Wrap a {@link MemoryRouter} as a {@link RecallStage}. The MemoryRouter
 * must have been constructed with a dispatcher.
 */
export function memoryRouterAsStage<TTrace>(router: {
  decideAndDispatch: <T = TTrace>(
    query: string,
    payload?: unknown,
  ) => Promise<{
    decision: { routing: { chosenBackend: string } };
    traces: T[];
    backend: string;
  }>;
}): RecallStage<TTrace> {
  return {
    async recall(query: string, payload?: unknown): Promise<RecallStageResult<TTrace>> {
      const result = await router.decideAndDispatch<TTrace>(query, payload);
      return {
        traces: result.traces,
        backend: result.backend,
        memoryRouterDecision: result.decision,
      };
    },
  };
}

/**
 * Wrap a {@link ReadRouter} as a {@link ReadStage}. The ReadRouter must
 * have been constructed with a dispatcher.
 */
export function readRouterAsStage<TTrace extends { id?: string; text?: string }, TOutcome>(
  router: {
    decideAndDispatch: <T = TOutcome>(
      query: string,
      evidence: readonly string[],
      payload?: unknown,
    ) => Promise<{
      decision: { routing: { chosenStrategy: string } };
      outcome: T;
    }>;
  },
  /**
   * Optional adapter to turn a TTrace into a string for the read-router's
   * evidence array. Default: serialize `{id, text}`-shaped traces by
   * concatenating text fields.
   */
  traceToString?: (trace: TTrace) => string,
): ReadStage<TTrace, TOutcome> {
  const toString =
    traceToString ??
    ((t: TTrace): string => (t as { text?: string }).text ?? JSON.stringify(t));
  return {
    async read(
      query: string,
      traces: TTrace[],
      payload?: unknown,
    ): Promise<ReadStageResult<TOutcome>> {
      const evidenceStrings = traces.map(toString);
      const result = await router.decideAndDispatch<TOutcome>(
        query,
        evidenceStrings,
        payload,
      );
      return {
        outcome: result.outcome,
        strategy: result.decision.routing.chosenStrategy,
        readRouterDecision: result.decision,
      };
    },
  };
}
