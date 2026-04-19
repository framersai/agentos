/**
 * @file types.ts
 * Shared configuration types for the AgentOS high-level Agency API.
 *
 * Defines `BaseAgentConfig` — the unified configuration shape accepted by both
 * `agent()` and `agency()` — together with all supporting sub-config interfaces,
 * event types, callback maps, and the discriminated `AgencyStreamPart` union.
 */
import type { AdaptableToolInput } from './runtime/toolAdapter.js';
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
 * - `"relational"` — social/relationship state, trust markers, and shared anchors.
 */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'prospective' | 'relational';
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
export type AgencyStrategy = 'sequential' | 'parallel' | 'debate' | 'review-loop' | 'hierarchical' | 'graph';
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
    agentAccess?: Record<string, {
        /** Override `topK` for this specific agent. */
        topK?: number;
        /** Restrict this agent to a subset of named collections. */
        collections?: string[];
    }>;
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
    /**
     * Run guardrails AFTER HITL approval to catch destructive actions.
     *
     * When enabled (default), even after a tool call is approved by the HITL
     * handler (auto-approve, LLM judge, or human), the configured guardrails
     * run a final safety check against the tool call arguments. If any
     * guardrail returns `action: 'block'`, the approval is overridden and the
     * tool call is denied.
     *
     * Set to `false` to disable this safety net and give full autonomy to the
     * HITL handler's decision.
     *
     * @default true
     */
    guardrailOverride?: boolean;
    /**
     * Guardrail IDs to run as a post-approval safety check.
     *
     * Only evaluated when {@link guardrailOverride} is not `false`. These
     * guardrails are invoked after the HITL handler approves a tool call and
     * can veto the approval if they detect destructive patterns.
     *
     * @default ['pii-redaction', 'code-safety']
     */
    postApprovalGuardrails?: string[];
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
/** Runtime rendering mode for avatar presentation. */
export type AvatarRuntimeMode = 'static_portrait' | 'sprite_sheet' | 'rive_rig' | 'live2d_rig' | 'spine_rig' | 'video_loop' | 'phaser_sprite_actor';
/** Required and optional visual anchor assets (URLs). */
export interface AvatarAnchorAssets {
    /** Primary neutral portrait — required. */
    neutralPortrait: string;
    /** Expression variant sheet. */
    expressionSheet?: string;
    /** Full-body reference. */
    fullBody?: string;
    /** Additional portrait angles/expressions. */
    additionalPortraits?: string[];
}
/** Same character projected into a different visual style. */
export interface AvatarStyleProjection {
    /** Style name: 'photoreal', 'anime', 'pixel', 'geometric', etc. */
    style: string;
    /** Anchor assets in this style. */
    anchors: AvatarAnchorAssets;
}
/** Thresholds for detecting identity drift across regenerations. */
export interface AvatarDriftGuard {
    faceSimilarity?: number;
    silhouetteSimilarity?: number;
    paletteSimilarity?: number;
}
/** State inputs that drive avatar animation — populated by AgentOS systems. */
export interface AvatarBindingInputs {
    /** Whether the agent is currently speaking (from VoicePipeline). */
    speaking?: boolean;
    /** Discrete emotion label (from MoodEngine PAD mapping). */
    emotion?: string;
    /** Emotion intensity 0-1 (from MoodEngine). */
    intensity?: number;
    /** Stress level 0-1 (from MoodEngine). */
    stress?: number;
    /** Anger level 0-1 (from MoodEngine). */
    anger?: number;
    /** Affection level 0-1 (from RelationshipEngine). */
    affection?: number;
    /** Trust level 0-1 (from RelationshipEngine). */
    trust?: number;
    /** Relationship warmth 0-1 (from RelationshipEngine). */
    relationshipWarmth?: number;
}
/** Rive-specific artboard and state machine configuration. */
export interface AvatarRiveProfile {
    /** Rive file URL. */
    src: string;
    /** Artboard name within the Rive file. */
    artboard: string;
    /** State machine name. */
    stateMachine: string;
    /** Maps AvatarBindingInputs keys to Rive input names. */
    emotionInputMap?: Record<string, string>;
    /** Lip sync mode. */
    lipSyncMode?: 'none' | 'simple_open_close' | 'volume_reactive' | 'phoneme_groups';
}
/** Sprite sheet animation configuration. */
export interface AvatarSpriteProfile {
    /** Sprite sheet image URL. */
    sheetUrl: string;
    /** Width of each frame in pixels. */
    frameWidth: number;
    /** Height of each frame in pixels. */
    frameHeight: number;
    /** Named animations mapped to frame index arrays. */
    animations: Record<string, number[]>;
    /** Frames per second. */
    fps?: number;
}
/** Identity descriptors used to generate avatar images. */
export interface AvatarIdentityDescriptor {
    /** Character display name rendered on portraits. */
    displayName: string;
    /** Rough age bracket for body/face proportions. */
    ageBand: 'child' | 'teen' | 'young_adult' | 'adult' | 'elder';
    /** Free-text body shape hint (e.g. "athletic", "stocky"). */
    bodyType?: string;
    /** Detailed face description for the image generator prompt. */
    faceDescriptor: string;
    /** Hair colour, style, and length. */
    hairDescriptor?: string;
    /** Skin tone / texture descriptor. */
    skinDescriptor?: string;
    /** Scars, tattoos, birthmarks, prosthetics, etc. */
    distinguishingFeatures?: string;
    /** Art style notes (e.g. "anime cel-shaded", "photorealistic"). */
    styleNotes?: string;
}
/** Complete avatar identity with generated assets and face embedding. */
export interface AvatarIdentityPackage {
    /** Unique identifier for this package instance. */
    id: string;
    /** Character this identity belongs to. */
    characterId: string;
    /** Source identity descriptors used to generate images. */
    identity: AvatarIdentityDescriptor;
    /** Canonical anchor images for identity consistency. */
    anchors: {
        /** Neutral-expression portrait used as the drift-guard reference. */
        neutralPortrait: string;
        /** Emotion → image URL map (e.g. "happy" → url). */
        expressionSheet?: Record<string, string>;
        /** Emotion → animated emote URL map. */
        animatedEmotes?: Record<string, string>;
        /** Full-body reference image. */
        fullBody?: string;
        /** Extra angle reference images. */
        additionalAngles?: string[];
    };
    /** 512-dim face embedding extracted from the neutral portrait. */
    faceEmbedding?: number[];
    /** Drift detection thresholds for regeneration gating. */
    driftGuard: {
        /** Minimum cosine similarity to anchor embedding. */
        faceSimilarity: number;
        /** Whether to reject images below the similarity threshold. */
        rejectBelowThreshold: boolean;
        /** Maximum retries when generated face drifts too far. */
        maxRegenerationAttempts: number;
    };
    /** Image generation parameters for reproducibility. */
    generationConfig: {
        /** Model identifier (e.g. "flux-schnell"). */
        baseModel: string;
        /** Provider (e.g. "replicate", "stability"). */
        provider: string;
        /** Random seed for reproducible output. */
        seed?: number;
        /** Negative prompt to avoid unwanted artefacts. */
        negativePrompt?: string;
        /** Named style preset (provider-specific). */
        stylePreset?: string;
    };
    /** ISO-8601 creation timestamp. */
    createdAt: string;
    /** ISO-8601 last-updated timestamp. */
    updatedAt: string;
}
/** Avatar configuration — optional on BaseAgentConfig. */
export interface AvatarConfig {
    /** Enable avatar presentation. */
    enabled: boolean;
    /** Which rendering mode the consuming app should use. */
    runtimeMode: AvatarRuntimeMode;
    /** Canonical identity assets (URLs). */
    anchors: AvatarAnchorAssets;
    /** Same character in alternate visual styles. */
    styleProjections?: AvatarStyleProjection[];
    /** Identity consistency thresholds. */
    driftGuard?: AvatarDriftGuard;
    /** Rive-specific config (when runtimeMode is 'rive_rig'). */
    riveProfile?: AvatarRiveProfile;
    /** Sprite sheet config (when runtimeMode is 'sprite_sheet'). */
    spriteProfile?: AvatarSpriteProfile;
    /** Generated identity package with anchor images and face embedding. */
    identityPackage?: AvatarIdentityPackage;
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
     * Maximum number of retries when structured output validation fails.
     *
     * When `agent({ output: someZodSchema })` is set and the LLM returns text
     * that does not parse or validate against the schema, the agency will
     * retry the generation up to this many times, each time appending an
     * error feedback hint to the prompt so the model can self-correct.
     *
     * Defaults to `1` (one extra attempt = two total calls). Set to `0` to
     * disable retries entirely.
     */
    maxValidationRetries?: number;
    /**
     * Action taken when any resource limit is breached.
     * - `"stop"` — gracefully stop and return partial results.
     * - `"warn"` — emit a `limitReached` event and continue.
     * - `"error"` — throw an error and halt immediately.
     */
    onLimitReached?: 'stop' | 'warn' | 'error';
}
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
    /** Human-readable reason for the guardrail action. */
    reason?: string;
    /** Unix timestamp in milliseconds. */
    timestamp: number;
}
/**
 * Emitted when a post-approval guardrail overrides an HITL approval.
 *
 * This event fires after a tool call has been approved by the HITL handler
 * (auto-approve, LLM judge, or human) but a guardrail detected a
 * destructive pattern and vetoed the execution.
 */
export interface GuardrailHitlOverrideEvent {
    /** The guardrail ID that triggered the override. */
    guardrailId: string;
    /** Human-readable reason for the override. */
    reason: string;
    /** The tool name that was blocked. */
    toolName: string;
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
export type AgencyTraceEvent = AgentStartEvent | AgentEndEvent | HandoffEvent | ToolCallEvent | ForgeEvent | GuardrailEvent | LimitEvent;
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
    error?: (e: {
        agent: string;
        error: Error;
        timestamp: number;
    }) => void;
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
    /**
     * Called when a post-approval guardrail overrides an HITL approval.
     * Fires after a tool call was approved but a guardrail detected a
     * destructive pattern and vetoed the execution.
     */
    guardrailHitlOverride?: (e: GuardrailHitlOverrideEvent) => void;
}
/**
 * Discriminated union of all streaming events emitted by an `agency()` stream.
 * A superset of the base `StreamPart` type — includes all text/tool events
 * plus agency-level lifecycle events and the finalized post-processing snapshot.
 *
 * `text` parts are low-latency raw stream chunks. The finalized approved answer
 * is surfaced separately through the `final-output` part, `AgencyStreamResult.text`,
 * and `AgencyStreamResult.finalTextStream`.
 */
export type AgencyStreamPart = {
    type: 'text';
    text: string;
    agent?: string;
} | {
    type: 'tool-call';
    toolName: string;
    args: unknown;
    agent?: string;
} | {
    type: 'tool-result';
    toolName: string;
    result: unknown;
    agent?: string;
} | {
    type: 'error';
    error: Error;
    agent?: string;
} | {
    type: 'agent-start';
    agent: string;
    input: string;
} | {
    type: 'agent-end';
    agent: string;
    output: string;
    durationMs: number;
} | {
    type: 'agent-handoff';
    fromAgent: string;
    toAgent: string;
    reason: string;
} | {
    type: 'strategy-override';
    original: string;
    chosen: string;
    reason: string;
} | {
    type: 'emergent-forge';
    agentName: string;
    instructions: string;
    approved: boolean;
} | {
    type: 'guardrail-result';
    agent: string;
    guardrailId: string;
    passed: boolean;
    action: string;
} | {
    type: 'approval-requested';
    request: ApprovalRequest;
} | {
    type: 'approval-decided';
    requestId: string;
    approved: boolean;
} | {
    type: 'final-output';
    text: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUSD?: number;
    };
    agentCalls: AgentCallRecord[];
    parsed?: unknown;
    durationMs: number;
} | {
    type: 'permission-denied';
    agent: string;
    action: string;
    reason: string;
};
/**
 * Internal stream result shape returned by compiled agency strategies.
 *
 * Strategy compilers may return only the live iterables plus aggregate promises.
 * The outer `agency()` wrapper can enrich this into the public
 * {@link AgencyStreamResult}.
 *
 * This type exists for strategy authors. Most external callers should consume
 * {@link AgencyStreamResult} from `agency().stream(...)` instead.
 */
export interface CompiledStrategyStreamResult {
    /** Raw live text chunks from the strategy. */
    textStream?: AsyncIterable<string>;
    /** Structured live stream parts from the strategy. */
    fullStream?: AsyncIterable<AgencyStreamPart>;
    /** Final raw text assembled by the strategy, when available. */
    text?: Promise<string>;
    /** Aggregate usage for the strategy run, when available. */
    usage?: Promise<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUSD?: number;
    }>;
    /** Final per-agent ledger for the strategy run, when available. */
    agentCalls?: Promise<AgentCallRecord[]>;
}
/**
 * Public stream result returned by `agency().stream(...)`.
 *
 * This exposes both low-latency raw streaming and finalized post-processing
 * results so callers can choose the right trade-off for their UI or runtime.
 *
 * Prefer:
 * - `textStream` for raw token-by-token UX
 * - `fullStream` for structured lifecycle events
 * - `text` or `finalTextStream` for the finalized approved answer
 *
 * `textStream` may differ from the finalized answer when output guardrails or
 * `beforeReturn` HITL rewrite the result. `finalTextStream` and `text` always
 * reflect the finalized post-processing output.
 *
 * @example
 * ```ts
 * const stream = team.stream('Summarize HTTP/3 rollout risks.');
 *
 * for await (const chunk of stream.textStream) {
 *   process.stdout.write(chunk); // raw live output
 * }
 *
 * for await (const approved of stream.finalTextStream) {
 *   console.log('Approved answer:', approved);
 * }
 *
 * console.log(await stream.agentCalls);
 * console.log(await stream.text);
 * ```
 */
export interface AgencyStreamResult {
    /** Raw live text chunks from the underlying strategy. */
    textStream: AsyncIterable<string>;
    /**
     * Structured live + finalized event stream.
     *
     * This includes raw text/tool/lifecycle events and also the finalized
     * `final-output` event after post-processing completes.
     */
    fullStream: AsyncIterable<AgencyStreamPart>;
    /** Finalized scalar text after guardrails, HITL, and parsing hooks. */
    text: Promise<string>;
    /** Final aggregate usage for the streamed run. */
    usage: Promise<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUSD?: number;
    }>;
    /** Final per-agent execution ledger for the streamed run. */
    agentCalls: Promise<AgentCallRecord[]>;
    /**
     * Final structured payload; resolves to `undefined` when structured output
     * was not configured for the run.
     */
    parsed: Promise<unknown>;
    /**
     * Finalized approved-only text stream.
     *
     * Unlike `textStream`, this yields only the post-guardrail/post-HITL answer.
     * For most runs it emits a single finalized chunk.
     */
    finalTextStream: AsyncIterable<string>;
}
/**
 * Minimal stream result surface shared by both single-agent (`streamText`)
 * and multi-agent (`agency().stream()`) returns.
 *
 * Single agents return a {@link StreamTextResult} (from `streamText.ts`) which
 * has additional fields like `toolCalls`. Agencies return an
 * {@link AgencyStreamResult} which adds `agentCalls`, `parsed`, and
 * `finalTextStream`. Both are structurally assignable to this base type.
 *
 * The {@link Agent} interface uses this as the `stream()` return type so that
 * callers can swap between `agent()` and `agency()` without changing call
 * sites. Callers that need the richer surface should narrow to the concrete
 * sub-type.
 */
export interface AgentStreamResult {
    /** Async iterable yielding raw text chunks. */
    textStream: AsyncIterable<string>;
    /** Async iterable yielding all stream events (shape varies by implementation). */
    fullStream: AsyncIterable<unknown>;
    /** Resolves to the fully assembled text when the stream completes. */
    text: Promise<string>;
    /** Resolves to aggregated token usage when the stream completes. */
    usage: Promise<unknown>;
}
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
     * Streams a reply, returning a streaming result surface.
     *
     * Single agents return a `StreamTextResult` with `textStream`, `text`,
     * `usage`, and `toolCalls`. Agencies return an {@link AgencyStreamResult}
     * with additional `agentCalls`, `parsed`, and `finalTextStream` fields.
     * Both are assignable to {@link AgentStreamResult}.
     *
     * @param prompt - User prompt text.
     * @param opts - Optional per-call overrides.
     * @returns A streaming result with at least `textStream`, `fullStream`,
     *   `text`, and `usage`.
     */
    stream(prompt: string, opts?: Record<string, unknown>): AgentStreamResult;
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
    }): Promise<{
        port: number;
        url: string;
        close: () => Promise<void>;
    }>;
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
/**
 * Full shared configuration accepted across AgentOS API surfaces.
 *
 * Acceptance is intentionally broader than enforcement. The lightweight
 * `agent()` helper, low-level generation helpers, and full runtime do not wire
 * every field at the same depth. For the exact per-surface support level, see
 * the runtime capability contract.
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
     * Upper bound on completion tokens for each LLM call the agent makes.
     * Forwarded to the underlying `generateText` / `streamText` call on
     * every `generate()`, `stream()`, and `session.send()` invocation.
     *
     * Caps tail spend when a model misbehaves and yaps past the intended
     * output size — without it, calls fall back to the provider default
     * (OpenAI 4096, Anthropic 4096-8192). Set to ~2× the agent's typical
     * response size so normal calls finish naturally and only runaway
     * generations hit the cap. Omit to use the provider default.
     */
    maxTokens?: number;
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
    security?: {
        tier: SecurityTier;
    };
    /** Fine-grained tool and resource permission overrides. */
    permissions?: PermissionsConfig;
    /** Human-in-the-loop approval configuration. */
    hitl?: HitlConfig;
    /** Emergent agent synthesis configuration. */
    emergent?: EmergentConfig;
    /** Voice interface configuration. */
    voice?: VoiceConfig;
    /** Avatar visual presentation configuration. */
    avatar?: AvatarConfig;
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
    /**
     * Cognitive mechanisms config — 8 neuroscience-backed memory mechanisms.
     * All HEXACO-modulated (emotionality, conscientiousness, openness, etc.).
     *
     * - Pass `{}` for sensible defaults (all 8 mechanisms enabled).
     * - Omit entirely to disable (zero overhead — no code paths execute).
     * - Provide per-mechanism overrides to tune individual parameters.
     *
     * Requires `memory` to be enabled (`true` or a `MemoryConfig` object).
     * If `cognitiveMechanisms` is set but `memory` is disabled, a warning is logged
     * and the mechanisms config is ignored.
     *
     * @see {@link https://docs.agentos.sh/memory/cognitive-mechanisms | Cognitive Mechanisms Docs}
     */
    cognitiveMechanisms?: import('../memory/mechanisms/types.js').CognitiveMechanismsConfig;
}
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
 * See `BaseAgentConfig` for the shared config surface inherited by this interface.
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
     * @returns The internal strategy stream surface consumed by the outer
     *   `agency()` wrapper.
     */
    stream(prompt: string, opts?: Record<string, unknown>): CompiledStrategyStreamResult;
}
/**
 * Thrown when an `agency()` configuration is invalid (e.g. no agents defined,
 * unknown strategy, conflicting options).
 */
export declare class AgencyConfigError extends Error {
    /**
     * @param message - Human-readable description of the configuration problem.
     */
    constructor(message: string);
}
//# sourceMappingURL=types.d.ts.map