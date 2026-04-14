/**
 * @file generateText.ts
 * Stateless, single-call text generation for the AgentOS high-level API.
 *
 * Parses a `provider:model` string, resolves credentials from environment
 * variables or caller-supplied overrides, and invokes the provider's completion
 * endpoint.  Multi-step tool calling is supported: the loop continues until the
 * model produces a plain-text reply or `maxSteps` is exhausted.
 *
 * When `planning` is enabled, an upfront LLM call decomposes the user's request
 * into numbered steps before the tool loop starts.  The plan is injected into
 * the system prompt so the tool loop executes with awareness of the strategy.
 */
import { randomUUID } from 'node:crypto';
import { resolveModelOption, resolveProvider, createProviderManager } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { adaptTools, type AdaptableToolInput } from './runtime/toolAdapter.js';
import type { AgentOSUsageLedgerOptions } from './runtime/usageLedger.js';
import { resolveDynamicToolCalls } from './runtime/dynamicToolCalling.js';
import type { ITool, ToolExecutionContext } from '../core/tools/ITool.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
import type { AgentCallRecord, AgencyTraceEvent } from './types.js';
import type { IModelRouter, ModelRouteParams } from '../core/llm/routing/IModelRouter.js';
import type {
  MessageContent,
  MessageContentPart,
} from '../core/llm/providers/IProvider.js';

// Re-export multimodal types for downstream consumers
export type { MessageContent, MessageContentPart };

async function recordAgentOSUsageLazy(
  input: Parameters<typeof import('./runtime/usageLedger.js')['recordAgentOSUsage']>[0]
): Promise<boolean> {
  const { recordAgentOSUsage } = await import('./runtime/usageLedger.js');
  return recordAgentOSUsage(input);
}

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
export function extractTextFromContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof (p as any).text === 'string')
    .map((p) => p.text)
    .join('\n');
}

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

// ---------------------------------------------------------------------------
// Generation lifecycle hook types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Chain-of-thought helpers
// ---------------------------------------------------------------------------

/**
 * Default chain-of-thought instruction prepended to the system prompt when
 * tools are available and `chainOfThought` is enabled.  Encourages the model
 * to reason explicitly before selecting a tool or crafting a response.
 */
export const DEFAULT_COT_INSTRUCTION = `Before choosing an action, briefly reason about what you need to do and why. Consider:
1. What information do you already have?
2. What information do you need?
3. Which tool is most appropriate and why?
4. How does your communication style (from the Personality section, if present) influence how you should frame your response?
Then proceed with your tool call or response.`;

/**
 * Resolves the chain-of-thought instruction from the `chainOfThought` option.
 *
 * @param cot - The `chainOfThought` option value.
 * @returns The resolved CoT instruction string, or `undefined` if disabled.
 *
 * @internal
 */
export function resolveChainOfThought(cot: boolean | string | undefined): string | undefined {
  if (!cot) return undefined;
  if (typeof cot === 'string') return cot;
  return DEFAULT_COT_INSTRUCTION;
}

// ---------------------------------------------------------------------------
// Planning helpers
// ---------------------------------------------------------------------------

/**
 * Default system prompt used when planning is enabled without a custom prompt.
 * Instructs the model to decompose the user's request into a numbered JSON plan.
 */
const DEFAULT_PLANNING_SYSTEM_PROMPT = `You are planning how to accomplish the user's request. Break it into numbered steps.
Describe what tools you'll need for each step. Output a JSON plan:
{"steps": [{"description": "...", "tool": "tool_name_or_null", "reasoning": "..."}]}
Return ONLY the JSON object — no markdown fences, no commentary.`;

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
export async function createPlan(
  provider: { generateCompletion: (...args: any[]) => Promise<any> },
  modelId: string,
  userMessages: Array<Record<string, unknown>>,
  toolNames: string[],
  config: PlanningConfig | undefined,
  totalUsage: TokenUsage,
): Promise<Plan | undefined> {
  const systemPrompt = config?.systemPrompt ?? DEFAULT_PLANNING_SYSTEM_PROMPT;
  const temperature = config?.temperature ?? 0.2;
  const maxTokens = config?.maxTokens ?? 2048;

  // Build the planning conversation: system prompt + user context
  const planMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
  ];

  // Inject available tool names so the planner knows what's available
  if (toolNames.length > 0) {
    planMessages.push({
      role: 'system',
      content: `Available tools: ${toolNames.join(', ')}`,
    });
  }

  // Append the user messages so the planner can see the actual request
  for (const msg of userMessages) {
    planMessages.push(msg);
  }

  const response = await provider.generateCompletion(modelId, planMessages, {
    temperature,
    maxTokens,
  });

  // Accumulate planning call usage
  if (response.usage) {
    totalUsage.promptTokens += response.usage.promptTokens ?? 0;
    totalUsage.completionTokens += response.usage.completionTokens ?? 0;
    totalUsage.totalTokens += response.usage.totalTokens ?? 0;
    if (typeof response.usage.costUSD === 'number') {
      totalUsage.costUSD = (totalUsage.costUSD ?? 0) + response.usage.costUSD;
    }
  }

  const rawContent = response.choices?.[0]?.message?.content;
  const planText = typeof rawContent === 'string' ? rawContent : '';

  try {
    const parsed = JSON.parse(planText);
    if (Array.isArray(parsed.steps)) {
      return {
        steps: parsed.steps.map((s: any) => ({
          description: String(s.description ?? ''),
          tool: s.tool ?? null,
          reasoning: String(s.reasoning ?? ''),
        })),
      };
    }
  } catch {
    // If the model returns malformed JSON, fall through gracefully —
    // the tool loop will still proceed, just without an explicit plan.
  }
  return undefined;
}

/**
 * Formats a {@link Plan} into a human-readable string suitable for injection
 * into the system prompt of the tool-calling loop.
 *
 * @param plan - The plan to format.
 * @returns A multi-line string with numbered steps.
 *
 * @internal
 */
function formatPlanForPrompt(plan: Plan): string {
  const lines = plan.steps.map(
    (s, i) =>
      `${i + 1}. ${s.description}${s.tool ? ` [tool: ${s.tool}]` : ''}`,
  );
  return `Follow this plan:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Fallback helpers
// ---------------------------------------------------------------------------

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
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  // HTTP status codes that warrant a provider switch
  if (/\b(402|429|500|502|503|504|401|403)\b/.test(msg)) return true;
  // Network-level failures
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg)) return true;
  return false;
}

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
export function buildFallbackChain(
  excludeProvider?: string,
): FallbackProviderEntry[] {
  const chain: FallbackProviderEntry[] = [];

  if (process.env.OPENAI_API_KEY && excludeProvider !== 'openai') {
    chain.push({ provider: 'openai', model: 'gpt-4o-mini' });
  }
  if (process.env.ANTHROPIC_API_KEY && excludeProvider !== 'anthropic') {
    chain.push({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  }
  if (process.env.OPENROUTER_API_KEY && excludeProvider !== 'openrouter') {
    chain.push({ provider: 'openrouter' });
  }
  if (process.env.GEMINI_API_KEY && excludeProvider !== 'gemini') {
    chain.push({ provider: 'gemini' });
  }

  return chain;
}

function buildHelperToolExecutionContext(
  source: 'generateText',
  runId: string,
  stepIndex: number,
  correlationId?: string,
): ToolExecutionContext {
  return {
    gmiId: `${source}:${runId}`,
    personaId: `${source}:persona`,
    userContext: {
      userId: 'system',
      source,
    },
    correlationId: correlationId ?? `${source}:tool:${stepIndex + 1}:${randomUUID()}`,
    sessionData: {
      sessionId: `${source}:${runId}`,
      source,
      stepIndex,
    },
  };
}

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
export async function generateText(opts: GenerateTextOptions): Promise<GenerateTextResult> {
  const startedAt = Date.now();
  let metricStatus: 'ok' | 'error' = 'ok';
  let metricUsage: TokenUsage | undefined;
  let metricProviderId: string | undefined;
  let metricModelId: string | undefined;

  try {
    return await withAgentOSSpan('agentos.api.generate_text', async (span) => {
      let { providerId, modelId } = resolveModelOption(opts, 'text');

      // --- Model routing (optional) ---
      if (opts.router) {
        try {
          const toolNames = opts.tools
            ? (Array.isArray(opts.tools)
                ? opts.tools
                : [...((opts.tools as any).values?.() ?? [])]
              )
                .map((t: any) => t.name ?? t.function?.name)
                .filter(Boolean) as string[]
            : [];
          const routeParams: ModelRouteParams = {
            taskHint:
              opts.routerParams?.taskHint ?? (typeof opts.system === 'string' ? opts.system : undefined) ?? opts.prompt ?? '',
            requiredCapabilities:
              opts.routerParams?.requiredCapabilities ??
              (toolNames.length > 0 ? ['function_calling'] : undefined),
            optimizationPreference:
              opts.routerParams?.optimizationPreference ?? 'balanced',
            ...opts.routerParams,
          };
          const routeResult = await opts.router.selectModel(
            routeParams,
            undefined,
          );
          if (routeResult) {
            providerId =
              routeResult.modelInfo?.providerId ?? providerId;
            modelId = routeResult.modelId;
          }
        } catch (routerErr) {
          console.warn(
            '[agentos] Model router error, falling back to standard resolution:',
            routerErr,
          );
        }
      }

      const resolved = resolveProvider(providerId, modelId, {
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
      });
      const manager = await createProviderManager(resolved);
      metricProviderId = resolved.providerId;
      metricModelId = resolved.modelId;

      const provider = manager.getProvider(resolved.providerId);
      if (!provider) throw new Error(`Provider ${resolved.providerId} not available.`);

      span?.setAttribute('llm.provider', resolved.providerId);
      span?.setAttribute('llm.model', resolved.modelId);

      const tools = adaptTools(opts.tools);
      const toolMap = new Map<string, ITool>();
      for (const t of tools) toolMap.set(t.name, t);
      const helperToolRunId = randomUUID();

      // Build messages
      const messages: Array<Record<string, unknown>> = [];

      // --- Chain-of-thought injection ---
      // When CoT is enabled and tools are provided, prepend a reasoning
      // instruction to the system prompt so the model explicitly reasons
      // before selecting a tool or composing a response.
      const cotInstruction = resolveChainOfThought(opts.chainOfThought);
      const hasTools = tools.length > 0;

      if (typeof opts.system === 'string' || !opts.system) {
        // Plain string system prompt (existing behavior)
        if (cotInstruction && hasTools) {
          const systemContent = opts.system
            ? `${cotInstruction}\n\n${opts.system}`
            : cotInstruction;
          messages.push({ role: 'system', content: systemContent });
        } else if (opts.system) {
          messages.push({ role: 'system', content: opts.system });
        }
      } else {
        // Structured SystemContentBlock[] — convert to content parts with cache_control
        const blocks = opts.system as SystemContentBlock[];
        const parts = blocks.map(block => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cacheBreakpoint ? { cache_control: { type: 'ephemeral' as const } } : {}),
        }));

        // Prepend CoT instruction as the first non-cached block if needed
        if (cotInstruction && hasTools) {
          parts.unshift({ type: 'text' as const, text: cotInstruction });
        }

        messages.push({ role: 'system', content: parts });
      }

      if (opts.messages) {
        for (const m of opts.messages) messages.push({ role: m.role, content: m.content });
      }
      if (opts.prompt) messages.push({ role: 'user', content: opts.prompt });

      span?.setAttribute('agentos.api.tool_count', tools.length);

      const toolSchemas =
        tools.length > 0
          ? tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }))
          : undefined;

      const allToolCalls: ToolCallRecord[] = [];
      const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const maxSteps = opts.maxSteps ?? 1;
      span?.setAttribute('agentos.api.max_steps', maxSteps);

      // -----------------------------------------------------------------
      // Planning phase (optional)
      // When `opts.planning` is truthy, make one LLM call to decompose the
      // task into a numbered step list.  The plan is injected into the
      // message array as a system message so the tool loop is plan-aware.
      // -----------------------------------------------------------------
      let resolvedPlan: Plan | undefined;
      const planningEnabled = !!opts.planning;
      span?.setAttribute('agentos.api.planning_enabled', planningEnabled);

      if (planningEnabled) {
        const planConfig = typeof opts.planning === 'object' ? opts.planning : undefined;

        // Collect only user-role messages for the planner
        const userMessages = messages.filter((m) => m.role === 'user');
        const toolNames = tools.map((t) => t.name);

        resolvedPlan = await createPlan(
          provider,
          resolved.modelId,
          userMessages,
          toolNames,
          planConfig,
          totalUsage,
        );

        if (resolvedPlan) {
          // Inject the plan as a system message right after any existing
          // system messages so the tool loop executes plan-aware.
          const planPrompt = formatPlanForPrompt(resolvedPlan);
          const firstNonSystem = messages.findIndex((m) => m.role !== 'system');
          const insertIdx = firstNonSystem === -1 ? messages.length : firstNonSystem;
          messages.splice(insertIdx, 0, { role: 'system', content: planPrompt });
          span?.setAttribute('agentos.api.plan_steps', resolvedPlan.steps.length);
        }
      }

      for (let step = 0; step < maxSteps; step++) {
        // --- onBeforeGeneration hook ---
        let effectiveMessages = messages;
        if (opts.onBeforeGeneration) {
          try {
            const hookCtx: GenerationHookContext = {
              messages: [...messages] as any,
              system: opts.system,
              tools: Array.from(toolMap.values()),
              model: resolved.modelId,
              provider: resolved.providerId,
              step,
              prompt: opts.prompt,
            };
            const modified = await opts.onBeforeGeneration(hookCtx);
            if (modified) {
              effectiveMessages = modified.messages as any;
            }
          } catch (hookErr) {
            console.warn('[agentos] onBeforeGeneration hook error:', hookErr);
          }
        }

        const response = await withAgentOSSpan(
          'agentos.api.generate_text.step',
          async (stepSpan) => {
            stepSpan?.setAttribute('llm.provider', resolved.providerId);
            stepSpan?.setAttribute('llm.model', resolved.modelId);
            stepSpan?.setAttribute('agentos.api.step', step + 1);
            stepSpan?.setAttribute('agentos.api.tool_count', tools.length);

            const stepResponse = await provider.generateCompletion(
              resolved.modelId,
              effectiveMessages as any,
              {
                tools: toolSchemas,
                temperature: opts.temperature,
                maxTokens: opts.maxTokens,
              } as any
            );
            attachUsageAttributes(stepSpan, {
              promptTokens: stepResponse.usage?.promptTokens,
              completionTokens: stepResponse.usage?.completionTokens,
              totalTokens: stepResponse.usage?.totalTokens,
              costUSD: stepResponse.usage?.costUSD,
            });
            return stepResponse;
          }
        );

        if (response.usage) {
          totalUsage.promptTokens += response.usage.promptTokens ?? 0;
          totalUsage.completionTokens += response.usage.completionTokens ?? 0;
          totalUsage.totalTokens += response.usage.totalTokens ?? 0;
          if (typeof response.usage.costUSD === 'number') {
            totalUsage.costUSD = (totalUsage.costUSD ?? 0) + response.usage.costUSD;
          }
        }

        const choice = response.choices?.[0];
        if (!choice) break;

        const content = choice.message?.content;
        let textContent = typeof content === 'string' ? content : ((content as any)?.text ?? '');
        let toolCallsInChoice = resolveDynamicToolCalls(choice.message?.tool_calls, {
          text: textContent,
          step,
          toolsAvailable: tools.length > 0,
        });

        // --- onAfterGeneration hook ---
        if (opts.onAfterGeneration) {
          try {
            const stepUsage: TokenUsage = {
              promptTokens: response.usage?.promptTokens ?? 0,
              completionTokens: response.usage?.completionTokens ?? 0,
              totalTokens: response.usage?.totalTokens ?? 0,
              costUSD: response.usage?.costUSD,
            };
            const toolCallRecords: ToolCallRecord[] = toolCallsInChoice.map((tc: any) => ({
              name: (tc as any).function?.name ?? (tc as any).name ?? '',
              args: (tc as any).function?.arguments ?? '{}',
            }));
            const hookResult: GenerationHookResult = {
              text: textContent,
              toolCalls: toolCallRecords,
              usage: stepUsage,
              step,
            };
            const modified = await opts.onAfterGeneration(hookResult);
            if (modified) {
              textContent = modified.text;
              if (modified.toolCalls.length === 0 && toolCallsInChoice.length > 0) {
                toolCallsInChoice = [];
              }
            }
          } catch (hookErr) {
            console.warn('[agentos] onAfterGeneration hook error:', hookErr);
          }
        }

        if (textContent && toolCallsInChoice.length === 0) {
          metricUsage = totalUsage;
          span?.setAttribute('agentos.api.finish_reason', choice.finishReason ?? 'stop');
          span?.setAttribute('agentos.api.tool_calls', allToolCalls.length);
          attachUsageAttributes(span, totalUsage);
          return {
            provider: resolved.providerId,
            model: resolved.modelId,
            text: textContent,
            usage: totalUsage,
            toolCalls: allToolCalls,
            finishReason: (choice.finishReason ?? 'stop') as GenerateTextResult['finishReason'],
            plan: resolvedPlan,
          };
        }

        if (toolCallsInChoice.length > 0) {
          messages.push({
            role: 'assistant',
            content: textContent || null,
            tool_calls: toolCallsInChoice,
          } as any);

          for (const tc of toolCallsInChoice) {
            const fnName = (tc as any).function?.name ?? (tc as any).name ?? '';
            const fnArgs = (tc as any).function?.arguments ?? '{}';
            const tcId = (tc as any).id ?? '';
            const tool = toolMap.get(fnName);
            const record: ToolCallRecord = {
              name: fnName,
              args: fnArgs,
            };

            let parsedArgs: unknown;
            try {
              parsedArgs =
                typeof fnArgs === 'string' ? JSON.parse(fnArgs) : fnArgs;
              record.args = parsedArgs;
            } catch {
              record.error = `Tool "${fnName}" arguments were not valid JSON.`;
              messages.push({
                role: 'tool',
                tool_call_id: tcId,
                content: JSON.stringify({ error: record.error }),
              } as any);
              allToolCalls.push(record);
              continue;
            }

            // --- onBeforeToolExecution hook ---
            if (opts.onBeforeToolExecution) {
              try {
                const hookInfo: ToolCallHookInfo = {
                  name: fnName,
                  args: parsedArgs as Record<string, unknown>,
                  id: tcId || '',
                  step,
                };
                const hookResult = await opts.onBeforeToolExecution(hookInfo);
                if (hookResult === null) {
                  record.error = 'Skipped by onBeforeToolExecution hook';
                  messages.push({
                    role: 'tool',
                    tool_call_id: tcId,
                    content: JSON.stringify({ skipped: true }),
                  } as any);
                  allToolCalls.push(record);
                  continue;
                }
                parsedArgs = hookResult.args;
              } catch (hookErr) {
                console.warn('[agentos] onBeforeToolExecution hook error:', hookErr);
              }
            }

            if (tool) {
              try {
                const result = await tool.execute(
                  parsedArgs as any,
                  buildHelperToolExecutionContext(
                    'generateText',
                    helperToolRunId,
                    step,
                    tcId || undefined,
                  ),
                );
                record.result = result.output;
                record.error = result.success ? undefined : result.error;
                messages.push({
                  role: 'tool',
                  tool_call_id: tcId,
                  content: JSON.stringify(result.output ?? result.error ?? ''),
                } as any);
              } catch (err: any) {
                record.error = err?.message;
                messages.push({
                  role: 'tool',
                  tool_call_id: tcId,
                  content: JSON.stringify({ error: err?.message }),
                } as any);
              }
            } else {
              record.error = `Tool "${fnName}" not found.`;
              messages.push({
                role: 'tool',
                tool_call_id: tcId,
                content: JSON.stringify({ error: record.error }),
              } as any);
            }
            allToolCalls.push(record);
          }
          continue;
        }

        metricUsage = totalUsage;
        span?.setAttribute('agentos.api.finish_reason', choice.finishReason ?? 'stop');
        span?.setAttribute('agentos.api.tool_calls', allToolCalls.length);
        attachUsageAttributes(span, totalUsage);
        return {
          provider: resolved.providerId,
          model: resolved.modelId,
          text: textContent,
          usage: totalUsage,
          toolCalls: allToolCalls,
          finishReason: (choice.finishReason ?? 'stop') as GenerateTextResult['finishReason'],
          plan: resolvedPlan,
        };
      }

      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      metricUsage = totalUsage;
      span?.setAttribute('agentos.api.finish_reason', 'tool-calls');
      span?.setAttribute('agentos.api.tool_calls', allToolCalls.length);
      attachUsageAttributes(span, totalUsage);
      return {
        provider: resolved.providerId,
        model: resolved.modelId,
        text: (lastAssistant?.content as string) ?? '',
        usage: totalUsage,
        toolCalls: allToolCalls,
        finishReason: 'tool-calls',
        plan: resolvedPlan,
      };
    });
  } catch (error) {
    // ── Fallback chain ────────────────────────────────────────────────
    // When the primary provider fails with a retryable error and
    // fallbackProviders are configured, try each fallback in order.
    // The first successful response wins; if all fail, the last error
    // is re-thrown.
    if (
      opts.fallbackProviders?.length &&
      isRetryableError(error)
    ) {
      let lastError = error;
      for (const fb of opts.fallbackProviders) {
        try {
          opts.onFallback?.(
            lastError instanceof Error ? lastError : new Error(String(lastError)),
            fb.provider,
          );
          // Build a new options object targeting the fallback provider,
          // stripping the fallbackProviders to prevent recursive fallback.
          const fallbackResult = await generateText({
            ...opts,
            provider: fb.provider,
            model: fb.model,
            // Clear explicit keys/URLs so resolution uses env vars for the
            // fallback provider rather than the primary's overrides.
            apiKey: undefined,
            baseUrl: undefined,
            fallbackProviders: undefined,
            onFallback: undefined,
          });
          metricStatus = 'ok';
          metricUsage = fallbackResult.usage;
          metricProviderId = fallbackResult.provider;
          metricModelId = fallbackResult.model;
          return fallbackResult;
        } catch (fbError) {
          lastError = fbError;
        }
      }
      // All fallbacks exhausted — fall through to throw
      metricStatus = 'error';
      throw lastError;
    }

    metricStatus = 'error';
    throw error;
  } finally {
    try {
      await recordAgentOSUsageLazy({
        providerId: metricProviderId,
        modelId: metricModelId,
        usage: metricUsage,
        options: {
          ...opts.usageLedger,
          source: opts.usageLedger?.source ?? 'generateText',
        },
      });
    } catch {
      // Helper-level usage persistence is best-effort and should not break generation.
    }
    recordAgentOSTurnMetrics({
      durationMs: Date.now() - startedAt,
      status: metricStatus,
      usage: toTurnMetricUsage(metricUsage),
    });
  }
}
