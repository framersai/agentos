/**
 * @file types.ts
 * Shared configuration types for the AgentOS high-level Agency API.
 *
 * Defines `BaseAgentConfig` — the unified configuration shape accepted by both
 * `agent()` and `agency()` — together with all supporting sub-config interfaces,
 * event types, callback maps, and the discriminated `AgencyStreamPart` union.
 */

import type { AdaptableToolInput } from './toolAdapter.js';

// ---------------------------------------------------------------------------
// Scalar union literals
// ---------------------------------------------------------------------------

/**
 * Named security tier controlling which tools and capabilities an agent is
 * permitted to invoke.  Ordered from least-restrictive to most-restrictive.
 *
 * - `"dangerous"` — no restrictions; only for trusted internal contexts.
 * - `"permissive"` — most capabilities enabled; network + filesystem allowed.
 * - `"balanced"` — sensible defaults; destructive actions require approval.
 * - `"strict"` — read-only filesystem, no shell spawn, narrow tool allow-list.
 * - `"paranoid"` — minimal surface; all side-effecting tools blocked.
 */
export type SecurityTier = 'dangerous' | 'permissive' | 'balanced' | 'strict' | 'paranoid';

/**
 * Memory subsystem classification that controls where and how facts are stored.
 *
 * - `"episodic"` — time-ordered conversation events (what happened when).
 * - `"semantic"` — factual knowledge and entity attributes.
 * - `"procedural"` — learned skills and step-by-step procedures.
 * - `"prospective"` — future intentions and pending reminders.
 */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'prospective';

/**
 * High-level orchestration strategy for multi-agent runs.
 *
 * - `"sequential"` — agents are called one after another; output of each feeds the next.
 * - `"parallel"` — all agents are invoked concurrently; results are merged.
 * - `"debate"` — agents iteratively argue and refine a shared answer.
 * - `"review-loop"` — one agent produces output, another reviews and requests revisions.
 * - `"hierarchical"` — a coordinator agent dispatches sub-tasks to specialist agents.
 * - `"graph"` — explicit dependency DAG; agents run when all `dependsOn` predecessors complete.
 */
export type AgencyStrategy =
  | 'sequential'
  | 'parallel'
  | 'debate'
  | 'review-loop'
  | 'hierarchical'
  | 'graph';

// ---------------------------------------------------------------------------
// Sub-config interfaces
// ---------------------------------------------------------------------------

/**
 * Fine-grained memory configuration.  Pass `true` to `BaseAgentConfig.memory` to
 * enable defaults, or supply this object for explicit control.
 */
export interface MemoryConfig {
  /** When `true` in a multi-agent context, all agents share the same memory store. */
  shared?: boolean;
  /** Which memory subsystems to activate. */
  types?: MemoryType[];
  /** Configuration for the short-lived working-memory buffer. */
  working?: {
    /** Whether the working-memory buffer is active. */
    enabled: boolean;
    /** Maximum tokens held in the working-memory window. */
    maxTokens?: number;
    /** Eviction / summarisation strategy identifier. */
    strategy?: string;
  };
  /** Configuration for periodic background consolidation of episodic → semantic memory. */
  consolidation?: {
    /** Whether automatic consolidation is enabled. */
    enabled: boolean;
    /** Cron-style or ISO-duration interval between consolidation passes (e.g. `"PT1H"`). */
    interval?: string;
  };
}

/**
 * Retrieval-Augmented Generation configuration.
 * Attaches a vector store and optional document loaders to the agent.
 */
export interface RagConfig {
  /** Vector store provider and embedding model selection. */
  vectorStore?: {
    /** Provider identifier (e.g. `"pinecone"`, `"weaviate"`, `"in-memory"`). */
    provider: string;
    /** Embedding model used to encode documents and queries. */
    embeddingModel?: string;
  };
  /** Document sources to index on startup. */
  documents?: Array<{
    /** Absolute or relative path to a local file. */
    path?: string;
    /** Remote URL to fetch and index. */
    url?: string;
    /** Loader identifier (e.g. `"pdf"`, `"markdown"`, `"html"`). */
    loader?: string;
  }>;
  /** Graph-based RAG extension (e.g. Microsoft GraphRAG). */
  graphRag?: {
    /** Whether graph-enhanced retrieval is active. */
    enabled: boolean;
    /** Graph store provider identifier. */
    provider?: string;
  };
  /** Enable multimodal document indexing alongside text. */
  multimodal?: {
    /** Index and retrieve image content. */
    images?: boolean;
    /** Index and retrieve audio transcripts. */
    audio?: boolean;
  };
  /** Default number of chunks to retrieve per query. */
  topK?: number;
  /** Minimum cosine-similarity score to include a chunk (0–1). */
  minScore?: number;
  /** Per-agent retrieval overrides in multi-agent contexts. */
  agentAccess?: Record<
    string,
    {
      /** Override `topK` for this specific agent. */
      topK?: number;
      /** Restrict this agent to a subset of named collections. */
      collections?: string[];
    }
  >;
}

/**
 * Capability discovery configuration.
 * Controls whether and how the agent self-discovers tools and extensions at
 * runtime via the `CapabilityDiscoveryEngine`.
 */
export interface DiscoveryConfig {
  /** Whether runtime capability discovery is enabled. */
  enabled: boolean;
  /**
   * Filter by capability kind.
   * @example `['tool', 'skill', 'extension']`
   */
  kinds?: string[];
  /**
   * Discovery aggressiveness profile.
   * - `"aggressive"` — maximise recall; may surface lower-relevance capabilities.
   * - `"balanced"` — default trade-off between precision and recall.
   * - `"precision"` — only surface high-confidence matches.
   */
  profile?: 'aggressive' | 'balanced' | 'precision';
}

/**
 * Structured guardrail configuration.
 * Allows separate input and output guardrail sets, plus an optional security tier
 * override.  Pass a plain `string[]` to `BaseAgentConfig.guardrails` as a shorthand.
 */
export interface GuardrailsConfig {
  /** Guardrail identifiers applied to every incoming user message. */
  input?: string[];
  /** Guardrail identifiers applied to every outgoing assistant response. */
  output?: string[];
  /** Security tier applied when evaluating guardrail policies. */
  tier?: SecurityTier;
}

/**
 * Tool and resource permission overrides for the agent.
 */
export interface PermissionsConfig {
  /**
   * Which tools the agent is allowed to call.
   * - `"all"` — unrestricted (subject to the active security tier).
   * - `string[]` — explicit allow-list of tool names.
   */
  tools?: 'all' | string[];
  /** Whether the agent may make outbound network requests. */
  network?: boolean;
  /** Whether the agent may read or write files. */
  filesystem?: boolean;
  /** Whether the agent may spawn subprocesses. */
  spawn?: boolean;
  /** Tool names that require a human-in-the-loop approval before execution. */
  requireApproval?: string[];
}

/**
 * Human-in-the-loop (HITL) configuration.
 * Gates specific lifecycle events behind an async approval handler before
 * the agent proceeds.
 */
export interface HitlConfig {
  /**
   * Declarative approval triggers.  All are opt-in; omitting a field means
   * no pause at that lifecycle point.
   */
  approvals?: {
    /** Tool names whose invocations require approval before execution. */
    beforeTool?: string[];
    /** Agent names whose invocations require approval before execution. */
    beforeAgent?: string[];
    /** Whether emergent agent creation requires approval. */
    beforeEmergent?: boolean;
    /** Whether returning the final answer requires approval. */
    beforeReturn?: boolean;
    /** Whether a runtime strategy override requires approval. */
    beforeStrategyOverride?: boolean;
  };
  /**
   * Custom async handler invoked for every approval request.
   * Must resolve to an `ApprovalDecision` within `timeoutMs` or the
   * `onTimeout` policy is applied.
   */
  handler?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Maximum milliseconds to wait for the handler to resolve. Defaults to `30_000`. */
  timeoutMs?: number;
  /**
   * Policy applied when the handler does not respond within `timeoutMs`.
   * - `"reject"` — treat as denied; the action is blocked.
   * - `"approve"` — treat as approved; the action proceeds automatically.
   * - `"error"` — throw an error and halt the run.
   */
  onTimeout?: 'reject' | 'approve' | 'error';
}

/**
 * Emergent agent configuration.
 * Controls whether the orchestrator may synthesise new specialist agents
 * at runtime to handle tasks not covered by the statically defined roster.
 */
export interface EmergentConfig {
  /** Whether runtime agent synthesis is enabled. */
  enabled: boolean;
  /**
   * Scope in which synthesised agents are visible.
   * - `"session"` — ephemeral; discarded when the run ends.
   * - `"agent"` — persisted for the lifetime of the parent agent instance.
   * - `"shared"` — persisted globally across all agent instances.
   */
  tier?: 'session' | 'agent' | 'shared';
  /** When `true`, a separate judge agent evaluates emergent agents before use. */
  judge?: boolean;
}

/**
 * Voice interface configuration.
 * Activates real-time audio I/O via a streaming or telephony transport.
 */
export interface VoiceConfig {
  /** Whether voice mode is active. */
  enabled: boolean;
  /**
   * Underlying transport mechanism.
   * - `"streaming"` — WebSocket / WebRTC real-time audio.
   * - `"telephony"` — PSTN / SIP integration via a telephony provider.
   */
  transport?: 'streaming' | 'telephony';
  /** Speech-to-text provider identifier (e.g. `"deepgram"`, `"whisper"`). */
  stt?: string;
  /** Text-to-speech provider identifier (e.g. `"elevenlabs"`, `"openai-tts"`). */
  tts?: string;
  /** Voice ID or name to use for TTS synthesis. */
  ttsVoice?: string;
  /** Endpointing strategy identifier for turn detection. */
  endpointing?: string;
  /** Barge-in (interruption) strategy identifier. */
  bargeIn?: string;
  /** Whether multi-speaker diarization is enabled. */
  diarization?: boolean;
  /** BCP-47 language tag for STT and TTS (e.g. `"en-US"`). */
  language?: string;
  /** Provider-specific telephony options passed through opaquely. */
  telephony?: Record<string, unknown>;
}

/**
 * Provenance and audit-trail configuration.
 * Records a cryptographic chain of custody for every agent action.
 */
export interface ProvenanceConfig {
  /** Whether provenance recording is active. */
  enabled: boolean;
  /** Append each record to a hash chain for tamper detection. */
  hashChain?: boolean;
  /** Flags controlling which events are included in the provenance log. */
  record?: Record<string, boolean>;
  /**
   * Export format for the provenance ledger.
   * - `"jsonl"` — newline-delimited JSON written to a local file.
   * - `"otlp"` — OpenTelemetry Protocol export to a collector.
   * - `"solana"` — on-chain anchor commitment via the Wunderland SOL integration.
   */
  export?: 'jsonl' | 'otlp' | 'solana';
}

/**
 * Observability and telemetry configuration.
 */
export interface ObservabilityConfig {
  /** Minimum log severity to emit. */
  logLevel?: 'silent' | 'error' | 'info' | 'debug';
  /** Whether to emit structured trace events for every agent lifecycle step. */
  traceEvents?: boolean;
  /** Durable usage ledger options (provider-defined; pass-through). */
  usageLedger?: unknown;
  /** OpenTelemetry integration. */
  otel?: {
    /** Whether OTEL span export is enabled. */
    enabled: boolean;
  };
}

/**
 * Resource limits applied to the entire agency run.
 * The `onLimitReached` policy determines whether a breach is fatal.
 */
export interface ResourceControls {
  /** Maximum total tokens (prompt + completion) across all agents and steps. */
  maxTotalTokens?: number;
  /** Maximum USD cost cap across the entire run. */
  maxCostUSD?: number;
  /** Wall-clock time budget for the run in milliseconds. */
  maxDurationMs?: number;
  /** Maximum number of agent invocations (across all agents). */
  maxAgentCalls?: number;
  /** Maximum steps per individual agent invocation. */
  maxStepsPerAgent?: number;
  /** Maximum number of emergent agents the orchestrator may synthesise. */
  maxEmergentAgents?: number;
  /**
   * Action taken when any resource limit is breached.
   * - `"stop"` — gracefully stop and return partial results.
   * - `"warn"` — emit a `limitReached` event and continue.
   * - `"error"` — throw an error and halt immediately.
   */
  onLimitReached?: 'stop' | 'warn' | 'error';
}

// ---------------------------------------------------------------------------
// HITL request / decision types
// ---------------------------------------------------------------------------

/**
 * A pending approval request raised by the HITL subsystem.
 * Passed to `HitlConfig.handler` and emitted on the `approvalRequested` callback.
 */
export interface ApprovalRequest {
  /** Unique identifier for this approval request. */
  id: string;
  /**
   * What kind of action is awaiting approval.
   *
   * - `"tool"` — a tool invocation.
   * - `"agent"` — an agent invocation.
   * - `"emergent"` — synthesis of a new runtime agent.
   * - `"output"` — the final answer before returning to the caller.
   * - `"strategy-override"` — the orchestrator wants to change the execution strategy.
   */
  type: 'tool' | 'agent' | 'emergent' | 'output' | 'strategy-override';
  /** Name of the agent that triggered the approval request. */
  agent: string;
  /** Short action label (e.g. tool or agent name). */
  action: string;
  /** Human-readable description of what is being approved. */
  description: string;
  /** Structured details about the pending action (tool args, agent config, etc.). */
  details: Record<string, unknown>;
  /** Snapshot of run context at the time the request was raised. */
  context: {
    /** All agent call records completed so far in this run. */
    agentCalls: AgentCallRecord[];
    /** Cumulative token count up to this point. */
    totalTokens: number;
    /** Cumulative cost in USD up to this point. */
    totalCostUSD: number;
    /** Wall-clock milliseconds elapsed since the run started. */
    elapsedMs: number;
  };
}

/**
 * The resolved decision returned by `HitlConfig.handler`.
 */
export interface ApprovalDecision {
  /** Whether the action was approved. */
  approved: boolean;
  /** Optional human-provided rationale for the decision. */
  reason?: string;
  /**
   * Optional in-line modifications the approver wishes to apply.
   * The orchestrator merges these on top of the original action before
   * proceeding (only when `approved` is `true`).
   */
  modifications?: {
    /** Overridden tool arguments. */
    toolArgs?: unknown;
    /** Overridden output text. */
    output?: string;
    /** Additional instructions injected into the agent's system prompt. */
    instructions?: string;
  };
}

// ---------------------------------------------------------------------------
// Agent call record
// ---------------------------------------------------------------------------

/**
 * A complete record of a single agent invocation within an agency run.
 * Appended to `GenerateTextResult.agentCalls` and surfaced in `ApprovalRequest.context`.
 */
export interface AgentCallRecord {
  /** Name of the agent that was invoked. */
  agent: string;
  /** Input prompt or message sent to the agent. */
  input: string;
  /** Final text output produced by the agent. */
  output: string;
  /** Ordered list of tool invocations made during this call. */
  toolCalls: Array<{
    /** Tool name. */
    name: string;
    /** Arguments supplied by the model. */
    args: unknown;
    /** Return value from the tool (present on success). */
    result?: unknown;
    /** Error message if the tool failed. */
    error?: string;
  }>;
  /** Guardrail evaluation results for this agent call. */
  guardrailResults?: Array<{
    /** Guardrail identifier. */
    id: string;
    /** Whether the guardrail check passed. */
    passed: boolean;
    /** Action taken by the guardrail (e.g. `"allow"`, `"block"`, `"redact"`). */
    action: string;
  }>;
  /** Token usage for this individual agent call. */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Cost in USD for this call, when available. */
    costUSD?: number;
  };
  /** Wall-clock milliseconds for this agent call. */
  durationMs: number;
  /** Whether this agent was synthesised at runtime by the emergent subsystem. */
  emergent?: boolean;
}

// ---------------------------------------------------------------------------
// Callback event types
// ---------------------------------------------------------------------------

/** Emitted immediately before an agent begins processing its input. */
export interface AgentStartEvent {
  /** Agent name. */
  agent: string;
  /** Input text provided to the agent. */
  input: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted after an agent has produced its final output. */
export interface AgentEndEvent {
  /** Agent name. */
  agent: string;
  /** Final text output. */
  output: string;
  /** Wall-clock duration of the agent call. */
  durationMs: number;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted when the orchestrator routes control from one agent to another. */
export interface HandoffEvent {
  /** Name of the agent relinquishing control. */
  fromAgent: string;
  /** Name of the agent receiving control. */
  toAgent: string;
  /** Human-readable explanation of why the handoff occurred. */
  reason: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted each time an agent invokes a tool. */
export interface ToolCallEvent {
  /** Agent name that issued the tool call. */
  agent: string;
  /** Tool name. */
  toolName: string;
  /** Arguments passed to the tool. */
  args: unknown;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted when the emergent agent subsystem synthesises or attempts to synthesise a new agent. */
export interface ForgeEvent {
  /** Name assigned to the newly synthesised agent. */
  agentName: string;
  /** System instructions generated for the emergent agent. */
  instructions: string;
  /** Whether the forge was approved (relevant when `HitlConfig.approvals.beforeEmergent` is set). */
  approved: boolean;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted after a guardrail has evaluated an input or output. */
export interface GuardrailEvent {
  /** Agent name whose content was evaluated. */
  agent: string;
  /** Guardrail identifier. */
  guardrailId: string;
  /** Whether the guardrail check passed. */
  passed: boolean;
  /**
   * Whether the guardrail was actually evaluated/enforced.
   * When `false`, the guardrail infrastructure was loaded but the individual
   * guard was not wired — the `passed` value is a default, not an evaluation result.
   */
  enforced?: boolean;
  /** Action taken by the guardrail (e.g. `"allow"`, `"block"`, `"redact"`). */
  action: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/** Emitted when a `ResourceControls` limit is reached. */
export interface LimitEvent {
  /** Name of the metric that was breached (e.g. `"maxTotalTokens"`). */
  metric: string;
  /** Observed value at the time of the breach. */
  value: number;
  /** Configured limit that was exceeded. */
  limit: number;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/**
 * Discriminated union of all structured trace events emitted by the agency run.
 * Collected in `GenerateTextResult.trace` and emitted via `AgencyCallbacks`.
 */
export type AgencyTraceEvent =
  | AgentStartEvent
  | AgentEndEvent
  | HandoffEvent
  | ToolCallEvent
  | ForgeEvent
  | GuardrailEvent
  | LimitEvent;

// ---------------------------------------------------------------------------
// Callback map
// ---------------------------------------------------------------------------

/**
 * Event callbacks registered on `BaseAgentConfig.on`.
 * All handlers are fire-and-forget (return `void`); errors thrown inside them
 * are swallowed to prevent disrupting the main run.
 */
export interface AgencyCallbacks {
  /** Called immediately before an agent starts. */
  agentStart?: (e: AgentStartEvent) => void;
  /** Called after an agent produces its final output. */
  agentEnd?: (e: AgentEndEvent) => void;
  /** Called when control is handed off between agents. */
  handoff?: (e: HandoffEvent) => void;
  /** Called when an agent invokes a tool. */
  toolCall?: (e: ToolCallEvent) => void;
  /** Called when an unhandled error occurs inside an agent. */
  error?: (e: { agent: string; error: Error; timestamp: number }) => void;
  /** Called when the emergent subsystem forges a new agent. */
  emergentForge?: (e: ForgeEvent) => void;
  /** Called after a guardrail evaluates an input or output. */
  guardrailResult?: (e: GuardrailEvent) => void;
  /** Called when a resource limit is reached. */
  limitReached?: (e: LimitEvent) => void;
  /** Called when an approval request is raised. */
  approvalRequested?: (e: ApprovalRequest) => void;
  /** Called after an approval decision is resolved. */
  approvalDecided?: (e: ApprovalDecision) => void;
}

// ---------------------------------------------------------------------------
// Agency stream parts
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all streaming events emitted by an `agency()` stream.
 * A superset of the base `StreamPart` type — includes all text/tool events
 * plus agency-level lifecycle events.
 */
export type AgencyStreamPart =
  | { type: 'text'; text: string; agent?: string }
  | { type: 'tool-call'; toolName: string; args: unknown; agent?: string }
  | { type: 'tool-result'; toolName: string; result: unknown; agent?: string }
  | { type: 'error'; error: Error; agent?: string }
  | { type: 'agent-start'; agent: string; input: string }
  | { type: 'agent-end'; agent: string; output: string; durationMs: number }
  | { type: 'agent-handoff'; fromAgent: string; toAgent: string; reason: string }
  | { type: 'strategy-override'; original: string; chosen: string; reason: string }
  | { type: 'emergent-forge'; agentName: string; instructions: string; approved: boolean }
  | {
      type: 'guardrail-result';
      agent: string;
      guardrailId: string;
      passed: boolean;
      action: string;
    }
  | { type: 'approval-requested'; request: ApprovalRequest }
  | { type: 'approval-decided'; requestId: string; approved: boolean }
  | { type: 'permission-denied'; agent: string; action: string; reason: string };

// ---------------------------------------------------------------------------
// Agent / Agency interfaces
// ---------------------------------------------------------------------------

/**
 * A stateful agent instance. Returned by both `agent()` and `agency()`.
 * The `agency()` variant additionally coordinates multiple underlying agents.
 *
 * The interface is intentionally minimal so that an `agency()` return value
 * is a drop-in replacement for an `agent()` return value -- callers can
 * swap between single-agent and multi-agent without changing call sites.
 *
 * @example
 * ```ts
 * // Single agent:
 * const solo = agent({ model: 'openai:gpt-4o', instructions: 'Be helpful.' });
 * const result = await solo.generate('Hello!');
 *
 * // Multi-agent agency (same interface):
 * const team = agency({
 *   model: 'openai:gpt-4o',
 *   agents: { a: { instructions: 'Research.' }, b: { instructions: 'Write.' } },
 * });
 * const teamResult = await team.generate('Summarise AI research.');
 *
 * // Both can be used interchangeably:
 * async function run(a: Agent) { return a.generate('Task'); }
 * await run(solo);
 * await run(team);
 * ```
 *
 * @see {@link Agency} -- type alias confirming structural equivalence.
 */
export interface Agent {
  /**
   * Generates a single reply (non-streaming).
   *
   * @param prompt - User prompt text.
   * @param opts - Optional per-call overrides.
   * @returns The complete generation result including text, usage, and tool calls.
   */
  generate(prompt: string, opts?: Record<string, unknown>): Promise<unknown>;
  /**
   * Streams a reply, returning a `StreamTextResult`-compatible object.
   *
   * @param prompt - User prompt text.
   * @param opts - Optional per-call overrides.
   * @returns An object with `textStream`, `fullStream`, and awaitable `text`/`usage` promises.
   */
  stream(prompt: string, opts?: Record<string, unknown>): unknown;
  /**
   * Returns (or creates) a named conversation session.
   *
   * @param id - Optional session identifier; auto-generated when omitted.
   * @returns The session object for this ID.
   */
  session(id?: string): unknown;
  /**
   * Returns cumulative usage totals for the agent or a specific session.
   *
   * @param sessionId - Optional session filter.
   */
  usage(sessionId?: string): Promise<unknown>;
  /** Releases all in-memory state held by this agent. */
  close(): Promise<void>;
  /**
   * Starts an HTTP server exposing the agent over a REST / SSE interface.
   * Present on agency instances only.
   *
   * @param opts - Server options including optional port.
   * @returns Resolves to the bound port, URL, and a `close()` teardown function.
   */
  listen?(opts?: {
    port?: number;
  }): Promise<{ port: number; url: string; close: () => Promise<void> }>;
  /**
   * Connects the agent to configured channel adapters (e.g. Discord, Slack).
   * Present on agency instances only.
   */
  connect?(): Promise<void>;
  /**
   * Exports the agent's full configuration as a portable object.
   *
   * The returned {@link AgentExportConfig} (imported from `./agentExport.js`)
   * can be serialized to JSON or YAML and re-imported via `importAgent()`.
   *
   * @param metadata - Optional human-readable metadata to attach.
   * @returns A portable config object.
   */
  export?(metadata?: Record<string, unknown>): unknown;
  /**
   * Exports the agent's full configuration as a pretty-printed JSON string.
   *
   * @param metadata - Optional human-readable metadata to attach.
   * @returns JSON string with 2-space indentation.
   */
  exportJSON?(metadata?: Record<string, unknown>): string;
}

/**
 * An `Agency` is structurally identical to an `Agent` but is returned by
 * `agency()` and coordinates multiple underlying sub-agents.
 */
export type Agency = Agent;

// ---------------------------------------------------------------------------
// BaseAgentConfig — the core shared config shape
// ---------------------------------------------------------------------------

/**
 * Full shared configuration accepted by both `agent()` and `agency()`.
 *
 * Each field is optional; sensible defaults are applied at runtime.  For the
 * lightweight `agent()` helper, only `model`/`provider`, `instructions`, and
 * `tools` are typically needed.  `agency()` additionally consumes orchestration,
 * session, aggregate usage, resource control, and `beforeReturn` HITL settings.
 * The richer fields (`rag`, `discovery`, `guardrails`, `voice`, `channels`,
 * `provenance`, etc.) remain part of the shared config surface for forward
 * compatibility, but are still more fully enforced by the deeper runtime.
 */
export interface BaseAgentConfig {
  /**
   * Model identifier. Accepted in two formats:
   * - `"provider:model"` — e.g. `"openai:gpt-4o"`.
   * - Plain model name when `provider` is also set.
   */
  model?: string;
  /**
   * Provider name (e.g. `"openai"`, `"anthropic"`, `"ollama"`).
   * Auto-detected from environment API keys when omitted.
   */
  provider?: string;
  /** Free-form system instructions prepended to the system prompt. */
  instructions?: string;
  /** Display name for the agent, injected into the system prompt. */
  name?: string;
  /** Override the provider API key instead of reading from environment variables. */
  apiKey?: string;
  /** Override the provider base URL (useful for local proxies or Ollama). */
  baseUrl?: string;
  /**
   * HEXACO-inspired personality trait overrides (0–1 scale).
   * Encoded as a human-readable trait string appended to the system prompt.
   */
  personality?: Partial<{
    honesty: number;
    emotionality: number;
    extraversion: number;
    agreeableness: number;
    conscientiousness: number;
    openness: number;
  }>;
  /**
   * Tools available to the agent on every call.
   *
   * Accepts:
   * - a named high-level tool map
   * - an `ExternalToolRegistry` (`Record`, `Map`, or iterable)
   * - a prompt-only `ToolDefinitionForLLM[]`
   */
  tools?: AdaptableToolInput;
  /** Maximum number of agentic steps (LLM calls) per invocation. Defaults to `5`. */
  maxSteps?: number;
  /**
   * Memory configuration.
   * - `true` — enable in-memory conversation history with default settings.
   * - `false` — disable memory; every call is stateless.
   * - `MemoryConfig` — full control over memory subsystems.
   */
  memory?: boolean | MemoryConfig;
  /** Retrieval-Augmented Generation configuration. */
  rag?: RagConfig;
  /** Runtime capability discovery configuration. */
  discovery?: DiscoveryConfig;
  /**
   * Guardrail policy identifiers or structured config.
   * - `string[]` — shorthand; applies to both input and output.
   * - `GuardrailsConfig` — full control with separate input/output lists.
   */
  guardrails?: string[] | GuardrailsConfig;
  /** Security tier controlling permitted tools and capabilities. */
  security?: { tier: SecurityTier };
  /** Fine-grained tool and resource permission overrides. */
  permissions?: PermissionsConfig;
  /** Human-in-the-loop approval configuration. */
  hitl?: HitlConfig;
  /** Emergent agent synthesis configuration. */
  emergent?: EmergentConfig;
  /** Voice interface configuration. */
  voice?: VoiceConfig;
  /**
   * Channel adapter configurations keyed by channel name.
   * Values are channel-specific option objects passed through opaquely.
   */
  channels?: Record<string, Record<string, unknown>>;
  /**
   * Output schema for structured generation.
   * Accepts a Zod schema at runtime; typed as `unknown` here to avoid a
   * hard dependency on the `zod` package in the types layer.
   */
  output?: unknown;
  /** Provenance and audit-trail configuration. */
  provenance?: ProvenanceConfig;
  /** Observability and telemetry configuration. */
  observability?: ObservabilityConfig;
  /** Event callbacks fired at various lifecycle points during the run. */
  on?: AgencyCallbacks;
  /** Resource limits (tokens, cost, time) applied to the entire run. */
  controls?: ResourceControls;
  /**
   * Names of other agents in the agency that must complete before this agent runs.
   * Used with `strategy: 'graph'` to build an explicit dependency DAG.
   * Agents with no `dependsOn` are roots and run first.
   * @example `dependsOn: ['researcher']` — this agent waits for `researcher` to finish.
   */
  dependsOn?: string[];
}

// ---------------------------------------------------------------------------
// AgencyOptions — extends BaseAgentConfig with multi-agent fields
// ---------------------------------------------------------------------------

/**
 * Configuration for the `agency()` factory function.
 * Extends `BaseAgentConfig` with a required `agents` roster and optional
 * multi-agent orchestration settings.
 *
 * @example
 * ```ts
 * import { agency, hitl } from '@framers/agentos';
 *
 * const myAgency = agency({
 *   model: 'openai:gpt-4o',
 *   strategy: 'sequential',
 *   agents: {
 *     researcher: { instructions: 'Find relevant papers.' },
 *     writer:     { instructions: 'Write a clear summary.' },
 *   },
 *   controls: { maxTotalTokens: 50_000, onLimitReached: 'warn' },
 *   hitl: {
 *     approvals: { beforeTool: ['delete-file'], beforeReturn: true },
 *     handler: hitl.autoApprove(),
 *     timeoutMs: 30_000,
 *     onTimeout: 'reject',
 *   },
 *   on: {
 *     agentStart: (e) => console.log(`[${e.agent}] started`),
 *     agentEnd: (e) => console.log(`[${e.agent}] done in ${e.durationMs}ms`),
 *   },
 * });
 * ```
 *
 * @see {@link agency} -- the factory function that consumes this configuration.
 * @see {@link BaseAgentConfig} -- the shared config surface inherited by this interface.
 */
export interface AgencyOptions extends BaseAgentConfig {
  /**
   * Named roster of sub-agents.  Each value is either a `BaseAgentConfig`
   * object (the agency will instantiate it) or a pre-built `Agent` instance.
   */
  agents: Record<string, BaseAgentConfig | Agent>;
  /**
   * Orchestration strategy for coordinating sub-agents.
   * Defaults to `"sequential"` when omitted.
   */
  strategy?: AgencyStrategy;
  /**
   * Whether the orchestrator may override `strategy` at runtime based on
   * task complexity signals.
   */
  adaptive?: boolean;
  /**
   * Maximum number of orchestration rounds before the run is terminated.
   * Applies to iterative strategies like `"debate"` and `"review-loop"`.
   */
  maxRounds?: number;
}

// ---------------------------------------------------------------------------
// Result extension types
// ---------------------------------------------------------------------------

/**
 * Compiled strategy interface used internally by the agency orchestrator.
 * @internal
 */
export interface CompiledStrategy {
  /**
   * Execute the compiled strategy and return the aggregated result.
   *
   * @param prompt - User prompt.
   * @param opts - Optional per-call overrides.
   */
  execute(prompt: string, opts?: Record<string, unknown>): Promise<unknown>;
  /**
   * Stream the compiled strategy execution.
   *
   * @param prompt - User prompt.
   * @param opts - Optional per-call overrides.
   */
  stream(prompt: string, opts?: Record<string, unknown>): unknown;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when an `agency()` configuration is invalid (e.g. no agents defined,
 * unknown strategy, conflicting options).
 */
export class AgencyConfigError extends Error {
  /**
   * @param message - Human-readable description of the configuration problem.
   */
  constructor(message: string) {
    super(message);
    this.name = 'AgencyConfigError';
  }
}
