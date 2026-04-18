import { type AdaptableToolInput } from './runtime/toolAdapter.js';
import type { AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
import type { ITool } from '../core/tools/ITool.js';
import type { AgentCallRecord, AgencyTraceEvent } from './types.js';
import type { IModelRouter, ModelRouteParams } from '../core/llm/routing/IModelRouter.js';
import type { MessageContent, MessageContentPart } from '../core/llm/providers/IProvider.js';
export type { MessageContent, MessageContentPart };
/**
 * A single chat message in a conversation history.
 * Mirrors the OpenAI / Anthropic message shape accepted by provider adapters.
 */
export interface Message {
    /** Role of the message author. */
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** Content of the message. String for text-only, array for multimodal (images + text). */
    content: MessageContent;
}
/**
 * Extract plain text from a MessageContent value.
 * For strings, returns as-is. For arrays, concatenates text parts.
 */
export declare function extractTextFromContent(content: MessageContent): string;
/**
 * Record of a single tool invocation performed during a {@link generateText} call.
 * One record is appended per tool call, regardless of whether the call succeeded.
 */
export interface ToolCallRecord {
    /** Name of the tool as registered in the `tools` map. */
    name: string;
    /** Parsed arguments supplied by the model. */
    args: unknown;
    /** Return value from the tool's `execute` function (present on success). */
    result?: unknown;
    /** Error message when the tool threw or returned a failure result. */
    error?: string;
}
/**
 * Token consumption figures reported by the provider for a single completion call.
 * All values are approximate and provider-dependent.
 */
export interface TokenUsage {
    /** Number of tokens in the prompt / input sent to the model. */
    promptTokens: number;
    /** Number of tokens in the model's response. */
    completionTokens: number;
    /** Sum of `promptTokens` and `completionTokens`. */
    totalTokens: number;
    /** Total cost reported by the provider across all steps, when available. */
    costUSD?: number;
    /**
     * Tokens served from the provider's prompt-prefix cache. When present,
     * these were billed at the cache-read rate (0.1× input price on
     * Anthropic) and are NOT also counted in `promptTokens`. Callers that
     * want total tokens-ever-sent should add `promptTokens + cacheReadTokens
     * + cacheCreationTokens`.
     *
     * Undefined when the provider does not report cache usage (OpenAI's
     * auto-cache does not expose this at the per-call layer; Anthropic
     * does via `cache_read_input_tokens`).
     */
    cacheReadTokens?: number;
    /**
     * Tokens written to the provider's prompt-prefix cache as a new cache
     * entry. Billed at the cache-creation rate (1.25× input price on
     * Anthropic for 5-minute TTL, 2× for 1-hour TTL). NOT also counted in
     * `promptTokens`. A `cacheReadTokens` of 0 and `cacheCreationTokens > 0`
     * indicates the first call that filled the cache; subsequent calls
     * with a cache hit flip the numbers.
     */
    cacheCreationTokens?: number;
}
/**
 * Configuration for the optional plan-then-execute planning phase.
 *
 * When `planning` is set to `true` on {@link GenerateTextOptions}, default
 * settings are used.  Pass a `PlanningConfig` object for fine-grained control
 * over the planning LLM call.
 */
export interface PlanningConfig {
    /**
     * Custom system prompt for the planning call.  When omitted a sensible
     * default that asks the model to produce a numbered JSON plan is used.
     */
    systemPrompt?: string;
    /**
     * Sampling temperature for the planning call.
     * Defaults to `0.2` (low creativity, high determinism for plans).
     */
    temperature?: number;
    /**
     * Hard token cap for the planning response.
     * Defaults to `2048`.
     */
    maxTokens?: number;
}
/**
 * A single step in a plan produced by the planning phase.
 * Serialised to / from the JSON plan the LLM emits.
 */
export interface PlanStep {
    /** Human-readable description of what this step accomplishes. */
    description: string;
    /** Name of the tool to invoke, or `null` when the step is pure reasoning. */
    tool: string | null;
    /** Short explanation of why this step is needed. */
    reasoning: string;
}
/**
 * The complete plan returned by {@link createPlan}.
 */
export interface Plan {
    /** Ordered list of steps the agent should follow. */
    steps: PlanStep[];
}
/**
 * Options for a {@link generateText} call.
 * Either `prompt` or `messages` (or both) must be provided.
 */
/**
 * A fallback provider entry specifying an alternative provider (and optionally
 * model) to try when the primary provider fails with a retryable error.
 *
 * @see {@link GenerateTextOptions.fallbackProviders}
 */
export interface FallbackProviderEntry {
    /** Provider identifier (e.g. `"openai"`, `"anthropic"`, `"openrouter"`). */
    provider: string;
    /** Model identifier override. When omitted, the provider's default text model is used. */
    model?: string;
}
/**
 * A structured block of system prompt content with optional cache breakpoint.
 * When `cacheBreakpoint` is true, providers that support prompt caching
 * (e.g., Anthropic) will mark this block's boundary for caching.
 */
export interface SystemContentBlock {
    /** The text content of this block. */
    text: string;
    /** When true, marks the end of this block as a cache boundary. */
    cacheBreakpoint?: boolean;
}
export interface GenerateTextOptions {
    /**
     * Provider name.  When supplied without `model`, the default text model for
     * the provider is resolved automatically from the built-in defaults registry.
     *
     * @example `"openai"`, `"anthropic"`, `"ollama"`
     */
    provider?: string;
    /**
     * Model identifier.  Accepted in two formats:
     * - `"provider:model"` — legacy format (e.g. `"openai:gpt-4o"`), still fully supported.
     * - Plain model name (e.g. `"gpt-4o-mini"`) when `provider` is also set.
     *
     * Either `provider` or `model` (or an API key env var for auto-detection) is required.
     */
    model?: string;
    /** Single user turn to append after any `messages`. Convenience alternative to building a `messages` array. */
    prompt?: string;
    /** System prompt injected as the first message. Accepts a plain string or structured blocks with cache breakpoints. */
    system?: string | SystemContentBlock[];
    /** Full conversation history. Appended before `prompt` when both are supplied. */
    messages?: Message[];
    /**
     * Tools the model may invoke.
     *
     * Accepted forms:
     * - named high-level tool maps
     * - external tool registries (`Record`, `Map`, or iterable)
     * - prompt-only `ToolDefinitionForLLM[]`
     *
     * Prompt-only definitions are visible to the model but return an explicit
     * tool error if the model invokes them without an executor.
     */
    tools?: AdaptableToolInput;
    /**
     * Maximum number of agentic steps (LLM calls) to execute before returning.
     * Each tool-call round trip counts as one step. Defaults to `1`.
     */
    maxSteps?: number;
    /** Sampling temperature forwarded to the provider (0–2 for most providers). */
    temperature?: number;
    /** Hard cap on output tokens. Provider-dependent default applies when omitted. */
    maxTokens?: number;
    /** Override the API key instead of reading from environment variables. */
    apiKey?: string;
    /** Override the provider base URL (useful for local proxies or Ollama). */
    baseUrl?: string;
    /** Optional durable usage ledger configuration for helper-level accounting. */
    usageLedger?: AgentOSUsageLedgerOptions;
    /**
     * Chain-of-thought instruction prepended to the system prompt when tools
     * are available.  Encourages the model to reason explicitly before choosing
     * an action.
     *
     * - `false` (default) — no CoT injection.
     * - `true` — inject the default CoT instruction.
     * - `string` — inject a custom CoT instruction.
     */
    chainOfThought?: boolean | string;
    /**
     * Enable plan-then-execute mode.  When `true` (or a {@link PlanningConfig}),
     * an upfront LLM call decomposes the task into numbered steps before the
     * tool-calling loop begins.  The plan is injected into the system prompt
     * so the model executes with full awareness of the strategy.
     *
     * Set to `false` or omit to skip planning entirely (the default).
     */
    planning?: boolean | PlanningConfig;
    /**
     * Ordered list of fallback providers to try when the primary provider fails
     * with a retryable error (HTTP 402/429/5xx, network errors, auth failures).
     *
     * Each entry specifies a provider and an optional model override.  When the
     * model is omitted, the provider's default text model (from
     * {@link PROVIDER_DEFAULTS}) is used.
     *
     * Providers are tried left-to-right; the first successful response wins.
     * When all fallbacks are exhausted, the last error is re-thrown.
     *
     * @example
     * ```ts
     * const result = await generateText({
     *   provider: 'anthropic',
     *   prompt: 'Hello',
     *   fallbackProviders: [
     *     { provider: 'openai', model: 'gpt-4o-mini' },
     *     { provider: 'openrouter' },
     *   ],
     * });
     * ```
     */
    fallbackProviders?: FallbackProviderEntry[];
    /**
     * Callback invoked when a fallback provider is about to be tried after the
     * primary (or a previous fallback) failed.  Useful for logging or metrics.
     *
     * @param error - The error that triggered the fallback.
     * @param fallbackProvider - The provider identifier being tried next.
     */
    onFallback?: (error: Error, fallbackProvider: string) => void;
    /**
     * Optional model router for intelligent provider/model selection.
     * When provided, the router's `selectModel()` is called before provider
     * resolution.  The router result overrides `model`/`provider`.
     * If the router returns `null`, falls back to standard resolution.
     */
    router?: IModelRouter;
    /**
     * Routing hints passed to the model router.  Extracted automatically
     * from system prompt and tool names when not provided.
     */
    routerParams?: Partial<ModelRouteParams>;
    /**
     * Called before each LLM generation step.  Can inject memory context
     * into messages, sanitize input via guardrails, or modify the prompt.
     * Return a modified context to transform input, or void to pass through.
     */
    onBeforeGeneration?: (context: GenerationHookContext) => Promise<GenerationHookContext | void>;
    /**
     * Called after each LLM generation step.  Can check output against
     * guardrails, redact PII, or transform the response.
     * Return a modified result to transform output, or void to pass through.
     */
    onAfterGeneration?: (result: GenerationHookResult) => Promise<GenerationHookResult | void>;
    /**
     * Called before each tool execution.  Can modify arguments, apply
     * permission checks, or return `null` to skip the tool call entirely.
     */
    onBeforeToolExecution?: (info: ToolCallHookInfo) => Promise<ToolCallHookInfo | null>;
    /**
     * @internal Used by generateObject to forward response_format to the provider.
     * Not part of the public API. Use generateObject for structured output.
     */
    _responseFormat?: {
        type: string;
    };
}
/**
 * The completed result returned by {@link generateText}.
 */
export interface GenerateTextResult {
    /** Provider identifier used for the final run. */
    provider: string;
    /** Resolved model identifier used for the run. */
    model: string;
    /** Final assistant text after all agentic steps have completed. */
    text: string;
    /** Aggregated token usage across all steps. */
    usage: TokenUsage;
    /** Ordered list of every tool call made during the run. */
    toolCalls: ToolCallRecord[];
    /**
     * Reason the model stopped generating.
     * - `"stop"` — natural end of response.
     * - `"length"` — `maxTokens` limit reached.
     * - `"tool-calls"` — loop exhausted `maxSteps` while still calling tools.
     * - `"error"` — provider returned an error.
     */
    finishReason: 'stop' | 'length' | 'tool-calls' | 'error';
    /**
     * Ordered records of every sub-agent call made during an `agency()` run.
     * `undefined` for plain `generateText` / `agent()` calls.
     */
    agentCalls?: AgentCallRecord[];
    /**
     * Structured trace events emitted during the run.
     * Populated by the agency orchestrator; `undefined` for single-agent calls.
     */
    trace?: AgencyTraceEvent[];
    /**
     * Parsed structured output produced when `BaseAgentConfig.output` is a Zod
     * schema.  `undefined` when no output schema is configured.
     */
    parsed?: unknown;
    /**
     * The plan produced by the planning phase when `planning` is enabled.
     * `undefined` when planning is disabled or was not requested.
     */
    plan?: Plan;
}
/**
 * Context available to pre-generation hooks.
 * Hooks may return a modified copy to transform the generation input.
 */
export interface GenerationHookContext {
    /** Current messages array (system + conversation + user). */
    messages: Message[];
    /** System prompt — plain string or structured blocks with cache breakpoints. */
    system: string | SystemContentBlock[] | undefined;
    /** Tool definitions available for this step. */
    tools: ITool[];
    /** Resolved model ID. */
    model: string;
    /** Resolved provider ID. */
    provider: string;
    /** Current agentic step index (0-based). */
    step: number;
    /** The original user prompt (from opts.prompt). */
    prompt: string | undefined;
}
/**
 * Context available to post-generation hooks.
 * Hooks may return a modified copy to transform the generation output.
 */
export interface GenerationHookResult {
    /** Generated text from the LLM. */
    text: string;
    /** Tool calls requested by the LLM. */
    toolCalls: ToolCallRecord[];
    /** Token usage for this step. */
    usage: TokenUsage;
    /** Current agentic step index (0-based). */
    step: number;
}
/**
 * Info about a tool call before execution.
 * Hooks may return a modified copy or `null` to skip execution.
 */
export interface ToolCallHookInfo {
    /** Tool name. */
    name: string;
    /** Parsed arguments. */
    args: Record<string, unknown>;
    /** Tool call ID from the LLM. */
    id: string;
    /** Current agentic step index. */
    step: number;
}
/**
 * Default chain-of-thought instruction prepended to the system prompt when
 * tools are available and `chainOfThought` is enabled.  Encourages the model
 * to reason explicitly before selecting a tool or crafting a response.
 */
export declare const DEFAULT_COT_INSTRUCTION = "Before choosing an action, briefly reason about what you need to do and why. Consider:\n1. What information do you already have?\n2. What information do you need?\n3. Which tool is most appropriate and why?\n4. How does your communication style (from the Personality section, if present) influence how you should frame your response?\nThen proceed with your tool call or response.";
/**
 * Resolves the chain-of-thought instruction from the `chainOfThought` option.
 *
 * @param cot - The `chainOfThought` option value.
 * @returns The resolved CoT instruction string, or `undefined` if disabled.
 *
 * @internal
 */
export declare function resolveChainOfThought(cot: boolean | string | undefined): string | undefined;
/**
 * Makes a single LLM call to create an execution plan before the tool loop.
 *
 * The plan is a lightweight JSON object containing ordered steps.  It is
 * injected into the system prompt for the subsequent tool loop so the model
 * executes with full awareness of the strategy.
 *
 * @param provider - The resolved LLM provider instance.
 * @param modelId - Model identifier to use for the planning call.
 * @param userMessages - The user-supplied messages that describe the task.
 * @param toolNames - Names of available tools (informational context for the planner).
 * @param config - Optional planning configuration overrides.
 * @param totalUsage - Mutable usage aggregator — the planning call's tokens are added here.
 * @returns The parsed {@link Plan}, or `undefined` if parsing fails gracefully.
 *
 * @internal
 */
export declare function createPlan(provider: {
    generateCompletion: (...args: any[]) => Promise<any>;
}, modelId: string, userMessages: Array<Record<string, unknown>>, toolNames: string[], config: PlanningConfig | undefined, totalUsage: TokenUsage): Promise<Plan | undefined>;
/**
 * HTTP status codes and network error patterns that indicate a transient or
 * provider-level failure worth retrying with a different provider.
 *
 * Matched status codes:
 * - `401` / `403` — authentication / authorization failure (key expired or wrong provider).
 * - `402` — payment required (quota exhausted).
 * - `429` — rate limit exceeded.
 * - `500` / `502` / `503` / `504` — server-side errors.
 *
 * Matched network errors:
 * - `fetch failed` — generic fetch rejection (DNS, TLS, etc.).
 * - `ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND` — socket-level failures.
 *
 * @param error - The error to inspect.
 * @returns `true` when the error is likely transient and a different provider
 *   might succeed; `false` for deterministic user-input errors.
 *
 * @internal
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Auto-discovers available LLM providers from well-known environment variables
 * and builds an ordered fallback chain.
 *
 * Each entry in the returned array contains a provider identifier and an
 * optional cheap model suitable for fallback use.  Providers are ordered by
 * general availability and cost-effectiveness:
 * 1. OpenAI (`gpt-4o-mini`)
 * 2. Anthropic (`claude-haiku-4-5-20251001`)
 * 3. OpenRouter (default model)
 * 4. Gemini (`gemini-2.5-flash`)
 *
 * @param excludeProvider - Provider to omit from the chain (typically the
 *   primary provider that already failed).
 * @returns An array of `{ provider, model? }` entries ready for use as
 *   {@link GenerateTextOptions.fallbackProviders}.
 *
 * @example
 * ```ts
 * // Primary is anthropic — build fallback chain from remaining providers
 * const chain = buildFallbackChain('anthropic');
 * // => [{ provider: 'openai', model: 'gpt-4o-mini' }, { provider: 'openrouter' }, ...]
 * ```
 */
export declare function buildFallbackChain(excludeProvider?: string): FallbackProviderEntry[];
/**
 * Stateless text generation with optional multi-step tool calling.
 *
 * Creates a temporary provider manager, executes one or more LLM completion
 * steps (each tool-call round trip counts as one step), and returns the final
 * assembled result.  Provider credentials are resolved from environment
 * variables unless overridden in `opts`.
 *
 * When `planning` is enabled, an upfront LLM call produces a step-by-step plan
 * that is then injected into the system prompt for the tool loop.
 *
 * @param opts - Generation options including model, prompt/messages, and optional tools.
 * @returns A promise that resolves to the final text, token usage, tool call log, and finish reason.
 *
 * @example
 * ```ts
 * const result = await generateText({
 *   model: 'openai:gpt-4o',
 *   prompt: 'Summarise the history of the Roman Empire in two sentences.',
 * });
 * console.log(result.text);
 * ```
 */
export declare function generateText(opts: GenerateTextOptions): Promise<GenerateTextResult>;
//# sourceMappingURL=generateText.d.ts.map