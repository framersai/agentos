/**
 * @file agency.ts
 * Multi-agent agency factory for the AgentOS high-level API.
 *
 * `agency()` accepts an {@link AgencyOptions} configuration, compiles the
 * requested orchestration strategy, wires resource controls, and returns a
 * single {@link Agent}-compatible interface that coordinates all sub-agents.
 *
 * The returned instance exposes `generate`, `stream`, `session`, `usage`, and
 * `close` — identical surface to a single `agent()` instance — so callers can
 * swap between them transparently.
 *
 * @example
 * ```ts
 * import { agency, hitl } from '@framers/agentos';
 *
 * const myAgency = agency({
 *   model: 'openai:gpt-4o',
 *   strategy: 'sequential',
 *   agents: {
 *     researcher: { instructions: 'Find relevant information.' },
 *     writer:     { instructions: 'Write a clear summary.' },
 *   },
 *   controls: { maxTotalTokens: 50_000, onLimitReached: 'warn' },
 *   hitl: { approvals: { beforeTool: ['delete'] }, handler: hitl.autoApprove() },
 * });
 *
 * const result = await myAgency.generate('Summarise recent AI research.');
 * console.log(result.text);
 * ```
 */

import { compileStrategy, isAgent } from './strategies/index.js';
import type {
  AgencyOptions,
  Agent,
  BaseAgentConfig,
  AgencyConfigError as AgencyConfigErrorType,
  CompiledStrategy,
  ResourceControls,
} from './types.js';
import { AgencyConfigError } from './types.js';

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a multi-agent agency that coordinates a named roster of sub-agents
 * using the specified orchestration strategy.
 *
 * The agency validates configuration immediately and throws an
 * {@link AgencyConfigError} on any structural problem so issues surface at
 * wiring time rather than the first call.
 *
 * @param opts - Full agency configuration including the `agents` roster, optional
 *   `strategy`, `controls`, `hitl`, and `observability` settings.
 * @returns An {@link Agent} instance whose `generate` / `stream` / `session` methods
 *   invoke the compiled strategy over the configured sub-agents.
 * @throws {AgencyConfigError} When the configuration is structurally invalid
 *   (e.g. no agents defined, emergent enabled without hierarchical strategy,
 *   HITL approvals configured without a handler, parallel/debate without a
 *   synthesis model).
 */
export function agency(opts: AgencyOptions): Agent {
  // 1. Validate options — throw early on bad configuration.
  validateAgencyOptions(opts);

  // 2. Compile the orchestration strategy into an executable CompiledStrategy.
  //    When `adaptive` is true the strategy dispatcher wraps the chosen strategy
  //    with an implicit hierarchical manager.
  const chosenStrategy = opts.adaptive
    ? 'hierarchical'
    : (opts.strategy ?? 'sequential');

  const strategy: CompiledStrategy = compileStrategy(
    chosenStrategy,
    opts.agents,
    opts,
  );

  // 3. Extract resource controls (may be undefined).
  const controls: ResourceControls | undefined = opts.controls;

  // 4. In-memory session store keyed by session ID.
  const sessions = new Map<string, AgencySession>();

  // ---------------------------------------------------------------------------
  // Shared execute wrapper — applies resource limit checks and fires callbacks.
  // ---------------------------------------------------------------------------

  /**
   * Execute the compiled strategy for a given prompt, then check resource
   * limits and fire lifecycle callbacks.
   *
   * @param prompt - User-facing prompt text.
   * @param execOpts - Optional per-call overrides forwarded to the strategy.
   * @returns The raw strategy result object (includes `text`, `agentCalls`, `usage`).
   */
  const wrappedExecute = async (prompt: string, execOpts?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const start = Date.now();

    // Execute the compiled multi-agent strategy.
    const result = (await strategy.execute(prompt, execOpts)) as Record<string, unknown>;
    const elapsedMs = Date.now() - start;

    // Check resource limits and fire callbacks / throw if configured.
    if (controls) {
      checkLimits(controls, result, elapsedMs, opts.on);
    }

    // Fire the agentEnd callback with the agency as the pseudo-agent name.
    opts.on?.agentEnd?.({
      agent: opts.name ?? '__agency__',
      output: (result.text as string) ?? '',
      durationMs: elapsedMs,
      timestamp: Date.now(),
    });

    return result;
  };

  // ---------------------------------------------------------------------------
  // Returned Agent interface
  // ---------------------------------------------------------------------------

  return {
    /**
     * Runs the agency's strategy for the given prompt and returns the final
     * aggregated result (non-streaming).
     *
     * @param prompt - User prompt text.
     * @param opts - Optional per-call overrides.
     * @returns The aggregated result including `text`, `agentCalls`, and `usage`.
     */
    async generate(prompt: string, generateOpts?: Record<string, unknown>): Promise<unknown> {
      return wrappedExecute(prompt, generateOpts);
    },

    /**
     * Streams the strategy execution.  For strategies that do not natively
     * support token-by-token streaming, the full result is buffered and emitted
     * as a single text chunk.
     *
     * @param prompt - User prompt text.
     * @param streamOpts - Optional per-call overrides.
     * @returns An object with `textStream`, `fullStream`, and awaitable `text`/`usage` promises.
     */
    stream(prompt: string, streamOpts?: Record<string, unknown>): unknown {
      return strategy.stream(prompt, streamOpts);
    },

    /**
     * Returns (or creates) a named conversation session backed by the agency's
     * strategy.  Each session maintains its own ordered message history.
     *
     * @param id - Optional stable session ID; auto-generated via `crypto.randomUUID()`
     *   when omitted.
     * @returns The session object for the given ID.
     */
    session(id?: string): unknown {
      const sessionId = id ?? crypto.randomUUID();
      if (!sessions.has(sessionId)) {
        /** Per-session message history as simple role/content pairs. */
        const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        const sessionObj: AgencySession = {
          id: sessionId,

          /**
           * Sends a user message through the agency strategy and appends both
           * turns to session history.
           *
           * @param text - User message text.
           * @returns The aggregated strategy result.
           */
          async send(text: string): Promise<unknown> {
            history.push({ role: 'user', content: text });
            const result = await wrappedExecute(text);
            history.push({ role: 'assistant', content: (result.text as string) ?? '' });
            return result;
          },

          /**
           * Streams a user message through the agency strategy.
           * History is not automatically updated for streaming calls in v1.
           *
           * @param text - User message text.
           * @returns A streaming result compatible with `StreamTextResult`.
           */
          stream(text: string): unknown {
            return strategy.stream(text);
          },

          /** Returns a snapshot of the session's conversation history. */
          messages(): Array<{ role: 'user' | 'assistant'; content: string }> {
            return [...history];
          },

          /**
           * Returns stub usage totals for this session.
           * Real per-session accounting requires a usage ledger — see `AgentOptions.usageLedger`.
           */
          async usage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
            return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
          },

          /** Clears all messages from this session's history. */
          clear(): void {
            history.length = 0;
          },
        };

        sessions.set(sessionId, sessionObj);
      }

      return sessions.get(sessionId);
    },

    /**
     * Returns stub cumulative usage totals for the agency.
     * Real accounting requires a usage ledger — see `AgentOptions.usageLedger`.
     */
    async usage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    },

    /**
     * Tears down all sessions and closes any pre-built `Agent` instances passed
     * in `opts.agents`.
     */
    async close(): Promise<void> {
      sessions.clear();
      // Gracefully close any pre-built Agent instances in the roster.
      for (const agentOrConfig of Object.values(opts.agents)) {
        if (isAgent(agentOrConfig)) {
          await agentOrConfig.close?.();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal session shape (not exported — callers receive `unknown`)
// ---------------------------------------------------------------------------

/** Internal shape for per-agency session state. */
interface AgencySession {
  readonly id: string;
  send(text: string): Promise<unknown>;
  stream(text: string): unknown;
  messages(): Array<{ role: 'user' | 'assistant'; content: string }>;
  usage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>;
  clear(): void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates {@link AgencyOptions} and throws {@link AgencyConfigError} when a
 * structural problem is detected.
 *
 * Checks performed:
 * - At least one agent must be defined in `opts.agents`.
 * - `emergent.enabled` requires `strategy === "hierarchical"` or `adaptive: true`.
 * - HITL approvals require a `handler` to be configured.
 * - `parallel` and `debate` strategies require an agency-level `model` or `provider`
 *   for their synthesis step.
 *
 * @param opts - The agency options to validate.
 * @throws {AgencyConfigError} On the first validation failure encountered.
 */
function validateAgencyOptions(opts: AgencyOptions): void {
  if (!opts.agents || Object.keys(opts.agents).length === 0) {
    throw new AgencyConfigError('agency() requires at least one agent in the agents roster');
  }

  if (opts.emergent?.enabled && opts.strategy !== 'hierarchical' && !opts.adaptive) {
    throw new AgencyConfigError(
      'emergent.enabled requires strategy "hierarchical" or adaptive: true',
    );
  }

  // If any HITL approval trigger is set, a handler must be provided.
  const approvals = opts.hitl?.approvals;
  const hasApprovalTrigger =
    approvals &&
    (
      (Array.isArray(approvals.beforeTool) && approvals.beforeTool.length > 0) ||
      (Array.isArray(approvals.beforeAgent) && approvals.beforeAgent.length > 0) ||
      approvals.beforeEmergent === true ||
      approvals.beforeReturn === true ||
      approvals.beforeStrategyOverride === true
    );

  if (hasApprovalTrigger && !opts.hitl?.handler) {
    throw new AgencyConfigError('HITL approvals configured but no handler provided');
  }

  if (opts.strategy === 'parallel' && !opts.model && !opts.provider) {
    throw new AgencyConfigError(
      'Parallel strategy requires an agency-level model or provider for synthesis',
    );
  }

  if (opts.strategy === 'debate' && !opts.model && !opts.provider) {
    throw new AgencyConfigError(
      'Debate strategy requires an agency-level model or provider for synthesis',
    );
  }
}

// ---------------------------------------------------------------------------
// Resource limit enforcement
// ---------------------------------------------------------------------------

/**
 * Checks whether the strategy result has breached any configured
 * {@link ResourceControls} limits.  Fires `callbacks.limitReached` when a
 * breach is detected, or throws {@link AgencyConfigError} when
 * `controls.onLimitReached` is `"error"`.
 *
 * @param controls - Active resource limit configuration.
 * @param result - Raw result object returned by the compiled strategy.
 * @param elapsedMs - Wall-clock milliseconds elapsed during execution.
 * @param callbacks - Optional callback map to fire `limitReached` events on.
 */
function checkLimits(
  controls: ResourceControls,
  result: Record<string, unknown>,
  elapsedMs: number,
  callbacks?: AgencyOptions['on'],
): void {
  const usage = result.usage as { totalTokens?: number } | undefined;
  const totalTokens = usage?.totalTokens ?? 0;
  const agentCalls = result.agentCalls as unknown[] | undefined;
  const callCount = agentCalls?.length ?? 0;

  // Token limit check.
  if (controls.maxTotalTokens !== undefined && totalTokens > controls.maxTotalTokens) {
    if (controls.onLimitReached === 'error') {
      throw new AgencyConfigError(
        `Token limit exceeded: ${totalTokens} > ${controls.maxTotalTokens}`,
      );
    }
    callbacks?.limitReached?.({
      metric: 'maxTotalTokens',
      value: totalTokens,
      limit: controls.maxTotalTokens,
      timestamp: Date.now(),
    });
  }

  // Duration limit check.
  if (controls.maxDurationMs !== undefined && elapsedMs > controls.maxDurationMs) {
    if (controls.onLimitReached === 'error') {
      throw new AgencyConfigError(
        `Duration limit exceeded: ${elapsedMs}ms > ${controls.maxDurationMs}ms`,
      );
    }
    callbacks?.limitReached?.({
      metric: 'maxDurationMs',
      value: elapsedMs,
      limit: controls.maxDurationMs,
      timestamp: Date.now(),
    });
  }

  // Agent call count limit check.
  if (controls.maxAgentCalls !== undefined && callCount > controls.maxAgentCalls) {
    if (controls.onLimitReached === 'error') {
      throw new AgencyConfigError(
        `Agent call limit exceeded: ${callCount} > ${controls.maxAgentCalls}`,
      );
    }
    callbacks?.limitReached?.({
      metric: 'maxAgentCalls',
      value: callCount,
      limit: controls.maxAgentCalls,
      timestamp: Date.now(),
    });
  }
}
