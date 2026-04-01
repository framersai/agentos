/**
 * @file graph.ts
 * Graph (DAG) strategy compiler for the Agency API.
 *
 * Agents declare explicit dependencies via `dependsOn: ['agentName']`. The
 * strategy topologically sorts the roster, runs agents with satisfied
 * dependencies concurrently, and feeds each agent the concatenated outputs
 * of its predecessors.
 *
 * Agents with no `dependsOn` (roots) run first in parallel. Agents whose
 * dependencies have all completed are started immediately — maximising
 * concurrency within the DAG constraints.
 *
 * @example
 * ```ts
 * agency({
 *   strategy: 'graph',
 *   agents: {
 *     researcher:  { instructions: 'Find facts.' },
 *     illustrator: { instructions: 'Create a diagram.', dependsOn: ['researcher'] },
 *     writer:      { instructions: 'Write summary.',    dependsOn: ['researcher'] },
 *     reviewer:    { instructions: 'Review everything.', dependsOn: ['writer', 'illustrator'] },
 *   },
 * });
 * ```
 */
import { agent as createAgent } from '../agent.js';
import { createBufferedAsyncReplay } from '../streamBuffer.js';
import { AgencyConfigError } from '../types.js';
import { isAgent, mergeDefaults, checkBeforeAgent } from './shared.js';
// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------
/**
 * Topologically sort agent names based on `dependsOn` edges.
 * Returns an array of "tiers" — agents within a tier can run in parallel.
 *
 * @throws {AgencyConfigError} On cycles or references to non-existent agents.
 */
function topoSort(agents) {
    const names = Object.keys(agents);
    const nameSet = new Set(names);
    // Build adjacency: agentName → set of agents it depends on.
    const deps = new Map();
    for (const name of names) {
        const config = agents[name];
        const dependsOn = (!isAgent(config) && config.dependsOn) || [];
        for (const dep of dependsOn) {
            if (!nameSet.has(dep)) {
                throw new AgencyConfigError(`Agent "${name}" depends on "${dep}" which is not in the agents roster.`);
            }
        }
        deps.set(name, new Set(dependsOn));
    }
    const tiers = [];
    const resolved = new Set();
    while (resolved.size < names.length) {
        // Find agents whose dependencies are all resolved.
        const ready = names.filter((n) => !resolved.has(n) && [...(deps.get(n) ?? [])].every((d) => resolved.has(d)));
        if (ready.length === 0) {
            const remaining = names.filter((n) => !resolved.has(n));
            throw new AgencyConfigError(`Cycle detected in agent dependencies. Stuck agents: ${remaining.join(', ')}`);
        }
        tiers.push(ready);
        for (const r of ready)
            resolved.add(r);
    }
    return tiers;
}
// ---------------------------------------------------------------------------
// Strategy compiler
// ---------------------------------------------------------------------------
/**
 * Compiles a graph (DAG) execution strategy.
 *
 * Agents are grouped into tiers by topological sort. Within each tier,
 * agents run concurrently. Each agent receives the original prompt plus
 * the concatenated outputs of all its `dependsOn` predecessors.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 */
export function compileGraph(agents, agencyConfig) {
    const tiers = topoSort(agents);
    return {
        async execute(prompt, opts) {
            const agentCalls = [];
            const outputs = new Map();
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            let lastResult = null;
            for (const tier of tiers) {
                // Run all agents in this tier concurrently.
                const tierResults = await Promise.all(tier.map(async (name) => {
                    const agentOrConfig = agents[name];
                    /* HITL: check beforeAgent gate. */
                    const decision = await checkBeforeAgent(name, prompt, agentCalls, agencyConfig);
                    if (decision && !decision.approved) {
                        outputs.set(name, '[skipped by HITL]');
                        return null;
                    }
                    const a = isAgent(agentOrConfig)
                        ? agentOrConfig
                        : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
                    // Build context from dependsOn predecessors.
                    const config = agentOrConfig;
                    const depNames = (!isAgent(agentOrConfig) && config.dependsOn) || [];
                    let context = prompt;
                    if (depNames.length > 0) {
                        const depOutputs = depNames
                            .map((d) => `[${d}]:\n${outputs.get(d) ?? ''}`)
                            .join('\n\n');
                        context = `Original task: ${prompt}\n\nOutputs from dependencies:\n${depOutputs}`;
                    }
                    const start = Date.now();
                    const result = (await a.generate(context, opts));
                    const durationMs = Date.now() - start;
                    const resultText = result.text ?? '';
                    const resultUsage = result.usage ?? {};
                    const resultToolCalls = result.toolCalls ?? [];
                    outputs.set(name, resultText);
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
                    return result;
                }));
                // Track the last non-null result (the final tier's output).
                const lastNonNull = tierResults.filter(Boolean).pop();
                if (lastNonNull)
                    lastResult = lastNonNull;
            }
            return { ...lastResult, agentCalls, usage: totalUsage };
        },
        stream(prompt, opts) {
            const startMs = Date.now();
            const agentCalls = [];
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            async function* streamGenerator() {
                const outputs = new Map();
                yield { type: 'agent-start', agent: '__agency__', input: prompt };
                for (const tier of tiers) {
                    // Within a tier, start all agents. For streaming we run them
                    // sequentially per tier to keep the output readable, but emit
                    // agent-start/agent-end markers so the consumer knows the structure.
                    for (const name of tier) {
                        const agentOrConfig = agents[name];
                        const decision = await checkBeforeAgent(name, prompt, agentCalls, agencyConfig);
                        if (decision && !decision.approved) {
                            outputs.set(name, '[skipped by HITL]');
                            continue;
                        }
                        const config = agentOrConfig;
                        const depNames = (!isAgent(agentOrConfig) && config.dependsOn) || [];
                        let context = prompt;
                        if (depNames.length > 0) {
                            const depOutputs = depNames
                                .map((d) => `[${d}]:\n${outputs.get(d) ?? ''}`)
                                .join('\n\n');
                            context = `Original task: ${prompt}\n\nOutputs from dependencies:\n${depOutputs}`;
                        }
                        yield { type: 'agent-start', agent: name, input: context };
                        const a = isAgent(agentOrConfig)
                            ? agentOrConfig
                            : createAgent({ ...mergeDefaults(config, agencyConfig) });
                        let agentText = '';
                        let resultUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
                        let resultToolCalls = [];
                        const agentStart = Date.now();
                        const agentStream = a.stream(context, opts);
                        if (agentStream?.textStream) {
                            for await (const chunk of agentStream.textStream) {
                                yield { type: 'text', text: chunk, agent: name };
                                agentText += chunk;
                            }
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
                            const result = (await a.generate(context, opts));
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
                        outputs.set(name, agentText);
                        agentCalls.push({
                            agent: name,
                            input: context,
                            output: agentText,
                            toolCalls: resultToolCalls,
                            usage: resultUsage,
                            durationMs: Date.now() - agentStart,
                        });
                        totalUsage.promptTokens += resultUsage.promptTokens;
                        totalUsage.completionTokens += resultUsage.completionTokens;
                        totalUsage.totalTokens += resultUsage.totalTokens;
                        yield {
                            type: 'agent-end',
                            agent: name,
                            output: agentText,
                            durationMs: Date.now() - agentStart,
                        };
                    }
                }
                yield { type: 'agent-end', agent: '__agency__', output: '', durationMs: Date.now() - startMs };
            }
            const replay = createBufferedAsyncReplay(streamGenerator());
            const textPromise = replay.ensureDraining().then(() => replay
                .getBuffered()
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join(''));
            const usagePromise = replay.ensureDraining().then(() => ({ ...totalUsage }));
            const agentCallsPromise = replay.ensureDraining().then(() => [...agentCalls]);
            return {
                fullStream: replay.iterable,
                textStream: (async function* () {
                    for await (const part of replay.iterable) {
                        if (part.type === 'text') {
                            yield part.text;
                        }
                    }
                })(),
                text: textPromise,
                usage: usagePromise,
                agentCalls: agentCallsPromise,
            };
        },
    };
}
//# sourceMappingURL=graph.js.map