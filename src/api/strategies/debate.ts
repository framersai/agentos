/**
 * @file debate.ts
 * Debate strategy compiler for the Agency API.
 *
 * Agents argue in rounds over a shared task. Each round, every agent sees all
 * prior arguments from every other agent, enabling progressive refinement
 * through adversarial discourse. After all rounds complete, a synthesizer
 * distils the collected arguments into a single coherent response.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
} from '../types.js';
import { AgencyConfigError } from '../types.js';
import { isAgent } from './index.js';
import { mergeDefaults, resolveAgent, checkBeforeAgent } from './shared.js';

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
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available for synthesis.
 */
export function compileDebate(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  if (!agencyConfig.model && !agencyConfig.provider) {
    throw new AgencyConfigError(
      'Debate strategy requires an agency-level model or provider for result synthesis.',
    );
  }

  const maxRounds = agencyConfig.maxRounds ?? 3;

  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];
      const entries = Object.entries(agents);
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const collectedArguments: string[] = [];

      for (let round = 0; round < maxRounds; round++) {
        for (const [name, agentOrConfig] of entries) {
          /* HITL: check beforeAgent gate before invoking this agent. */
          const decision = await checkBeforeAgent(name, prompt, agentCalls, agencyConfig);
          if (decision && !decision.approved) {
            /* Agent was rejected — skip this agent in this round. */
            continue;
          }

          const a = resolveAgent(agentOrConfig, agencyConfig);

          const debateContext =
            `Task: ${prompt}\n\n` +
            (collectedArguments.length > 0
              ? `Previous arguments:\n${collectedArguments.join('\n---\n')}`
              : 'You are the first to argue.') +
            `\n\nPresent your perspective as ${name} (round ${round + 1}/${maxRounds}).`;

          const start = Date.now();
          const result = (await a.generate(debateContext, opts)) as Record<string, unknown>;
          const durationMs = Date.now() - start;

          const resultText = (result.text as string) ?? '';
          const resultUsage = (result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
          const resultToolCalls = (result.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

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

      /* Synthesize all arguments into a final answer using the agency-level model. */
      const synthInstructions = agencyConfig.instructions
        ? `\n\n${agencyConfig.instructions}`
        : '';

      const synthPrompt =
        `A debate was held on the following task:\n"${prompt}"\n\n` +
        `All arguments:\n${collectedArguments.join('\n---\n')}\n\n` +
        `Synthesize these perspectives into a single coherent answer.${synthInstructions}`;

      const synthesizer = createAgent({
        model: agencyConfig.model,
        provider: agencyConfig.provider,
        apiKey: agencyConfig.apiKey,
        baseUrl: agencyConfig.baseUrl,
        maxSteps: 1,
      });

      const synthesis = (await synthesizer.generate(synthPrompt, opts)) as unknown as Record<string, unknown>;
      const synthUsage = (synthesis.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};

      totalUsage.promptTokens += synthUsage.promptTokens ?? 0;
      totalUsage.completionTokens += synthUsage.completionTokens ?? 0;
      totalUsage.totalTokens += synthUsage.totalTokens ?? 0;

      return { ...synthesis, agentCalls, usage: totalUsage };
    },

    stream(prompt, opts) {
      /*
       * For v1: streaming delegates to execute() and wraps the resolved text
       * as a single-chunk async iterable. A future version will stream the
       * synthesis step in real-time.
       */
      const resultPromise = this.execute(prompt, opts) as Promise<Record<string, unknown>>;
      const textPromise = resultPromise.then((r) => (r.text as string) ?? '');

      return {
        textStream: (async function* () {
          yield await textPromise;
        })(),
        fullStream: (async function* () {
          const text = await textPromise;
          yield { type: 'text' as const, text };
        })(),
        text: textPromise,
        usage: resultPromise.then((r) => r.usage),
      };
    },
  };
}
