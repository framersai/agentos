/**
 * @file generateText.ts
 * Stateless, single-call text generation for the AgentOS high-level API.
 *
 * Parses a `provider:model` string, resolves credentials from environment
 * variables or caller-supplied overrides, and invokes the provider's completion
 * endpoint.  Multi-step tool calling is supported: the loop continues until the
 * model produces a plain-text reply or `maxSteps` is exhausted.
 */
import { resolveModelOption, resolveProvider, createProviderManager } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { adaptTools, type ToolDefinitionMap } from './toolAdapter.js';
import { recordAgentOSUsage, type AgentOSUsageLedgerOptions } from './usageLedger.js';
import type { ITool } from '../core/tools/ITool.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../core/observability/otel.js';

/**
 * A single chat message in a conversation history.
 * Mirrors the OpenAI / Anthropic message shape accepted by provider adapters.
 */
export interface Message {
  /** Role of the message author. */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain-text or serialised-JSON content of the message. */
  content: string;
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
 * Options for a {@link generateText} call.
 * Either `prompt` or `messages` (or both) must be provided.
 */
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
  /** System prompt injected as the first message. */
  system?: string;
  /** Full conversation history. Appended before `prompt` when both are supplied. */
  messages?: Message[];
  /** Named tools the model may invoke. Values are {@link ToolDefinition} objects or {@link ITool} instances. */
  tools?: ToolDefinitionMap;
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
}

/**
 * Stateless text generation with optional multi-step tool calling.
 *
 * Creates a temporary provider manager, executes one or more LLM completion
 * steps (each tool-call round trip counts as one step), and returns the final
 * assembled result.  Provider credentials are resolved from environment
 * variables unless overridden in `opts`.
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
    return await withAgentOSSpan(
      'agentos.api.generate_text',
      async (span) => {
        const { providerId, modelId } = resolveModelOption(opts, 'text');
        const resolved = resolveProvider(providerId, modelId, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
        const manager = await createProviderManager(resolved);
        metricProviderId = resolved.providerId;
        metricModelId = resolved.modelId;

        const provider = manager.getProvider(resolved.providerId);
        if (!provider) throw new Error(`Provider ${resolved.providerId} not available.`);

        span?.setAttribute('llm.provider', resolved.providerId);
        span?.setAttribute('llm.model', resolved.modelId);

        // Build messages
        const messages: Array<Record<string, unknown>> = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        if (opts.messages) {
          for (const m of opts.messages) messages.push({ role: m.role, content: m.content });
        }
        if (opts.prompt) messages.push({ role: 'user', content: opts.prompt });

        const tools = adaptTools(opts.tools);
        const toolMap = new Map<string, ITool>();
        for (const t of tools) toolMap.set(t.name, t);

        span?.setAttribute('agentos.api.tool_count', tools.length);

        const toolSchemas = tools.length > 0
          ? tools.map(t => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }))
          : undefined;

        const allToolCalls: ToolCallRecord[] = [];
        const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const maxSteps = opts.maxSteps ?? 1;
        span?.setAttribute('agentos.api.max_steps', maxSteps);

        for (let step = 0; step < maxSteps; step++) {
          const response = await withAgentOSSpan(
            'agentos.api.generate_text.step',
            async (stepSpan) => {
              stepSpan?.setAttribute('llm.provider', resolved.providerId);
              stepSpan?.setAttribute('llm.model', resolved.modelId);
              stepSpan?.setAttribute('agentos.api.step', step + 1);
              stepSpan?.setAttribute('agentos.api.tool_count', tools.length);

              const stepResponse = await provider.generateCompletion(
                resolved.modelId,
                messages as any,
                {
                  tools: toolSchemas,
                  temperature: opts.temperature,
                  maxTokens: opts.maxTokens,
                } as any,
              );
              attachUsageAttributes(stepSpan, {
                promptTokens: stepResponse.usage?.promptTokens,
                completionTokens: stepResponse.usage?.completionTokens,
                totalTokens: stepResponse.usage?.totalTokens,
                costUSD: stepResponse.usage?.costUSD,
              });
              return stepResponse;
            },
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
          const textContent = typeof content === 'string' ? content : (content as any)?.text ?? '';
          const toolCallsInChoice = choice.message?.tool_calls ?? [];

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
                args: JSON.parse(typeof fnArgs === 'string' ? fnArgs : JSON.stringify(fnArgs)),
              };

              if (tool) {
                try {
                  const result = await tool.execute(record.args as any, {} as any);
                  record.result = result.output;
                  record.error = result.success ? undefined : result.error;
                  messages.push({
                    role: 'tool',
                    tool_call_id: tcId,
                    content: JSON.stringify(result.output ?? result.error ?? ''),
                  } as any);
                } catch (err: any) {
                  record.error = err?.message;
                  messages.push({ role: 'tool', tool_call_id: tcId, content: JSON.stringify({ error: err?.message }) } as any);
                }
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
          };
        }

        const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
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
        };
      },
    );
  } catch (error) {
    metricStatus = 'error';
    throw error;
  } finally {
    try {
      await recordAgentOSUsage({
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
