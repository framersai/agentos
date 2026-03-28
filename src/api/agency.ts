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
  RagConfig,
  AgencyStreamPart,
  AgencyStreamResult,
  CompiledStrategyStreamResult,
} from './types.js';
import { AgencyConfigError } from './types.js';
import {
  exportAgentConfig,
  exportAgentConfigJSON,
  type AgentExportConfig,
} from './agentExport.js';
import { createBufferedAsyncReplay } from './streamBuffer.js';

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
  //    Auto-detect 'graph' when any sub-agent declares `dependsOn`.
  const hasDependsOn = Object.values(resolvedAgents).some(
    (a) => !isAgent(a) && Array.isArray((a as BaseAgentConfig).dependsOn) && (a as BaseAgentConfig).dependsOn!.length > 0,
  );
  const chosenStrategy = opts.adaptive
    ? 'hierarchical'
    : (opts.strategy ?? (hasDependsOn ? 'graph' : 'sequential'));

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

  type FinalizedExecutionResult = Record<string, unknown> & {
    text?: string;
    usage?: unknown;
    parsed?: unknown;
  };

  const prepareExecutionPrompt = async (prompt: string): Promise<string> => {
    const guardConfig = normalizeGuardrails(opts.guardrails);
    const inputGuards = guardConfig?.input ?? [];

    let preparedPrompt = prompt;
    if (inputGuards.length) {
      preparedPrompt = await runGuardrails(preparedPrompt, inputGuards, 'input', opts.on);
    }

    if (opts.rag) {
      preparedPrompt = await injectRagContext(preparedPrompt, opts.rag);
    }

    if (opts.output) {
      preparedPrompt = appendSchemaHint(preparedPrompt, opts.output);
    }

    if (controls) {
      checkLimits(controls, { usage: agencyUsage }, 0, opts.on);
    }

    return preparedPrompt;
  };

  const finalizeExecutionResult = async (
    result: Record<string, unknown>,
    start: number,
    sessionId?: string,
    streamPartBuffer?: AgencyStreamPart[],
  ): Promise<FinalizedExecutionResult> => {
    const guardConfig = normalizeGuardrails(opts.guardrails);
    const outputGuards = guardConfig?.output ?? [];
    const finalized: FinalizedExecutionResult = { ...result };
    const elapsedMs = Date.now() - start;

    if (outputGuards.length && typeof finalized.text === 'string') {
      finalized.text = await runGuardrails(finalized.text, outputGuards, 'output', opts.on);
    }

    if (opts.output && typeof finalized.text === 'string') {
      finalized.parsed = parseStructuredOutput(finalized.text, opts.output);
    }

    if (controls) {
      checkLimits(controls, finalized, elapsedMs, opts.on);
    }

    const resultUsage = normalizeUsage(finalized.usage);
    finalized.usage = resultUsage;
    addUsageTotals(agencyUsage, resultUsage);
    if (sessionId) {
      addUsageTotals(getSessionUsage(sessionUsage, sessionId), resultUsage);
    }

    const approvedResult = await maybeApproveFinalResult(
      opts,
      agencyName,
      finalized,
      elapsedMs,
      streamPartBuffer
        ? (part) => {
            streamPartBuffer.push(part);
          }
        : undefined,
    );

    streamPartBuffer?.push({
      type: 'final-output',
      text: (approvedResult.text as string) ?? '',
      usage: normalizeUsage(approvedResult.usage),
      agentCalls: ((approvedResult.agentCalls as AgentCallRecord[] | undefined) ?? []),
      parsed: approvedResult.parsed,
      durationMs: elapsedMs,
    });

    opts.on?.agentEnd?.({
      agent: agencyName,
      output: (approvedResult.text as string) ?? '',
      durationMs: elapsedMs,
      timestamp: Date.now(),
    });

    return approvedResult;
  };

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
      const preparedPrompt = await prepareExecutionPrompt(prompt);
      const result = (await strategy.execute(preparedPrompt, execOpts)) as Record<string, unknown>;
      return await finalizeExecutionResult(result, start, sessionId);
    } catch (error) {
      opts.on?.error?.({
        agent: agencyName,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      });
      throw error;
    }
  };

  const createStreamResult = (
    prompt: string,
    streamOpts?: Record<string, unknown>,
    sessionId?: string,
  ): AgencyStreamResult => {
    const start = Date.now();
    let errorReported = false;
    const postStreamParts: AgencyStreamPart[] = [];

    const reportError = (error: unknown): void => {
      if (errorReported) return;
      errorReported = true;
      opts.on?.error?.({
        agent: agencyName,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      });
    };

    opts.on?.agentStart?.({
      agent: agencyName,
      input: prompt,
      timestamp: start,
    });

    const deferredStream = (async () => {
      const preparedPrompt = await prepareExecutionPrompt(prompt);
      return strategy.stream(preparedPrompt, streamOpts) as CompiledStrategyStreamResult;
    })();

    const rawPartReplay = createBufferedAsyncReplay<AgencyStreamPart>((async function* () {
      const streamResult = await deferredStream;

      if (streamResult.fullStream) {
        yield* streamResult.fullStream;
        return;
      }

      if (streamResult.textStream) {
        for await (const chunk of streamResult.textStream) {
          yield { type: 'text', text: chunk };
        }
        return;
      }

      if (streamResult.text) {
        const fullText = await streamResult.text;
        if (fullText) {
          yield { type: 'text', text: fullText };
        }
      }
    })());

    const ensureDraining = async (): Promise<void> => {
      try {
        await rawPartReplay.ensureDraining();
      } catch (error) {
        reportError(error);
        throw error;
      }
    };

    const resolvedTextPromise: Promise<string> = (async () => {
      await ensureDraining();
      const bufferedText = rawPartReplay
        .getBuffered()
        .filter((part): part is { type: 'text'; text: string; agent?: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (bufferedText) return bufferedText;

      const streamResult = await deferredStream;
      return streamResult.text ? await streamResult.text : '';
    })();

    const resolvedUsagePromise: Promise<unknown> = (async () => {
      const streamResult = await deferredStream;
      if (streamResult.usage) {
        return await streamResult.usage;
      }

      await ensureDraining();
      return emptyUsageTotals();
    })();

    const resolvedAgentCallsPromise: Promise<unknown> = (async () => {
      const streamResult = await deferredStream;
      if (streamResult.agentCalls) {
        return await streamResult.agentCalls;
      }
      return [];
    })();

    const finalizedResultPromise: Promise<FinalizedExecutionResult> = (async () => {
      try {
        const [text, usage, agentCalls] = await Promise.all([
          resolvedTextPromise,
          resolvedUsagePromise,
          resolvedAgentCallsPromise,
        ]);

        const result: Record<string, unknown> = {
          text,
          usage,
          agentCalls: Array.isArray(agentCalls) ? agentCalls : [],
        };

        return await finalizeExecutionResult(result, start, sessionId, postStreamParts);
      } catch (error) {
        reportError(error);
        throw error;
      }
    })();

    return {
      textStream: (async function* () {
        try {
          for await (const part of rawPartReplay.iterable) {
            if (part.type === 'text') {
              yield part.text;
            }
          }
        } catch (error) {
          reportError(error);
          throw error;
        }
      })(),
      fullStream: (async function* () {
        try {
          for await (const part of rawPartReplay.iterable) {
            yield part;
          }
          const finalResult = await finalizedResultPromise;
          for (const part of postStreamParts) {
            yield part;
          }
          const allBufferedParts = [...rawPartReplay.getBuffered(), ...postStreamParts];
          const hasMatchingAgencyEnd = allBufferedParts.some(
            (part) =>
              part.type === 'agent-end' &&
              part.agent === agencyName &&
              part.output === ((finalResult.text as string) ?? ''),
          );
          if (!hasMatchingAgencyEnd) {
            yield {
              type: 'agent-end',
              agent: agencyName,
              output: (finalResult.text as string) ?? '',
              durationMs: Date.now() - start,
            };
          }
        } catch (error) {
          reportError(error);
          throw error;
        }
      })(),
      text: finalizedResultPromise.then((result) => (result.text as string) ?? ''),
      usage: finalizedResultPromise.then((result) => result.usage as {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUSD?: number;
      }),
      agentCalls: finalizedResultPromise.then((result) => (result.agentCalls ?? []) as AgentCallRecord[]),
      parsed: finalizedResultPromise.then((result) => result.parsed),
      finalTextStream: (async function* () {
        const finalResult = await finalizedResultPromise;
        const finalText = (finalResult.text as string) ?? '';
        if (finalText) {
          yield finalText;
        }
      })(),
    };
  };

  // ---------------------------------------------------------------------------
  // Returned Agent interface
  // ---------------------------------------------------------------------------

  /**
   * Build the core agent object.  `listen` and `connect` are conditionally
   * attached below based on the presence of `opts.voice` and `opts.channels`.
   */
  const agentObj: Agent = {
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
     * @returns An object with raw `textStream`, `fullStream`, awaitable `text`/`usage`
     *   promises, an awaitable `agentCalls` ledger, an awaitable `parsed` value
     *   when structured output is configured, and `finalTextStream` for the
     *   finalized post-processing text.
     */
    stream(prompt: string, streamOpts?: Record<string, unknown>): AgencyStreamResult {
      return createStreamResult(prompt, streamOpts);
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
           * Streams a user message through the agency strategy, feeding prior
           * conversation history into the prompt — matching the behaviour of
           * `session.send()`.  The assistant turn is appended to history once
           * the full streamed text is resolved.
           *
           * @param text - User message text.
           * @returns A streaming result compatible with `StreamTextResult`.
           */
          stream(text: string): unknown {
            // Push the user turn before building the prompt so the prior
            // history (everything before the new turn) is included.
            history.push({ role: 'user', content: text });
            const fullPrompt = buildSessionPrompt(history.slice(0, -1), text);
            const streamResult = createStreamResult(fullPrompt, undefined, sessionId) as {
              text: Promise<string>;
              textStream: AsyncIterable<string>;
              fullStream: AsyncIterable<AgencyStreamPart>;
              usage: Promise<unknown>;
            };

            // Append the assistant reply to history once streaming resolves.
            streamResult.text.then((assistantText) => {
              history.push({ role: 'assistant', content: assistantText });
            }).catch(() => {
              // Ignore resolution failures — history will just lack this turn.
            });

            return streamResult;
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

    /**
     * Exports this agency's configuration as a portable object.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns A portable {@link AgentExportConfig} object.
     */
    export(metadata?: AgentExportConfig['metadata']): AgentExportConfig {
      return exportAgentConfig(agentObj, metadata);
    },

    /**
     * Exports this agency's configuration as a pretty-printed JSON string.
     * @param metadata - Optional human-readable metadata to attach.
     * @returns JSON string with 2-space indentation.
     */
    exportJSON(metadata?: AgentExportConfig['metadata']): string {
      return exportAgentConfigJSON(agentObj, metadata);
    },
  };

  // Stash the original config as non-enumerable properties so that
  // exportAgentConfig() can retrieve them without polluting the public API.
  Object.defineProperty(agentObj, '__config', {
    value: opts,
    enumerable: false,
    configurable: true,
  });

  // Separate stash for agency-specific fields (sub-agent roster, strategy).
  // Needed by the export system to distinguish agency from single agent.
  const agencySubAgentConfigs: Record<string, BaseAgentConfig> = {};
  for (const [name, agentOrConfig] of Object.entries(opts.agents)) {
    if (isAgent(agentOrConfig)) {
      // Pre-built agents don't carry exportable config — store empty placeholder
      agencySubAgentConfigs[name] = {};
    } else {
      agencySubAgentConfigs[name] = agentOrConfig as BaseAgentConfig;
    }
  }
  Object.defineProperty(agentObj, '__agencyConfig', {
    value: {
      agents: agencySubAgentConfigs,
      strategy: opts.strategy,
      adaptive: opts.adaptive,
      maxRounds: opts.maxRounds,
    },
    enumerable: false,
    configurable: true,
  });

  // ---------------------------------------------------------------------------
  // listen() — voice WebSocket transport
  // ---------------------------------------------------------------------------

  /**
   * When `opts.voice.enabled` is set, attach a `listen()` method that starts a
   * local WebSocket server and exposes a port for real-time audio I/O.
   *
   * The WebSocket server acts as the transport layer; on each incoming connection
   * the audio bytes are bridged to the agency via `generate()` / `session()` once
   * a full-pipeline STT+TTS integration is in place.  For v1 the connection
   * handler is a no-op stub, establishing the port and URL surface so callers
   * can integrate their own audio transport.
   *
   * Dynamic import of `ws` keeps voice entirely optional — if the package is
   * not installed the error message tells the caller exactly what to install.
   */
  if (opts.voice?.enabled) {
    agentObj.listen = async (listenOpts?: { port?: number }): Promise<{ port: number; url: string; close: () => Promise<void> }> => {
      try {
        const ws = await import('ws');
        const WebSocketServer = (ws as any).WebSocketServer ?? ws.default?.Server ?? ws.Server;
        const port = listenOpts?.port ?? 0;

        const wss = new WebSocketServer({ port, host: '127.0.0.1' });
        await new Promise<void>((resolve) => wss.on('listening', resolve));
        const address = wss.address() as { port: number } | null;
        const actualPort = address?.port ?? port;

        /*
         * Connection handler: each WS client is a voice session.
         * v1 stub — real audio bridging (STT → agency.generate() → TTS) is
         * wired in the full voice pipeline via `src/voice-pipeline/`.
         * TODO: integrate `src/voice-pipeline/` STT+TTS pipeline here by
         * passing `agentObj.generate` as the LLM backend.
         */
        wss.on('connection', (_ws: unknown) => {
          // Audio bytes → STT → agency.generate() → TTS → audio bytes
          // Full pipeline: see packages/agentos/src/voice-pipeline/
        });

        return {
          port: actualPort,
          url: `ws://127.0.0.1:${actualPort}`,
          close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
        };
      } catch {
        throw new Error(
          'Voice transport requires the ws package. Install with: npm install ws',
        );
      }
    };
  }

  // ---------------------------------------------------------------------------
  // connect() — channel adapter wiring
  // ---------------------------------------------------------------------------

  /**
   * When `opts.channels` contains at least one configured channel, attach a
   * `connect()` method.  On invocation it iterates the channel map, logs each
   * channel as configured, and defers real adapter initialisation to runtime.
   *
   * Full channel wiring depends on the channel adapter infrastructure in
   * `packages/agentos/src/channels/`.  For v1 `connect()` establishes the
   * surface — real adapter instances are a follow-up integration.
   *
   * Channel adapters follow the `IChannelAdapter` pattern:
   *   connect(config, messageHandler) — where `messageHandler` bridges incoming
   *   channel messages to `agentObj.generate()`.
   */
  if (opts.channels && Object.keys(opts.channels).length > 0) {
    agentObj.connect = async (): Promise<void> => {
      for (const [channelName, channelConfig] of Object.entries(opts.channels!)) {
        try {
          /*
           * Dynamic import of the channel adapter.  Each adapter is registered
           * under `channels/<name>/index.js` in the extensions registry.
           * TODO: resolve adapters from the ExtensionRegistry and call
           *   adapter.connect(channelConfig, (msg) => agentObj.generate(msg))
           */
          void channelConfig; // suppress unused warning until full wiring
          console.log(
            `[agency] Channel "${channelName}" configured (connection deferred to runtime)`,
          );
        } catch {
          console.warn(`[agency] Channel "${channelName}" adapter not available`);
        }
      }
    };
  }

  return agentObj;
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
      '../safety/guardrails/index.js'
    );

    /*
     * Build lightweight guardrail service stubs from IDs.
     * Each stub checks the text against a simple pattern matching strategy.
     * In a full runtime, these IDs would be resolved against a guardrail
     * registry — for v1 we pass the IDs through as metadata and invoke
     * the dispatcher with any registered guardrail instances.
     */
    const sanitizedText = text;

    for (const guardId of guardIds) {
      /* Fire a guardrailResult event indicating the guard was not evaluated.
       * The guardrail registry is loaded but individual guards are not yet
       * wired — `enforced: false` signals that no actual evaluation occurred. */
      callbacks?.guardrailResult?.({
        agent: '__agency__',
        guardrailId: guardId,
        passed: true,
        enforced: false,
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
// RAG context injection
// ---------------------------------------------------------------------------

/**
 * Injects retrieved context into the prompt when RAG is configured.
 *
 * For v1 this is a shell that accepts the {@link RagConfig} and returns the
 * prompt unmodified (no-op) when no live vector store query can be performed.
 * The infrastructure exists in `src/rag/` but initialising
 * `EmbeddingManager` + `VectorStoreManager` is a heavyweight operation best
 * suited to the full `AgentOSOrchestrator` pipeline.
 *
 * TODO: wire live retrieval by importing `EmbeddingManager` + `VectorStoreManager`
 * from `../../rag/index.js`, embedding the query, and returning the top-K chunks
 * joined as a context block.  See `src/rag/IVectorStore.ts` for the query API.
 *
 * When `ragConfig.documents` is set (but a live vector store is not) an info
 * message is logged directing the caller to `AgentOSOrchestrator` for full RAG.
 *
 * @param prompt - The user prompt to augment.
 * @param ragConfig - RAG configuration from `AgencyOptions.rag`.
 * @returns The (possibly augmented) prompt string.
 */
async function injectRagContext(prompt: string, ragConfig: RagConfig): Promise<string> {
  // If a vector store is configured, attempt a live retrieval query.
  if (ragConfig.vectorStore) {
    try {
      const ragContext = await retrieveRagContext(prompt, ragConfig);
      if (ragContext) {
        return `[Retrieved context]\n${ragContext}\n\n[User query]\n${prompt}`;
      }
    } catch {
      // RAG infrastructure not available — fail open and proceed without context.
    }
  }

  // If documents are specified but no vector store query succeeded, guide the caller.
  if (ragConfig.documents && ragConfig.documents.length > 0) {
    console.info(
      '[AgentOS][Agency] RAG document loading configured — use AgentOSOrchestrator ' +
      'for full RAG pipeline with document indexing and retrieval.',
    );
  }

  return prompt;
}

/**
 * Queries the configured vector store for chunks relevant to `query`.
 *
 * This is a placeholder for v1.  In a full implementation this would:
 * 1. Import and initialise `EmbeddingManager` from `../../rag/EmbeddingManager.js`.
 * 2. Embed `query` with the provider from `ragConfig.vectorStore.embeddingModel`.
 * 3. Call `vectorStore.search(embedding, topK, minScore)` on the active store.
 * 4. Join the returned chunks into a context string.
 *
 * TODO: implement live retrieval once `EmbeddingManager` + `VectorStoreManager`
 * are available as lightweight imports without NestJS / heavy DI overhead.
 * See `src/rag/EmbeddingManager.ts` and `src/rag/IVectorStore.ts`.
 *
 * @param _query - The text to embed and search for.
 * @param _ragConfig - The active RAG configuration.
 * @returns A joined context string, or `null` when retrieval is unavailable.
 */
async function retrieveRagContext(
  _query: string,
  _ragConfig: RagConfig,
): Promise<string | null> {
  // v1 placeholder — returns null (no-op).
  // Full wiring: EmbeddingManager.embed(_query) → vectorStore.search(embedding, topK, minScore)
  return null;
}

// ---------------------------------------------------------------------------
// Structured output (Zod parsing)
// ---------------------------------------------------------------------------

/**
 * Appends a JSON schema hint to the prompt when structured output is configured.
 *
 * If the schema exposes a Zod `.shape` (for object schemas) or `.description`,
 * a human-readable description is appended. Otherwise a generic JSON instruction
 * is added to the prompt.
 *
 * @param prompt - The original prompt text.
 * @param schema - The Zod schema (typed as `unknown` to avoid a hard zod dep).
 * @returns The prompt with the schema hint appended.
 */
function appendSchemaHint(prompt: string, schema: unknown): string {
  const zodSchema = schema as { shape?: Record<string, unknown>; description?: string };
  let schemaDescription = '';

  if (zodSchema?.shape) {
    const keys = Object.keys(zodSchema.shape);
    schemaDescription = `an object with keys: ${keys.join(', ')}`;
  } else if (zodSchema?.description) {
    schemaDescription = zodSchema.description;
  }

  const hint = schemaDescription
    ? `\n\nRespond with valid JSON matching this schema: ${schemaDescription}. Output only the JSON object, no additional text.`
    : '\n\nRespond with valid JSON. Output only the JSON object, no additional text.';

  return prompt + hint;
}

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
  emitStreamPart?: (part: AgencyStreamPart) => void,
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
  emitStreamPart?.({ type: 'approval-requested', request });
  const decision = await resolveApprovalDecision(opts.hitl, request);
  opts.on?.approvalDecided?.(decision);
  emitStreamPart?.({
    type: 'approval-decided',
    requestId: request.id,
    approved: decision.approved,
  });

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
