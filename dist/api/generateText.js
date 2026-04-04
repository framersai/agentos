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
import { adaptTools } from './runtime/toolAdapter.js';
import { parseToolCallsFromText } from './runtime/TextToolCallParser.js';
import { recordAgentOSTurnMetrics, withAgentOSSpan } from '../evaluation/observability/otel.js';
async function recordAgentOSUsageLazy(input) {
    const { recordAgentOSUsage } = await import('./runtime/usageLedger.js');
    return recordAgentOSUsage(input);
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
export function resolveChainOfThought(cot) {
    if (!cot)
        return undefined;
    if (typeof cot === 'string')
        return cot;
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
export async function createPlan(provider, modelId, userMessages, toolNames, config, totalUsage) {
    const systemPrompt = config?.systemPrompt ?? DEFAULT_PLANNING_SYSTEM_PROMPT;
    const temperature = config?.temperature ?? 0.2;
    const maxTokens = config?.maxTokens ?? 2048;
    // Build the planning conversation: system prompt + user context
    const planMessages = [
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
                steps: parsed.steps.map((s) => ({
                    description: String(s.description ?? ''),
                    tool: s.tool ?? null,
                    reasoning: String(s.reasoning ?? ''),
                })),
            };
        }
    }
    catch {
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
function formatPlanForPrompt(plan) {
    const lines = plan.steps.map((s, i) => `${i + 1}. ${s.description}${s.tool ? ` [tool: ${s.tool}]` : ''}`);
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
export function isRetryableError(error) {
    if (!(error instanceof Error))
        return false;
    const msg = error.message;
    // HTTP status codes that warrant a provider switch
    if (/\b(402|429|500|502|503|504|401|403)\b/.test(msg))
        return true;
    // Network-level failures
    if (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg))
        return true;
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
export function buildFallbackChain(excludeProvider) {
    const chain = [];
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
function buildHelperToolExecutionContext(source, runId, stepIndex, correlationId) {
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
export async function generateText(opts) {
    const startedAt = Date.now();
    let metricStatus = 'ok';
    let metricUsage;
    let metricProviderId;
    let metricModelId;
    try {
        return await withAgentOSSpan('agentos.api.generate_text', async (span) => {
            let { providerId, modelId } = resolveModelOption(opts, 'text');
            // --- Model routing (optional) ---
            if (opts.router) {
                try {
                    const toolNames = opts.tools
                        ? (Array.isArray(opts.tools)
                            ? opts.tools
                            : [...(opts.tools.values?.() ?? [])])
                            .map((t) => t.name ?? t.function?.name)
                            .filter(Boolean)
                        : [];
                    const routeParams = {
                        taskHint: opts.routerParams?.taskHint ?? (typeof opts.system === 'string' ? opts.system : undefined) ?? opts.prompt ?? '',
                        requiredCapabilities: opts.routerParams?.requiredCapabilities ??
                            (toolNames.length > 0 ? ['function_calling'] : undefined),
                        optimizationPreference: opts.routerParams?.optimizationPreference ?? 'balanced',
                        ...opts.routerParams,
                    };
                    const routeResult = await opts.router.selectModel(routeParams, undefined);
                    if (routeResult) {
                        providerId =
                            routeResult.modelInfo?.providerId ?? providerId;
                        modelId = routeResult.modelId;
                    }
                }
                catch (routerErr) {
                    console.warn('[agentos] Model router error, falling back to standard resolution:', routerErr);
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
            if (!provider)
                throw new Error(`Provider ${resolved.providerId} not available.`);
            span?.setAttribute('llm.provider', resolved.providerId);
            span?.setAttribute('llm.model', resolved.modelId);
            const tools = adaptTools(opts.tools);
            const toolMap = new Map();
            for (const t of tools)
                toolMap.set(t.name, t);
            const helperToolRunId = randomUUID();
            // Build messages
            const messages = [];
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
                }
                else if (opts.system) {
                    messages.push({ role: 'system', content: opts.system });
                }
            }
            else {
                // Structured SystemContentBlock[] — convert to content parts with cache_control
                const blocks = opts.system;
                const parts = blocks.map(block => ({
                    type: 'text',
                    text: block.text,
                    ...(block.cacheBreakpoint ? { cache_control: { type: 'ephemeral' } } : {}),
                }));
                // Prepend CoT instruction as the first non-cached block if needed
                if (cotInstruction && hasTools) {
                    parts.unshift({ type: 'text', text: cotInstruction });
                }
                messages.push({ role: 'system', content: parts });
            }
            if (opts.messages) {
                for (const m of opts.messages)
                    messages.push({ role: m.role, content: m.content });
            }
            if (opts.prompt)
                messages.push({ role: 'user', content: opts.prompt });
            span?.setAttribute('agentos.api.tool_count', tools.length);
            const toolSchemas = tools.length > 0
                ? tools.map((t) => ({
                    type: 'function',
                    function: { name: t.name, description: t.description, parameters: t.inputSchema },
                }))
                : undefined;
            const allToolCalls = [];
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            const maxSteps = opts.maxSteps ?? 1;
            span?.setAttribute('agentos.api.max_steps', maxSteps);
            // -----------------------------------------------------------------
            // Planning phase (optional)
            // When `opts.planning` is truthy, make one LLM call to decompose the
            // task into a numbered step list.  The plan is injected into the
            // message array as a system message so the tool loop is plan-aware.
            // -----------------------------------------------------------------
            let resolvedPlan;
            const planningEnabled = !!opts.planning;
            span?.setAttribute('agentos.api.planning_enabled', planningEnabled);
            if (planningEnabled) {
                const planConfig = typeof opts.planning === 'object' ? opts.planning : undefined;
                // Collect only user-role messages for the planner
                const userMessages = messages.filter((m) => m.role === 'user');
                const toolNames = tools.map((t) => t.name);
                resolvedPlan = await createPlan(provider, resolved.modelId, userMessages, toolNames, planConfig, totalUsage);
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
                        const hookCtx = {
                            messages: [...messages],
                            system: opts.system,
                            tools: Array.from(toolMap.values()),
                            model: resolved.modelId,
                            provider: resolved.providerId,
                            step,
                            prompt: opts.prompt,
                        };
                        const modified = await opts.onBeforeGeneration(hookCtx);
                        if (modified) {
                            effectiveMessages = modified.messages;
                        }
                    }
                    catch (hookErr) {
                        console.warn('[agentos] onBeforeGeneration hook error:', hookErr);
                    }
                }
                const response = await withAgentOSSpan('agentos.api.generate_text.step', async (stepSpan) => {
                    stepSpan?.setAttribute('llm.provider', resolved.providerId);
                    stepSpan?.setAttribute('llm.model', resolved.modelId);
                    stepSpan?.setAttribute('agentos.api.step', step + 1);
                    stepSpan?.setAttribute('agentos.api.tool_count', tools.length);
                    const stepResponse = await provider.generateCompletion(resolved.modelId, effectiveMessages, {
                        tools: toolSchemas,
                        temperature: opts.temperature,
                        maxTokens: opts.maxTokens,
                    });
                    attachUsageAttributes(stepSpan, {
                        promptTokens: stepResponse.usage?.promptTokens,
                        completionTokens: stepResponse.usage?.completionTokens,
                        totalTokens: stepResponse.usage?.totalTokens,
                        costUSD: stepResponse.usage?.costUSD,
                    });
                    return stepResponse;
                });
                if (response.usage) {
                    totalUsage.promptTokens += response.usage.promptTokens ?? 0;
                    totalUsage.completionTokens += response.usage.completionTokens ?? 0;
                    totalUsage.totalTokens += response.usage.totalTokens ?? 0;
                    if (typeof response.usage.costUSD === 'number') {
                        totalUsage.costUSD = (totalUsage.costUSD ?? 0) + response.usage.costUSD;
                    }
                }
                const choice = response.choices?.[0];
                if (!choice)
                    break;
                const content = choice.message?.content;
                let textContent = typeof content === 'string' ? content : (content?.text ?? '');
                let toolCallsInChoice = choice.message?.tool_calls ?? [];
                // --- Text-based tool-call fallback ---
                // When the provider returns no native tool_calls but tools were
                // provided and the response text contains structured tool
                // invocations, parse them from the text so models that lack native
                // function-calling support (some Ollama / open-source models) still
                // participate in the tool loop.
                if (toolCallsInChoice.length === 0 && tools.length > 0 && textContent) {
                    const parsed = parseToolCallsFromText(textContent);
                    if (parsed.length > 0) {
                        toolCallsInChoice = parsed.map((p, idx) => ({
                            id: `text-tc-${step}-${idx}`,
                            type: 'function',
                            function: {
                                name: p.name,
                                arguments: JSON.stringify(p.arguments),
                            },
                        }));
                    }
                }
                // --- onAfterGeneration hook ---
                if (opts.onAfterGeneration) {
                    try {
                        const stepUsage = {
                            promptTokens: response.usage?.promptTokens ?? 0,
                            completionTokens: response.usage?.completionTokens ?? 0,
                            totalTokens: response.usage?.totalTokens ?? 0,
                            costUSD: response.usage?.costUSD,
                        };
                        const toolCallRecords = toolCallsInChoice.map((tc) => ({
                            name: tc.function?.name ?? tc.name ?? '',
                            args: tc.function?.arguments ?? '{}',
                        }));
                        const hookResult = {
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
                    }
                    catch (hookErr) {
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
                        finishReason: (choice.finishReason ?? 'stop'),
                        plan: resolvedPlan,
                    };
                }
                if (toolCallsInChoice.length > 0) {
                    messages.push({
                        role: 'assistant',
                        content: textContent || null,
                        tool_calls: toolCallsInChoice,
                    });
                    for (const tc of toolCallsInChoice) {
                        const fnName = tc.function?.name ?? tc.name ?? '';
                        const fnArgs = tc.function?.arguments ?? '{}';
                        const tcId = tc.id ?? '';
                        const tool = toolMap.get(fnName);
                        const record = {
                            name: fnName,
                            args: fnArgs,
                        };
                        let parsedArgs;
                        try {
                            parsedArgs =
                                typeof fnArgs === 'string' ? JSON.parse(fnArgs) : fnArgs;
                            record.args = parsedArgs;
                        }
                        catch {
                            record.error = `Tool "${fnName}" arguments were not valid JSON.`;
                            messages.push({
                                role: 'tool',
                                tool_call_id: tcId,
                                content: JSON.stringify({ error: record.error }),
                            });
                            allToolCalls.push(record);
                            continue;
                        }
                        // --- onBeforeToolExecution hook ---
                        if (opts.onBeforeToolExecution) {
                            try {
                                const hookInfo = {
                                    name: fnName,
                                    args: parsedArgs,
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
                                    });
                                    allToolCalls.push(record);
                                    continue;
                                }
                                parsedArgs = hookResult.args;
                            }
                            catch (hookErr) {
                                console.warn('[agentos] onBeforeToolExecution hook error:', hookErr);
                            }
                        }
                        if (tool) {
                            try {
                                const result = await tool.execute(parsedArgs, buildHelperToolExecutionContext('generateText', helperToolRunId, step, tcId || undefined));
                                record.result = result.output;
                                record.error = result.success ? undefined : result.error;
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: tcId,
                                    content: JSON.stringify(result.output ?? result.error ?? ''),
                                });
                            }
                            catch (err) {
                                record.error = err?.message;
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: tcId,
                                    content: JSON.stringify({ error: err?.message }),
                                });
                            }
                        }
                        else {
                            record.error = `Tool "${fnName}" not found.`;
                            messages.push({
                                role: 'tool',
                                tool_call_id: tcId,
                                content: JSON.stringify({ error: record.error }),
                            });
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
                    finishReason: (choice.finishReason ?? 'stop'),
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
                text: lastAssistant?.content ?? '',
                usage: totalUsage,
                toolCalls: allToolCalls,
                finishReason: 'tool-calls',
                plan: resolvedPlan,
            };
        });
    }
    catch (error) {
        // ── Fallback chain ────────────────────────────────────────────────
        // When the primary provider fails with a retryable error and
        // fallbackProviders are configured, try each fallback in order.
        // The first successful response wins; if all fail, the last error
        // is re-thrown.
        if (opts.fallbackProviders?.length &&
            isRetryableError(error)) {
            let lastError = error;
            for (const fb of opts.fallbackProviders) {
                try {
                    opts.onFallback?.(lastError instanceof Error ? lastError : new Error(String(lastError)), fb.provider);
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
                }
                catch (fbError) {
                    lastError = fbError;
                }
            }
            // All fallbacks exhausted — fall through to throw
            metricStatus = 'error';
            throw lastError;
        }
        metricStatus = 'error';
        throw error;
    }
    finally {
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
        }
        catch {
            // Helper-level usage persistence is best-effort and should not break generation.
        }
        recordAgentOSTurnMetrics({
            durationMs: Date.now() - startedAt,
            status: metricStatus,
            usage: toTurnMetricUsage(metricUsage),
        });
    }
}
//# sourceMappingURL=generateText.js.map