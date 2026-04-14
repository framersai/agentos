/**
 * @file streamText.ts
 * Stateless streaming text generation for the AgentOS high-level API.
 *
 * Accepts the same {@link GenerateTextOptions} as {@link generateText} but returns
 * immediately with async iterables so callers can process tokens incrementally.
 * Multi-step tool calling is supported: tool-call and tool-result parts are
 * yielded inline before the next LLM step begins.
 */
import { randomUUID } from 'node:crypto';
import { resolveModelOption, resolveProvider, createProviderManager } from './model.js';
import { attachUsageAttributes, toTurnMetricUsage } from './observability.js';
import { adaptTools } from './runtime/toolAdapter.js';
import { createPlan, isRetryableError, resolveChainOfThought, } from './generateText.js';
import { resolveDynamicToolCalls } from './runtime/dynamicToolCalling.js';
import { StreamingReconstructor } from '../core/llm/streaming/StreamingReconstructor.js';
import { recordAgentOSTurnMetrics, startAgentOSSpan } from '../evaluation/observability/otel.js';
async function recordAgentOSUsageLazy(input) {
    const { recordAgentOSUsage } = await import('./runtime/usageLedger.js');
    return recordAgentOSUsage(input);
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
function formatPlanForPrompt(plan) {
    const lines = plan.steps.map((s, i) => `${i + 1}. ${s.description}${s.tool ? ` [tool: ${s.tool}]` : ''}`);
    return `Follow this plan:\n${lines.join('\n')}`;
}
/**
 * Stateless streaming text generation with optional multi-step tool calling.
 *
 * Returns a {@link StreamTextResult} immediately; the underlying provider call
 * begins lazily when a consumer starts iterating `textStream` or `fullStream`.
 * Awaiting `text`, `usage`, or `toolCalls` will also drain the stream.
 *
 * @param opts - Generation options (same shape as {@link generateText}).
 * @returns A {@link StreamTextResult} with async iterables and awaitable promises.
 *
 * @example
 * ```ts
 * const { textStream } = streamText({ model: 'openai:gpt-4o', prompt: 'Tell me a joke.' });
 * for await (const chunk of textStream) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export function streamText(opts) {
    let resolveText;
    let resolveUsage;
    let resolveToolCalls;
    const textPromise = new Promise((r) => {
        resolveText = r;
    });
    const usagePromise = new Promise((r) => {
        resolveUsage = r;
    });
    const toolCallsPromise = new Promise((r) => {
        resolveToolCalls = r;
    });
    const parts = [];
    const allToolCalls = [];
    async function* runStream() {
        const startedAt = Date.now();
        const rootSpan = startAgentOSSpan('agentos.api.stream_text');
        const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let finalText = '';
        let metricStatus = 'ok';
        let recordedProviderId;
        let recordedModelId;
        try {
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
            recordedProviderId = resolved.providerId;
            recordedModelId = resolved.modelId;
            const provider = manager.getProvider(resolved.providerId);
            if (!provider)
                throw new Error(`Provider ${resolved.providerId} not available.`);
            rootSpan?.setAttribute('llm.provider', resolved.providerId);
            rootSpan?.setAttribute('llm.model', resolved.modelId);
            const tools = adaptTools(opts.tools);
            const toolMap = new Map();
            for (const tool of tools)
                toolMap.set(tool.name, tool);
            const helperToolRunId = randomUUID();
            const messages = [];
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
                if (cotInstruction && hasTools) {
                    parts.unshift({ type: 'text', text: cotInstruction });
                }
                messages.push({ role: 'system', content: parts });
            }
            if (opts.messages)
                for (const m of opts.messages)
                    messages.push({ role: m.role, content: m.content });
            if (opts.prompt)
                messages.push({ role: 'user', content: opts.prompt });
            rootSpan?.setAttribute('agentos.api.tool_count', tools.length);
            const toolSchemas = tools.length > 0
                ? tools.map((tool) => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                    },
                }))
                : undefined;
            const maxSteps = opts.maxSteps ?? 1;
            rootSpan?.setAttribute('agentos.api.max_steps', maxSteps);
            const planningEnabled = !!opts.planning;
            rootSpan?.setAttribute('agentos.api.planning_enabled', planningEnabled);
            if (planningEnabled) {
                const planConfig = typeof opts.planning === 'object' ? opts.planning : undefined;
                const userMessages = messages.filter((m) => m.role === 'user');
                const toolNames = tools.map((tool) => tool.name);
                const resolvedPlan = await createPlan(provider, resolved.modelId, userMessages, toolNames, planConfig, usage);
                if (resolvedPlan) {
                    const planPrompt = formatPlanForPrompt(resolvedPlan);
                    const firstNonSystem = messages.findIndex((m) => m.role !== 'system');
                    const insertIdx = firstNonSystem === -1 ? messages.length : firstNonSystem;
                    messages.splice(insertIdx, 0, { role: 'system', content: planPrompt });
                    rootSpan?.setAttribute('agentos.api.plan_steps', resolvedPlan.steps.length);
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
                const stepSpan = startAgentOSSpan('agentos.api.stream_text.step', {
                    attributes: {
                        'llm.provider': resolved.providerId,
                        'llm.model': resolved.modelId,
                        'agentos.api.step': step + 1,
                        'agentos.api.tool_count': tools.length,
                    },
                });
                const stream = provider.generateCompletionStream(resolved.modelId, effectiveMessages, {
                    tools: toolSchemas,
                    temperature: opts.temperature,
                    maxTokens: opts.maxTokens,
                });
                const reconstructor = new StreamingReconstructor();
                try {
                    for await (const chunk of stream) {
                        reconstructor.push(chunk);
                        const textDelta = chunk.responseTextDelta ?? '';
                        if (textDelta) {
                            const part = { type: 'text', text: textDelta };
                            parts.push(part);
                            yield part;
                        }
                        if (chunk.error) {
                            const error = new Error(chunk.error.message);
                            const part = { type: 'error', error };
                            parts.push(part);
                            yield part;
                            metricStatus = 'error';
                            resolveText(finalText);
                            resolveUsage(usage);
                            resolveToolCalls(allToolCalls);
                            return;
                        }
                        if (chunk.isFinal && chunk.usage) {
                            usage.promptTokens += chunk.usage.promptTokens ?? 0;
                            usage.completionTokens += chunk.usage.completionTokens ?? 0;
                            usage.totalTokens += chunk.usage.totalTokens ?? 0;
                            if (typeof chunk.usage.costUSD === 'number') {
                                usage.costUSD = (usage.costUSD ?? 0) + chunk.usage.costUSD;
                            }
                            attachUsageAttributes(stepSpan, {
                                promptTokens: chunk.usage.promptTokens,
                                completionTokens: chunk.usage.completionTokens,
                                totalTokens: chunk.usage.totalTokens,
                                costUSD: chunk.usage.costUSD,
                            });
                        }
                    }
                }
                finally {
                    stepSpan?.end();
                }
                const stepText = reconstructor.getFullText();
                const finalChunk = reconstructor.getFinalChunk();
                let streamedToolCalls = resolveDynamicToolCalls(finalChunk?.choices?.[0]?.message?.tool_calls ??
                    reconstructor
                        .getToolCalls()
                        .filter((toolCall) => toolCall.id && toolCall.name)
                        .map((toolCall) => ({
                        id: toolCall.id,
                        type: 'function',
                        function: {
                            name: toolCall.name,
                            arguments: toolCall.rawArguments || JSON.stringify(toolCall.arguments ?? {}),
                        },
                    })), {
                    text: stepText,
                    step,
                    toolsAvailable: tools.length > 0,
                });
                // --- onAfterGeneration hook ---
                let effectiveStepText = stepText;
                if (opts.onAfterGeneration) {
                    try {
                        const stepUsage = {
                            promptTokens: usage.promptTokens,
                            completionTokens: usage.completionTokens,
                            totalTokens: usage.totalTokens,
                            costUSD: usage.costUSD,
                        };
                        const toolCallRecords = (streamedToolCalls ?? []).map((tc) => ({
                            name: tc.function?.name ?? '',
                            args: tc.function?.arguments ?? '{}',
                        }));
                        const hookResult = {
                            text: stepText,
                            toolCalls: toolCallRecords,
                            usage: stepUsage,
                            step,
                        };
                        const modified = await opts.onAfterGeneration(hookResult);
                        if (modified) {
                            effectiveStepText = modified.text;
                            if (modified.toolCalls.length === 0 && streamedToolCalls && streamedToolCalls.length > 0) {
                                streamedToolCalls = [];
                            }
                        }
                    }
                    catch (hookErr) {
                        console.warn('[agentos] onAfterGeneration hook error:', hookErr);
                    }
                }
                // Always track the latest step's text so finalText is available even
                // when maxSteps is exhausted with outstanding tool calls.
                if (effectiveStepText) {
                    finalText = effectiveStepText;
                }
                if (!streamedToolCalls || streamedToolCalls.length === 0) {
                    rootSpan?.setAttribute('agentos.api.finish_reason', 'stop');
                    rootSpan?.setAttribute('agentos.api.tool_calls', allToolCalls.length);
                    attachUsageAttributes(rootSpan, usage);
                    resolveText(finalText);
                    resolveUsage(usage);
                    resolveToolCalls(allToolCalls);
                    return;
                }
                messages.push({
                    role: 'assistant',
                    content: effectiveStepText || null,
                    tool_calls: streamedToolCalls,
                });
                for (const toolCall of streamedToolCalls) {
                    const fnName = toolCall.function?.name ?? '';
                    const rawArgs = toolCall.function?.arguments ?? '{}';
                    const toolCallId = toolCall.id ?? '';
                    const toolCallRecord = {
                        name: fnName,
                        args: rawArgs,
                    };
                    let parsedArgs;
                    try {
                        parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
                        toolCallRecord.args = parsedArgs;
                    }
                    catch {
                        toolCallRecord.error = `Tool "${fnName}" arguments were not valid JSON.`;
                        const resultPart = {
                            type: 'tool-result',
                            toolName: fnName,
                            result: { error: toolCallRecord.error },
                        };
                        parts.push(resultPart);
                        yield resultPart;
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify({ error: toolCallRecord.error }),
                        });
                        allToolCalls.push(toolCallRecord);
                        continue;
                    }
                    const requestPart = { type: 'tool-call', toolName: fnName, args: parsedArgs };
                    parts.push(requestPart);
                    yield requestPart;
                    const tool = toolMap.get(fnName);
                    if (!tool) {
                        toolCallRecord.error = `Tool "${fnName}" not found.`;
                        const resultPart = {
                            type: 'tool-result',
                            toolName: fnName,
                            result: { error: toolCallRecord.error },
                        };
                        parts.push(resultPart);
                        yield resultPart;
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify({ error: toolCallRecord.error }),
                        });
                        allToolCalls.push(toolCallRecord);
                        continue;
                    }
                    // --- onBeforeToolExecution hook ---
                    if (opts.onBeforeToolExecution) {
                        try {
                            const hookInfo = {
                                name: fnName,
                                args: parsedArgs,
                                id: toolCallId || '',
                                step,
                            };
                            const hookResult = await opts.onBeforeToolExecution(hookInfo);
                            if (hookResult === null) {
                                toolCallRecord.error = 'Skipped by onBeforeToolExecution hook';
                                const resultPart = {
                                    type: 'tool-result',
                                    toolName: fnName,
                                    result: { skipped: true },
                                };
                                parts.push(resultPart);
                                yield resultPart;
                                messages.push({
                                    role: 'tool',
                                    tool_call_id: toolCallId,
                                    content: JSON.stringify({ skipped: true }),
                                });
                                allToolCalls.push(toolCallRecord);
                                continue;
                            }
                            parsedArgs = hookResult.args;
                        }
                        catch (hookErr) {
                            console.warn('[agentos] onBeforeToolExecution hook error:', hookErr);
                        }
                    }
                    try {
                        const result = await tool.execute(parsedArgs, buildHelperToolExecutionContext('streamText', helperToolRunId, step, toolCallId || undefined));
                        toolCallRecord.result = result.output;
                        toolCallRecord.error = result.success ? undefined : result.error;
                        const resultPart = {
                            type: 'tool-result',
                            toolName: fnName,
                            result: result.output ?? { error: result.error },
                        };
                        parts.push(resultPart);
                        yield resultPart;
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify(result.output ?? { error: result.error ?? 'Tool execution failed.' }),
                        });
                    }
                    catch (err) {
                        toolCallRecord.error = err?.message ?? String(err);
                        const resultPart = {
                            type: 'tool-result',
                            toolName: fnName,
                            result: { error: toolCallRecord.error },
                        };
                        parts.push(resultPart);
                        yield resultPart;
                        messages.push({
                            role: 'tool',
                            tool_call_id: toolCallId,
                            content: JSON.stringify({ error: toolCallRecord.error }),
                        });
                    }
                    allToolCalls.push(toolCallRecord);
                }
            }
            resolveText(finalText);
            resolveUsage(usage);
            resolveToolCalls(allToolCalls);
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            // ── Fallback chain for streaming ──────────────────────────────
            // When the primary provider fails with a retryable error and
            // fallbackProviders are configured, delegate to a new streamText
            // call targeting the next available fallback.  All parts from the
            // fallback stream are yielded transparently to the consumer.
            if (opts.fallbackProviders?.length && isRetryableError(error)) {
                let lastFallbackError = error;
                let fallbackSucceeded = false;
                for (const fb of opts.fallbackProviders) {
                    try {
                        opts.onFallback?.(lastFallbackError, fb.provider);
                        const fallbackResult = streamText({
                            ...opts,
                            provider: fb.provider,
                            model: fb.model,
                            apiKey: undefined,
                            baseUrl: undefined,
                            fallbackProviders: undefined,
                            onFallback: undefined,
                        });
                        // Pipe all parts from the fallback stream to the consumer
                        for await (const fbPart of fallbackResult.fullStream) {
                            parts.push(fbPart);
                            yield fbPart;
                        }
                        // Resolve aggregated promises from the fallback stream
                        finalText = await fallbackResult.text;
                        const fbUsage = await fallbackResult.usage;
                        usage.promptTokens += fbUsage.promptTokens;
                        usage.completionTokens += fbUsage.completionTokens;
                        usage.totalTokens += fbUsage.totalTokens;
                        if (typeof fbUsage.costUSD === 'number') {
                            usage.costUSD = (usage.costUSD ?? 0) + fbUsage.costUSD;
                        }
                        const fbToolCalls = await fallbackResult.toolCalls;
                        allToolCalls.push(...fbToolCalls);
                        fallbackSucceeded = true;
                        break;
                    }
                    catch (fbErr) {
                        lastFallbackError = fbErr instanceof Error ? fbErr : new Error(String(fbErr));
                    }
                }
                if (fallbackSucceeded) {
                    resolveText(finalText);
                    resolveUsage(usage);
                    resolveToolCalls(allToolCalls);
                }
                else {
                    metricStatus = 'error';
                    const errorPart = { type: 'error', error: lastFallbackError };
                    parts.push(errorPart);
                    yield errorPart;
                    resolveText(finalText);
                    resolveUsage(usage);
                    resolveToolCalls(allToolCalls);
                }
            }
            else {
                metricStatus = 'error';
                const part = { type: 'error', error };
                parts.push(part);
                yield part;
                resolveText(finalText);
                resolveUsage(usage);
                resolveToolCalls(allToolCalls);
            }
        }
        finally {
            rootSpan?.setAttribute('agentos.api.tool_calls', allToolCalls.length);
            if (metricStatus === 'error') {
                rootSpan?.setAttribute('agentos.api.finish_reason', 'error');
            }
            else if (allToolCalls.length > 0 && !finalText) {
                rootSpan?.setAttribute('agentos.api.finish_reason', 'tool-calls');
            }
            attachUsageAttributes(rootSpan, usage);
            rootSpan?.end();
            try {
                await recordAgentOSUsageLazy({
                    providerId: recordedProviderId,
                    modelId: recordedModelId,
                    usage,
                    options: {
                        ...opts.usageLedger,
                        source: opts.usageLedger?.source ?? 'streamText',
                    },
                });
            }
            catch {
                // Helper-level usage persistence is best-effort and should not break streaming.
            }
            recordAgentOSTurnMetrics({
                durationMs: Date.now() - startedAt,
                status: metricStatus,
                usage: toTurnMetricUsage(usage),
            });
        }
    }
    const fullStreamIterable = runStream();
    const textStreamIterable = {
        [Symbol.asyncIterator]() {
            const inner = fullStreamIterable[Symbol.asyncIterator]();
            return {
                async next() {
                    while (true) {
                        const { value, done } = await inner.next();
                        if (done)
                            return { value: undefined, done: true };
                        if (value.type === 'text')
                            return { value: value.text, done: false };
                    }
                },
            };
        },
    };
    return {
        textStream: textStreamIterable,
        fullStream: fullStreamIterable,
        text: textPromise,
        usage: usagePromise,
        toolCalls: toolCallsPromise,
    };
}
//# sourceMappingURL=streamText.js.map