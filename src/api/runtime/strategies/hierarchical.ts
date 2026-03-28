/**
 * @file hierarchical.ts
 * Hierarchical strategy compiler for the Agency API.
 *
 * ## Execution model
 *
 * A manager agent (instantiated from the agency-level config) delegates
 * subtasks to sub-agents via tool calls. Each sub-agent is exposed as a
 * `delegate_to_<name>` tool that the manager can invoke to assign work.
 * The manager synthesizes sub-agent outputs into a final answer.
 *
 * ## Emergent wiring
 *
 * The manager does not follow a fixed execution order. It decides which
 * agents to call, in what order, and with what subtasks -- based on the
 * user prompt and its system instructions. This makes hierarchical the
 * most flexible strategy, but also the most dependent on the manager
 * model's ability to plan and delegate effectively.
 *
 * ## Tool-based delegation
 *
 * Each sub-agent becomes a tool with a JSON Schema parameter (`task: string`).
 * The tool's `execute` function invokes the sub-agent's `generate()` and
 * returns the result text. This leverages the LLM's native tool-calling
 * capability for delegation, avoiding custom routing logic.
 *
 * @see {@link compileStrategy} -- the dispatcher that selects this compiler.
 * @see {@link compileAdaptiveWrapper} -- wraps other strategies with a hierarchical manager.
 */
import { agent as createAgent } from '../agent.js';
import { mergeAdaptableTools } from '../toolAdapter.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
} from '../types.js';
import type { ToolDefinitionMap } from '../toolAdapter.js';
import { AgencyConfigError } from '../types.js';
import { isAgent, mergeDefaults, resolveAgent, checkBeforeAgent } from './shared.js';

/**
 * Extracts a human-readable description from an agent config or instance.
 *
 * Used to build the team roster in the manager's system prompt so the manager
 * knows what each sub-agent specialises in.
 *
 * @param agentOrConfig - Either a pre-built Agent or a raw BaseAgentConfig.
 * @returns The instructions string if available, otherwise a generic label.
 */
function getAgentDescription(agentOrConfig: BaseAgentConfig | Agent): string {
  if (!isAgent(agentOrConfig) && (agentOrConfig as BaseAgentConfig).instructions) {
    return (agentOrConfig as BaseAgentConfig).instructions!;
  }
  return 'General purpose';
}

/**
 * Compiles a hierarchical execution strategy.
 *
 * A manager agent is instantiated from the agency-level model/provider/instructions.
 * Each sub-agent in the roster is exposed as a `delegate_to_<name>` tool that the
 * manager can invoke. When the manager calls a delegation tool, the corresponding
 * sub-agent runs the subtask and its output is returned as the tool result.
 *
 * All sub-agent call records are collected and returned alongside the manager's
 * final synthesized answer.
 *
 * @param agents - Named roster of agent configs or pre-built `Agent` instances.
 * @param agencyConfig - Agency-level configuration; must include `model` or `provider`
 *   for the manager agent.
 * @returns A {@link CompiledStrategy} with `execute` and `stream` methods.
 * @throws {AgencyConfigError} When no agency-level model/provider is available
 *   for the manager agent.
 *
 * @example
 * ```ts
 * const strategy = compileHierarchical(
 *   {
 *     researcher: { instructions: 'Find academic sources.' },
 *     writer: { instructions: 'Write clear prose.' },
 *   },
 *   { model: 'openai:gpt-4o', agents: { ... } },
 * );
 * const result = await strategy.execute('Write a literature review on LLMs.');
 * // The manager decided which agents to call and in what order.
 * ```
 */
export function compileHierarchical(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions
): CompiledStrategy {
  if (!agencyConfig.model && !agencyConfig.provider) {
    throw new AgencyConfigError(
      'Hierarchical strategy requires an agency-level model or provider for the manager agent.'
    );
  }

  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];

      // Build one tool per sub-agent for the manager to delegate to.
      // The tool name follows the `delegate_to_<name>` convention so the
      // manager can infer the agent's role from the tool name alone.
      const agentTools: ToolDefinitionMap = {};
      for (const [name, agentOrConfig] of Object.entries(agents)) {
        const description = getAgentDescription(agentOrConfig);

        agentTools[`delegate_to_${name}`] = {
          description: `Delegate a subtask to the ${name} agent. ${description}`,
          parameters: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'The subtask to delegate' },
            },
            required: ['task'],
          },
          execute: async (args: { task: string }) => {
            // HITL: check beforeAgent gate before delegating to this sub-agent.
            const decision = await checkBeforeAgent(name, args.task, agentCalls, agencyConfig);
            if (decision && !decision.approved) {
              return { success: false, data: `Agent "${name}" execution was rejected by HITL.` };
            }

            const a = resolveAgent(agentOrConfig, agencyConfig);

            // Apply instruction modifications from the approval decision if any.
            const effectiveTask = decision?.modifications?.instructions
              ? `${args.task}\n\n[Additional instructions]: ${decision.modifications.instructions}`
              : args.task;

            const start = Date.now();
            const result = (await a.generate(effectiveTask, opts)) as Record<string, unknown>;
            const durationMs = Date.now() - start;

            const resultText = (result.text as string) ?? '';
            const resultUsage =
              (result.usage as {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
              }) ?? {};
            const resultToolCalls =
              (result.toolCalls as Array<{
                name: string;
                args: unknown;
                result?: unknown;
                error?: string;
              }>) ?? [];

            // Record the sub-agent call for the final result's agentCalls array.
            agentCalls.push({
              agent: name,
              input: args.task,
              output: resultText,
              toolCalls: resultToolCalls,
              usage: {
                promptTokens: resultUsage.promptTokens ?? 0,
                completionTokens: resultUsage.completionTokens ?? 0,
                totalTokens: resultUsage.totalTokens ?? 0,
              },
              durationMs,
            });

            return { success: true, data: resultText };
          },
        };
      }

      // Build the team roster description for the manager's system prompt.
      // This tells the manager who is on the team and what each member does.
      const teamRoster = Object.entries(agents)
        .map(([name, c]) => `- ${name}: ${getAgentDescription(c)}`)
        .join('\n');

      const managerInstructions =
        `You are a manager agent. Your task is to accomplish the user's goal by delegating subtasks to your team members.\n\n` +
        `Available team members:\n${teamRoster}\n\n` +
        `Use the delegate_to_<name> tools to assign work. Synthesize their outputs into a final answer.` +
        (agencyConfig.instructions ? `\n\n${agencyConfig.instructions}` : '');

      // Merge agency-level tools with the delegation tools. Agency tools
      // (e.g. shared search, calculator) are available alongside delegation.
      const mergedTools = mergeAdaptableTools(agencyConfig.tools, agentTools);

      const manager = createAgent({
        model: agencyConfig.model,
        provider: agencyConfig.provider,
        apiKey: agencyConfig.apiKey,
        baseUrl: agencyConfig.baseUrl,
        instructions: managerInstructions,
        tools: mergedTools,
        // Higher maxSteps than default because the manager needs room to
        // call multiple delegation tools before synthesizing.
        maxSteps: agencyConfig.maxSteps ?? 10,
      });

      const result = (await manager.generate(prompt, opts)) as unknown as Record<string, unknown>;
      return { ...result, agentCalls };
    },

    stream(prompt, opts) {
      /**
       * For v1: streaming delegates to execute() and wraps the resolved text
       * as a single-chunk async iterable. A future version will stream the
       * manager's output in real-time.
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
        usage: resultPromise.then((r) => r.usage as {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          costUSD?: number;
        }),
        agentCalls: resultPromise.then((r) => (r.agentCalls as AgentCallRecord[] | undefined) ?? []),
      };
    },
  };
}
