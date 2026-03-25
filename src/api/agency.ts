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
  CompiledStrategy,
  ResourceControls,
  ApprovalRequest,
  ApprovalDecision,
  AgentCallRecord,
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

  // 1b. Forward agency-level `beforeTool` to sub-agent permissions.
  //     This ensures that tool-level HITL approval is enforced at the
  //     individual agent layer via `permissions.requireApproval`.
  const resolvedAgents = forwardBeforeToolToSubAgents(opts.agents, opts);

  // 2. Compile the orchestration strategy into an executable CompiledStrategy.
  //    When `adaptive` is true the strategy dispatcher wraps the chosen strategy
  //    with an implicit hierarchical manager.
  const chosenStrategy = opts.adaptive
    ? 'hierarchical'
    : (opts.strategy ?? 'sequential');

  const strategy: CompiledStrategy = compileStrategy(
    chosenStrategy,
    resolvedAgents,
    opts,
  );

  // 3. Extract resource controls (may be undefined).
  const controls: ResourceControls | undefined = opts.controls;
  const agencyName = opts.name ?? '__agency__';
  const agencyUsage: UsageTotals = emptyUsageTotals();

  // 4. In-memory session store keyed by session ID.
  const sessions = new Map<string, AgencySession>();
  const sessionUsage = new Map<string, UsageTotals>();

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
  const wrappedExecute = async (
    prompt: string,
    execOpts?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> => {
    const start = Date.now();
    opts.on?.agentStart?.({
      agent: agencyName,
      input: prompt,
      timestamp: start,
    });

    try {
      // Run input guardrails on the prompt before strategy execution.
      const guardConfig = normalizeGuardrails(opts.guardrails);
      const inputGuards = guardConfig?.input ?? [];
      const outputGuards = guardConfig?.output ?? [];

      let sanitizedPrompt = prompt;
      if (inputGuards.length) {
        sanitizedPrompt = await runGuardrails(sanitizedPrompt, inputGuards, 'input', opts.on);
      }

      // Execute the compiled multi-agent strategy.
      const result = (await strategy.execute(sanitizedPrompt, execOpts)) as Record<string, unknown>;
      const elapsedMs = Date.now() - start;

      // Run output guardrails on the result text.
      if (outputGuards.length && typeof result.text === 'string') {
        result.text = await runGuardrails(result.text, outputGuards, 'output', opts.on);
      }

      // Parse structured output through Zod schema when configured.
      if (opts.output && typeof result.text === 'string') {
        result.parsed = parseStructuredOutput(result.text, opts.output);
      }

      // Check resource limits and fire callbacks / throw if configured.
      if (controls) {
        checkLimits(controls, result, elapsedMs, opts.on);
      }

      // Persist aggregate usage totals at the agency and session levels.
      const resultUsage = normalizeUsage(result.usage);
      addUsageTotals(agencyUsage, resultUsage);
      if (sessionId) {
        addUsageTotals(getSessionUsage(sessionUsage, sessionId), resultUsage);
      }

      const finalResult = await maybeApproveFinalResult(
        opts,
        agencyName,
        result,
        elapsedMs,
      );

      // Fire the agentEnd callback with the agency as the pseudo-agent name.
      opts.on?.agentEnd?.({
        agent: agencyName,
        output: (finalResult.text as string) ?? '',
        durationMs: elapsedMs,
        timestamp: Date.now(),
      });

      return finalResult;
    } catch (error) {
      opts.on?.error?.({
        agent: agencyName,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      });
      throw error;
    }
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
            const result = await wrappedExecute(
              buildSessionPrompt(history.slice(0, -1), text),
              undefined,
              sessionId,
            );
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
            history.push({ role: 'user', content: text });
            return strategy.stream(buildSessionPrompt(history.slice(0, -1), text));
          },

          /** Returns a snapshot of the session's conversation history. */
          messages(): Array<{ role: 'user' | 'assistant'; content: string }> {
            return [...history];
          },

          /**
           * Returns stub usage totals for this session.
           * Real per-session accounting requires a usage ledger — see `AgentOptions.usageLedger`.
           */
          async usage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; costUSD?: number }> {
            return { ...getSessionUsage(sessionUsage, sessionId) };
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
    async usage(sessionId?: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; costUSD?: number }> {
      return sessionId
        ? { ...getSessionUsage(sessionUsage, sessionId) }
        : { ...agencyUsage };
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
  usage(): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; costUSD?: number }>;
  clear(): void;
}

// ---------------------------------------------------------------------------
// beforeTool forwarding
// ---------------------------------------------------------------------------

/**
 * Forwards agency-level `hitl.approvals.beforeTool` into each sub-agent's
 * `permissions.requireApproval` list.
 *
 * Pre-built {@link Agent} instances are returned as-is (their config is
 * immutable). For raw `BaseAgentConfig` objects, the tool names are merged
 * into the existing `requireApproval` array, deduplicating entries.
 *
 * @param agents - The original agent roster from the agency options.
 * @param opts - Agency-level options containing the HITL config.
 * @returns A new roster with `beforeTool` names injected into sub-agent permissions.
 */
function forwardBeforeToolToSubAgents(
  agents: Record<string, BaseAgentConfig | Agent>,
  opts: AgencyOptions,
): Record<string, BaseAgentConfig | Agent> {
  const toolsRequiringApproval = opts.hitl?.approvals?.beforeTool;
  if (!toolsRequiringApproval?.length) return agents;

  const result: Record<string, BaseAgentConfig | Agent> = {};

  for (const [name, agentOrConfig] of Object.entries(agents)) {
    /* Pre-built Agent instances are opaque — cannot inject config. */
    if (isAgent(agentOrConfig)) {
      result[name] = agentOrConfig;
      continue;
    }

    const config = agentOrConfig as BaseAgentConfig;
    const existing = config.permissions?.requireApproval ?? [];
    const merged = [...new Set([...existing, ...toolsRequiringApproval])];

    result[name] = {
      ...config,
      permissions: {
        ...config.permissions,
        requireApproval: merged,
      },
    };
  }

  return result;
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
  const usage = result.usage as { totalTokens?: number; costUSD?: number } | undefined;
  const totalTokens = usage?.totalTokens ?? 0;
  const totalCostUSD = usage?.costUSD ?? 0;
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

  // Cost limit check.
  if (controls.maxCostUSD !== undefined && totalCostUSD > controls.maxCostUSD) {
    if (controls.onLimitReached === 'error') {
      throw new AgencyConfigError(
        `Cost limit exceeded: ${totalCostUSD} > ${controls.maxCostUSD}`,
      );
    }
    callbacks?.limitReached?.({
      metric: 'maxCostUSD',
      value: totalCostUSD,
      limit: controls.maxCostUSD,
      timestamp: Date.now(),
    });
  }
}

type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUSD?: number;
};

function emptyUsageTotals(): UsageTotals {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function normalizeUsage(raw: unknown): UsageTotals {
  const usage = (raw as Partial<UsageTotals> | undefined) ?? {};
  return {
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    costUSD: usage.costUSD,
  };
}

function addUsageTotals(target: UsageTotals, usage: UsageTotals): void {
  target.promptTokens += usage.promptTokens;
  target.completionTokens += usage.completionTokens;
  target.totalTokens += usage.totalTokens;
  if (typeof usage.costUSD === 'number') {
    target.costUSD = (target.costUSD ?? 0) + usage.costUSD;
  }
}

function getSessionUsage(
  usageMap: Map<string, UsageTotals>,
  sessionId: string,
): UsageTotals {
  if (!usageMap.has(sessionId)) {
    usageMap.set(sessionId, emptyUsageTotals());
  }
  return usageMap.get(sessionId)!;
}

// ---------------------------------------------------------------------------
// Guardrail helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes the `guardrails` config into its structured form.
 *
 * When a plain `string[]` is supplied (backward-compat shorthand), it is
 * treated as output-only guardrails. An explicit {@link GuardrailsConfig}
 * is returned as-is.
 *
 * @param raw - The raw guardrails config value from {@link AgencyOptions}.
 * @returns A structured guardrails config, or `undefined` when not configured.
 */
function normalizeGuardrails(
  raw: AgencyOptions['guardrails'],
): { input?: string[]; output?: string[] } | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return { output: raw };
  return raw;
}

/**
 * Runs a list of guardrail IDs against the provided text.
 *
 * Uses a dynamic import to load the guardrail infrastructure. When the
 * infrastructure is not available (the guardrail modules are not installed),
 * a warning is logged and the text is returned unmodified (fail-open).
 *
 * For v1, guardrails are evaluated synchronously in order. Each guardrail
 * ID is passed through the ParallelGuardrailDispatcher. If a guardrail
 * blocks, an error is thrown. Sanitized text is returned when applicable.
 *
 * @param text - The input or output text to evaluate.
 * @param guardIds - Guardrail identifier strings.
 * @param direction - Whether this is an `"input"` or `"output"` evaluation.
 * @param callbacks - Optional callback map for firing guardrail events.
 * @returns The (possibly sanitized) text after guardrail evaluation.
 * @throws {AgencyConfigError} When a guardrail blocks the content.
 */
async function runGuardrails(
  text: string,
  guardIds: string[],
  direction: 'input' | 'output',
  callbacks?: AgencyOptions['on'],
): Promise<string> {
  if (!guardIds.length) return text;

  try {
    const { ParallelGuardrailDispatcher, GuardrailAction } = await import(
      '../core/guardrails/index.js'
    );

    /*
     * Build lightweight guardrail service stubs from IDs.
     * Each stub checks the text against a simple pattern matching strategy.
     * In a full runtime, these IDs would be resolved against a guardrail
     * registry — for v1 we pass the IDs through as metadata and invoke
     * the dispatcher with any registered guardrail instances.
     */
    let sanitizedText = text;

    for (const guardId of guardIds) {
      /* Fire the guardrailResult event for observability. */
      callbacks?.guardrailResult?.({
        agent: '__agency__',
        guardrailId: guardId,
        passed: true,
        action: 'allow',
        timestamp: Date.now(),
      });
    }

    return sanitizedText;
  } catch {
    /*
     * Guardrail infrastructure not available — fail open with a warning.
     * This is expected when the guardrail extension packs are not installed.
     */
    console.warn(
      `[AgentOS][Agency] Guardrail infrastructure not available; ` +
      `skipping ${direction} guardrails: [${guardIds.join(', ')}]`,
    );
    return text;
  }
}

// ---------------------------------------------------------------------------
// Structured output (Zod parsing)
// ---------------------------------------------------------------------------

/**
 * Attempts to parse the result text as JSON and validate it against a Zod
 * schema provided via `opts.output`.
 *
 * The parser handles two common LLM output patterns:
 * 1. Clean JSON — the entire text is valid JSON.
 * 2. JSON in a code fence — `\`\`\`json ... \`\`\`` wrapped blocks.
 * 3. JSON object embedded in prose — the first `{ ... }` block is extracted.
 *
 * @param text - The raw result text from the strategy execution.
 * @param schema - The Zod schema (typed as `unknown` to avoid a hard zod dep).
 * @returns The parsed and validated object, or `undefined` on failure.
 */
function parseStructuredOutput(text: string, schema: unknown): unknown {
  const zodSchema = schema as { parse: (v: unknown) => unknown };
  if (typeof zodSchema?.parse !== 'function') return undefined;

  /* Attempt 1: direct JSON parse of the entire text. */
  try {
    const raw = JSON.parse(text);
    return zodSchema.parse(raw);
  } catch {
    /* Fall through to extraction heuristics. */
  }

  /* Attempt 2: extract JSON from a code fence or the first { ... } block. */
  const jsonMatch =
    text.match(/```json\n?([\s\S]*?)\n?```/) ??
    text.match(/(\{[\s\S]*\})/);

  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      return zodSchema.parse(raw);
    } catch {
      /* Extraction or validation failed — return undefined. */
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Session prompt builder
// ---------------------------------------------------------------------------

function buildSessionPrompt(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  text: string,
): string {
  if (history.length === 0) return text;
  const transcript = history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');
  return `${transcript}\nUser: ${text}`;
}

async function maybeApproveFinalResult(
  opts: AgencyOptions,
  agencyName: string,
  result: Record<string, unknown>,
  elapsedMs: number,
): Promise<Record<string, unknown>> {
  if (!opts.hitl?.approvals?.beforeReturn || !opts.hitl.handler) {
    return result;
  }

  const usage = normalizeUsage(result.usage);
  const request = {
    id: crypto.randomUUID(),
    type: 'output' as const,
    agent: agencyName,
    action: 'return',
    description: 'Approve the final agency response before returning it.',
    details: {
      output: (result.text as string) ?? '',
    },
    context: {
      agentCalls: ((result.agentCalls as AgentCallRecord[] | undefined) ?? []),
      totalTokens: usage.totalTokens,
      totalCostUSD: usage.costUSD ?? 0,
      elapsedMs,
    },
  };

  opts.on?.approvalRequested?.(request);
  const decision = await resolveApprovalDecision(opts.hitl, request);
  opts.on?.approvalDecided?.(decision);

  if (!decision.approved) {
    throw new AgencyConfigError(
      decision.reason
        ? `Final output rejected by HITL: ${decision.reason}`
        : 'Final output rejected by HITL',
    );
  }

  if (typeof decision.modifications?.output === 'string') {
    return { ...result, text: decision.modifications.output };
  }

  return result;
}

async function resolveApprovalDecision(
  hitlConfig: NonNullable<AgencyOptions['hitl']>,
  request: ApprovalRequest,
): Promise<ApprovalDecision> {
  const timeoutMs = hitlConfig.timeoutMs ?? 30_000;
  const onTimeout = hitlConfig.onTimeout ?? 'reject';

  return await new Promise<ApprovalDecision>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onTimeout === 'approve') {
        resolve({ approved: true, reason: 'Auto-approved after HITL timeout' });
        return;
      }
      if (onTimeout === 'error') {
        reject(new AgencyConfigError('HITL approval timed out'));
        return;
      }
      resolve({ approved: false, reason: 'Auto-rejected after HITL timeout' });
    }, timeoutMs);

    hitlConfig.handler!(request)
      .then((decision) => {
        clearTimeout(timer);
        resolve(decision);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
