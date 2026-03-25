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

/**
 * Merge agency-level defaults into an agent config.
 *
 * Agent-level values take precedence; tools are merged (agency tools serve as
 * a base layer, agent tools override on name collision).
 *
 * @param agentConfig - Per-agent configuration.
 * @param agencyConfig - Agency-level fallback values.
 * @returns A merged config suitable for passing to `agent()`.
 */
function mergeDefaults(
  agentConfig: BaseAgentConfig,
  agencyConfig: AgencyOptions,
): BaseAgentConfig {
  return {
    model: agentConfig.model ?? agencyConfig.model,
    provider: agentConfig.provider ?? agencyConfig.provider,
    apiKey: agentConfig.apiKey ?? agencyConfig.apiKey,
    baseUrl: agentConfig.baseUrl ?? agencyConfig.baseUrl,
    ...agentConfig,
    /* Merge tool maps: agency tools as base, agent tools overlay. */
    tools: { ...(agencyConfig.tools ?? {}), ...(agentConfig.tools ?? {}) },
  };
}

/**
 * Resolves an agent-or-config value into a usable {@link Agent} instance.
 *
 * @param agentOrConfig - Either a pre-built Agent or a raw BaseAgentConfig.
 * @param agencyConfig - Agency-level fallback values for config merging.
 * @returns A ready-to-call Agent instance.
 */
function resolveAgent(
  agentOrConfig: BaseAgentConfig | Agent,
  agencyConfig: AgencyOptions,
): Agent {
  return isAgent(agentOrConfig)
    ? agentOrConfig
    : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
}

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

      const synthesis = (await synthesizer.generate(synthPrompt, opts)) as Record<string, unknown>;
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
