/**
 * @file sequential.ts
 * Sequential strategy compiler for the Agency API.
 *
 * Iterates agents in declaration order. Each agent receives the previous
 * agent's output as context, forming a chain where the final agent's response
 * is the overall result. Token usage is aggregated across all agent calls.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
} from '../types.js';
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
 * Compiles a sequential execution strategy.
 *
 * Agents are invoked one-by-one in their declared iteration order. Each agent
 * after the first receives a prompt that includes both the original task and
 * the preceding agent's output, enabling progressive refinement chains such as
 * researcher -> editor -> reviewer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration providing fallback model/provider/tools.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 */
export function compileSequential(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];
      let context = prompt;
      let lastResult: Record<string, unknown> | null = null;
      const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      for (const [name, agentOrConfig] of Object.entries(agents)) {
        const a: Agent = isAgent(agentOrConfig)
          ? agentOrConfig
          : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });

        const start = Date.now();
        const result = (await a.generate(context, opts)) as Record<string, unknown>;
        const durationMs = Date.now() - start;

        const resultText = (result.text as string) ?? '';
        const resultUsage = (result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
        const resultToolCalls = (result.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

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

        /* Chain: subsequent agents see the original task plus previous output. */
        context = `Original task: ${prompt}\n\nPrevious agent (${name}) output:\n${resultText}`;
        lastResult = result;
      }

      return { ...lastResult, agentCalls, usage: totalUsage };
    },

    stream(prompt, opts) {
      /*
       * For v1: streaming delegates to execute() and wraps the resolved text
       * as a single-chunk async iterable. A future version will pipe real
       * streaming tokens from the final agent.
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
