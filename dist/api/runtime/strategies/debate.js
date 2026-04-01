/**
 * @file debate.ts
 * Debate strategy compiler for the Agency API.
 *
 * ## Execution model
 *
 * Agents argue in rounds over a shared task. Each round, every agent sees all
 * prior arguments from every other agent, enabling progressive refinement
 * through adversarial discourse. After all rounds complete, a synthesizer
 * distils the collected arguments into a single coherent response.
 *
 * ## Why debate?
 *
 * Debate is effective for tasks where multiple perspectives lead to better
 * outcomes: ethical reasoning, policy analysis, creative brainstorming,
 * risk assessment. Each agent is forced to defend its position while
 * considering others, reducing blind spots.
 *
 * ## Round structure
 *
 * For `N` agents and `R` rounds, the total agent calls are `N * R` plus one
 * synthesis call. In each round, agents are called in declaration order.
 * Each agent receives the full argument history from all prior agents/rounds.
 *
 * @see {@link compileStrategy} -- the dispatcher that selects this compiler.
 * @see {@link compileReviewLoop} -- an alternative iterative strategy with explicit approval.
 */
import { agent as createAgent } from '../agent.js';
import { AgencyConfigError } from '../types.js';
import { resolveAgent, checkBeforeAgent } from './shared.js';
/**
 * Compiles a debate execution strategy.
 *
 * Agents are iterated in rounds. During each round, every agent receives the
 * original task plus all previously collected arguments, and contributes its
 * own perspective. After `maxRounds` complete, a synthesizer agent (using the
 * agency-level model) distils all arguments into a final answer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 *   Must include `model` or `provider` for the synthesis step.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available
 *   for the synthesis step.
 *
 * @example
 * ```ts
 * const strategy = compileDebate(
 *   { optimist: { instructions: 'Argue the positive case.' }, pessimist: { instructions: 'Argue the risks.' } },
 *   { model: 'openai:gpt-4o', maxRounds: 2, agents: { ... } },
 * );
 * const result = await strategy.execute('Should we adopt this new technology?');
 * ```
 */
export function compileDebate(agents, agencyConfig) {
    if (!agencyConfig.model && !agencyConfig.provider) {
        throw new AgencyConfigError('Debate strategy requires an agency-level model or provider for result synthesis.');
    }
    // Default to 3 rounds when not specified -- enough for meaningful discourse
    // without excessive token consumption.
    const maxRounds = agencyConfig.maxRounds ?? 3;
    return {
        async execute(prompt, opts) {
            const agentCalls = [];
            const entries = Object.entries(agents);
            const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            const collectedArguments = [];
            for (let round = 0; round < maxRounds; round++) {
                for (const [name, agentOrConfig] of entries) {
                    // HITL: check beforeAgent gate before invoking this agent.
                    const decision = await checkBeforeAgent(name, prompt, agentCalls, agencyConfig);
                    if (decision && !decision.approved) {
                        // Agent was rejected -- skip this agent in this round.
                        continue;
                    }
                    const a = resolveAgent(agentOrConfig, agencyConfig);
                    // Build the debate context: original task + all prior arguments.
                    // The first agent in the first round sees "You are the first to argue."
                    // which prevents confusion about missing prior context.
                    const debateContext = `Task: ${prompt}\n\n` +
                        (collectedArguments.length > 0
                            ? `Previous arguments:\n${collectedArguments.join('\n---\n')}`
                            : 'You are the first to argue.') +
                        `\n\nPresent your perspective as ${name} (round ${round + 1}/${maxRounds}).`;
                    const start = Date.now();
                    const result = (await a.generate(debateContext, opts));
                    const durationMs = Date.now() - start;
                    const resultText = result.text ?? '';
                    const resultUsage = result.usage ?? {};
                    const resultToolCalls = result.toolCalls ?? [];
                    // Label each argument with the agent name and round for traceability
                    // in the synthesis prompt.
                    collectedArguments.push(`[${name}, round ${round + 1}]: ${resultText}`);
                    agentCalls.push({
                        agent: name,
                        input: debateContext,
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
                }
            }
            // Synthesize all arguments into a final answer using the agency-level model.
            const synthInstructions = agencyConfig.instructions
                ? `\n\n${agencyConfig.instructions}`
                : '';
            const synthPrompt = `A debate was held on the following task:\n"${prompt}"\n\n` +
                `All arguments:\n${collectedArguments.join('\n---\n')}\n\n` +
                `Synthesize these perspectives into a single coherent answer.${synthInstructions}`;
            const synthesizer = createAgent({
                model: agencyConfig.model,
                provider: agencyConfig.provider,
                apiKey: agencyConfig.apiKey,
                baseUrl: agencyConfig.baseUrl,
                maxSteps: 1,
            });
            const synthesis = (await synthesizer.generate(synthPrompt, opts));
            const synthUsage = synthesis.usage ?? {};
            totalUsage.promptTokens += synthUsage.promptTokens ?? 0;
            totalUsage.completionTokens += synthUsage.completionTokens ?? 0;
            totalUsage.totalTokens += synthUsage.totalTokens ?? 0;
            return { ...synthesis, agentCalls, usage: totalUsage };
        },
        stream(prompt, opts) {
            /**
             * For v1: streaming delegates to execute() and wraps the resolved text
             * as a single-chunk async iterable. A future version will stream the
             * synthesis step in real-time.
             */
            const resultPromise = this.execute(prompt, opts);
            const textPromise = resultPromise.then((r) => r.text ?? '');
            return {
                textStream: (async function* () {
                    yield await textPromise;
                })(),
                fullStream: (async function* () {
                    const text = await textPromise;
                    yield { type: 'text', text };
                })(),
                text: textPromise,
                usage: resultPromise.then((r) => r.usage),
                agentCalls: resultPromise.then((r) => r.agentCalls ?? []),
            };
        },
    };
}
//# sourceMappingURL=debate.js.map