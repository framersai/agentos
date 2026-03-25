/**
 * @file hierarchical.ts
 * Hierarchical strategy compiler for the Agency API.
 *
 * A manager agent (instantiated from the agency-level config) delegates
 * subtasks to sub-agents via tool calls. Each sub-agent is exposed as a
 * `delegate_to_<name>` tool that the manager can invoke to assign work.
 * The manager synthesizes sub-agent outputs into a final answer.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  CompiledStrategy,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
} from '../types.js';
import type { ToolDefinitionMap } from '../toolAdapter.js';
import { AgencyConfigError } from '../types.js';
import { isAgent } from './index.js';
import { mergeDefaults, resolveAgent, checkBeforeAgent } from './shared.js';

/**
 * Extracts a human-readable description from an agent config or instance.
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
 * @throws {AgencyConfigError} When no agency-level model/provider is available for the manager.
 */
export function compileHierarchical(
  agents: Record<string, BaseAgentConfig | Agent>,
  agencyConfig: AgencyOptions,
): CompiledStrategy {
  if (!agencyConfig.model && !agencyConfig.provider) {
    throw new AgencyConfigError(
      'Hierarchical strategy requires an agency-level model or provider for the manager agent.',
    );
  }

  return {
    async execute(prompt, opts) {
      const agentCalls: AgentCallRecord[] = [];

      /* Build one tool per sub-agent for the manager to delegate to. */
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
            /* HITL: check beforeAgent gate before delegating to this sub-agent. */
            const decision = await checkBeforeAgent(name, args.task, agentCalls, agencyConfig);
            if (decision && !decision.approved) {
              return { success: false, data: `Agent "${name}" execution was rejected by HITL.` };
            }

            const a = resolveAgent(agentOrConfig, agencyConfig);

            /* Apply instruction modifications from the approval decision if any. */
            const effectiveTask = decision?.modifications?.instructions
              ? `${args.task}\n\n[Additional instructions]: ${decision.modifications.instructions}`
              : args.task;

            const start = Date.now();
            const result = (await a.generate(effectiveTask, opts)) as Record<string, unknown>;
            const durationMs = Date.now() - start;

            const resultText = (result.text as string) ?? '';
            const resultUsage = (result.usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number }) ?? {};
            const resultToolCalls = (result.toolCalls as Array<{ name: string; args: unknown; result?: unknown; error?: string }>) ?? [];

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

      /* Build the team roster description for the manager's system prompt. */
      const teamRoster = Object.entries(agents)
        .map(([name, c]) => `- ${name}: ${getAgentDescription(c)}`)
        .join('\n');

      const managerInstructions =
        `You are a manager agent. Your task is to accomplish the user's goal by delegating subtasks to your team members.\n\n` +
        `Available team members:\n${teamRoster}\n\n` +
        `Use the delegate_to_<name> tools to assign work. Synthesize their outputs into a final answer.` +
        (agencyConfig.instructions ? `\n\n${agencyConfig.instructions}` : '');

      /* Merge agency-level tools with the delegation tools. */
      const mergedTools = { ...(agencyConfig.tools ?? {}), ...agentTools };

      const manager = createAgent({
        model: agencyConfig.model,
        provider: agencyConfig.provider,
        apiKey: agencyConfig.apiKey,
        baseUrl: agencyConfig.baseUrl,
        instructions: managerInstructions,
        tools: mergedTools,
        maxSteps: agencyConfig.maxSteps ?? 10,
      });

      const result = (await manager.generate(prompt, opts)) as unknown as Record<string, unknown>;
      return { ...result, agentCalls };
    },

    stream(prompt, opts) {
      /*
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
        usage: resultPromise.then((r) => r.usage),
      };
    },
  };
}
