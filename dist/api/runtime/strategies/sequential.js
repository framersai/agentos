/**
 * @file sequential.ts
 * Sequential strategy compiler for the Agency API.
 *
 * ## Execution model
 *
 * Iterates agents in declaration order. Each agent receives the previous
 * agent's output as context, forming a chain where the final agent's response
 * is the overall result. Token usage is aggregated across all agent calls.
 *
 * This is the simplest and most common strategy -- ideal for pipelines like
 * `researcher -> editor -> reviewer` where each step builds on the previous.
 *
 * ## HITL integration
 *
 * Each agent is gated by {@link checkBeforeAgent} before invocation. If the
 * HITL handler rejects an agent, it is skipped and the chain continues with
 * the next agent using the same context (the rejected agent's contribution
 * is simply omitted).
 *
 * @see {@link compileStrategy} -- the dispatcher that selects this compiler.
 * @see {@link checkBeforeAgent} -- the HITL gate applied before each agent.
 */
import { agent as createAgent } from '../agent.js';
import { createBufferedAsyncReplay } from '../streamBuffer.js';
import { isAgent, mergeDefaults, checkBeforeAgent } from './shared.js';
/**
 * Compiles a sequential execution strategy.
 *
 * Agents are invoked one-by-one in their declared iteration order. Each agent
 * after the first receives a prompt that includes both the original task and
 * the preceding agent's output, enabling progressive refinement chains such as
 * `researcher -> editor -> reviewer`.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 *                 Iteration order of `Object.entries()` determines execution order.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 *
 * @example
 * ```ts
 * const strategy = compileSequential(
 *   { researcher: { instructions: 'Find info.' }, writer: { instructions: 'Write summary.' } },
 *   agencyConfig,
 * );
 * const result = await strategy.execute('Summarise recent AI research.');
 * ```
 */
export function compileSequential(agents, agencyConfig) {
    return {
        async execute(prompt, opts) {
            const agentCalls = [];
            let context = prompt;
            let lastResult = null;
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            for (const [name, agentOrConfig] of Object.entries(agents)) {
                // HITL: check beforeAgent gate before invoking this agent.
                // Returns null when no gate applies; returns a decision when the
                // agent is in the approval list.
                const decision = await checkBeforeAgent(name, context, agentCalls, agencyConfig);
                if (decision && !decision.approved) {
                    // Agent was rejected by HITL -- skip and continue to the next
                    // agent in the chain. The context remains unchanged.
                    continue;
                }
                const a = isAgent(agentOrConfig)
                    ? agentOrConfig
                    : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
                // Apply instruction modifications from the approval decision if any.
                // This allows the human reviewer to inject additional guidance into
                // the agent's context without modifying the original prompt.
                const effectiveContext = decision?.modifications?.instructions
                    ? `${context}\n\n[Additional instructions]: ${decision.modifications.instructions}`
                    : context;
                const start = Date.now();
                const result = (await a.generate(effectiveContext, opts));
                const durationMs = Date.now() - start;
                const resultText = result.text ?? '';
                const resultUsage = result.usage ?? {};
                const resultToolCalls = result.toolCalls ?? [];
                agentCalls.push({
                    agent: name,
                    input: context,
                    output: resultText,
                    toolCalls: resultToolCalls,
                    usage: {
                        promptTokens: resultUsage.promptTokens ?? 0,
                        completionTokens: resultUsage.completionTokens ?? 0,
                        totalTokens: resultUsage.totalTokens ?? 0,
                    },
                    durationMs,
                });
                totalUsage.promptTokens += resultUsage.promptTokens ?? 0;
                totalUsage.completionTokens += resultUsage.completionTokens ?? 0;
                totalUsage.totalTokens += resultUsage.totalTokens ?? 0;
                // Chain: subsequent agents see the original task plus previous output.
                // This ensures each agent has full context without losing the original prompt.
                context = `Original task: ${prompt}\n\nPrevious agent (${name}) output:\n${resultText}`;
                lastResult = result;
            }
            return { ...lastResult, agentCalls, usage: totalUsage };
        },
        stream(prompt, opts) {
            /**
             * Real streaming for the sequential strategy: yields per-agent
             * `agent-start` and `agent-end` events bracketing each agent's text
             * tokens, plus agency-level start/end events wrapping the whole run.
             *
             * `fullStream` emits the full {@link AgencyStreamPart} union so callers
             * can observe every agent transition. `textStream` filters to just the
             * `text` parts so the result stays compatible with `StreamTextResult`.
             *
             * Usage accounting is collected per-agent and summed into a final total.
             * All promises resolve once the generator has been fully consumed.
             */
            const startMs = Date.now();
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            const agentCalls = [];
            /**
             * Internal generator that drives the sequential run and yields
             * structured {@link AgencyStreamPart} events.
             */
            async function* streamGenerator() {
                let currentPrompt = prompt;
                let finalText = '';
                yield { type: 'agent-start', agent: '__agency__', input: prompt };
                for (const [name, agentOrConfig] of Object.entries(agents)) {
                    const decision = await checkBeforeAgent(name, currentPrompt, agentCalls, agencyConfig);
                    if (decision && !decision.approved) {
                        continue;
                    }
                    const effectivePrompt = decision?.modifications?.instructions
                        ? `${currentPrompt}\n\n[Additional instructions]: ${decision.modifications.instructions}`
                        : currentPrompt;
                    const agentStart = Date.now();
                    yield { type: 'agent-start', agent: name, input: effectivePrompt };
                    // Resolve agent instance (pre-built or config-based).
                    const a = isAgent(agentOrConfig)
                        ? agentOrConfig
                        : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
                    // Delegate to the agent's stream if available, otherwise use generate().
                    let agentText = '';
                    let resultUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
                    let resultToolCalls = [];
                    try {
                        const agentStream = a.stream(effectivePrompt, opts);
                        if (agentStream?.textStream) {
                            for await (const chunk of agentStream.textStream) {
                                yield { type: 'text', text: chunk, agent: name };
                                agentText += chunk;
                            }
                            // If textStream didn't give us the full text, resolve the promise.
                            if (!agentText && agentStream.text) {
                                agentText = await agentStream.text;
                                if (agentText) {
                                    yield { type: 'text', text: agentText, agent: name };
                                }
                            }
                            const streamedUsage = (await Promise.resolve(agentStream.usage)) ?? {};
                            resultUsage = {
                                promptTokens: streamedUsage.promptTokens ?? 0,
                                completionTokens: streamedUsage.completionTokens ?? 0,
                                totalTokens: streamedUsage.totalTokens ?? 0,
                            };
                            resultToolCalls = (await Promise.resolve(agentStream.toolCalls)) ?? [];
                        }
                        else {
                            // Fallback: non-streaming generate() call.
                            const result = (await a.generate(effectivePrompt, opts));
                            agentText = result.text ?? '';
                            if (agentText) {
                                yield { type: 'text', text: agentText, agent: name };
                            }
                            const generatedUsage = result.usage ?? {};
                            resultUsage = {
                                promptTokens: generatedUsage.promptTokens ?? 0,
                                completionTokens: generatedUsage.completionTokens ?? 0,
                                totalTokens: generatedUsage.totalTokens ?? 0,
                            };
                            resultToolCalls = result.toolCalls ?? [];
                        }
                        agentCalls.push({
                            agent: name,
                            input: currentPrompt,
                            output: agentText,
                            toolCalls: resultToolCalls,
                            usage: resultUsage,
                            durationMs: Date.now() - agentStart,
                        });
                        totalUsage.promptTokens += resultUsage.promptTokens;
                        totalUsage.completionTokens += resultUsage.completionTokens;
                        totalUsage.totalTokens += resultUsage.totalTokens;
                    }
                    catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        yield { type: 'error', error, agent: name };
                    }
                    const durationMs = Date.now() - agentStart;
                    yield { type: 'agent-end', agent: name, output: agentText, durationMs };
                    finalText = agentText;
                    currentPrompt = `Original task: ${prompt}\n\nPrevious agent (${name}) output:\n${agentText}`;
                }
                const totalDurationMs = Date.now() - startMs;
                yield {
                    type: 'agent-end',
                    agent: '__agency__',
                    output: finalText,
                    durationMs: totalDurationMs,
                };
            }
            /**
             * Because an `AsyncGenerator` can only be iterated once, we materialise
             * a single generator and share it between `fullStream`, `textStream`,
             * `text`, and `usage` by buffering all events.
             */
            const replay = createBufferedAsyncReplay(streamGenerator());
            /** Resolves with the concatenated final text. */
            const textPromise = replay.ensureDraining().then(() => replay
                .getBuffered()
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join(''));
            const usagePromise = replay.ensureDraining().then(() => ({ ...totalUsage }));
            const agentCallsPromise = replay.ensureDraining().then(() => [...agentCalls]);
            return {
                textStream: (async function* () {
                    for await (const part of replay.iterable) {
                        if (part.type === 'text') {
                            yield part.text;
                        }
                    }
                })(),
                fullStream: replay.iterable,
                text: textPromise,
                usage: usagePromise,
                agentCalls: agentCallsPromise,
                toolCalls: Promise.resolve([]),
            };
        },
    };
}
//# sourceMappingURL=sequential.js.map