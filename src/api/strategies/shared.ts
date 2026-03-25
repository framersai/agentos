/**
 * @file shared.ts
 * Shared utilities for strategy compilers.
 *
 * Centralises `mergeDefaults()`, `resolveAgent()`, and `checkBeforeAgent()`
 * so every strategy compiler uses a single implementation.
 */
import { agent as createAgent } from '../agent.js';
import type {
  AgencyOptions,
  Agent,
  BaseAgentConfig,
  AgentCallRecord,
  ApprovalRequest,
  ApprovalDecision,
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
export function mergeDefaults(
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
export function resolveAgent(
  agentOrConfig: BaseAgentConfig | Agent,
  agencyConfig: AgencyOptions,
): Agent {
  return isAgent(agentOrConfig)
    ? agentOrConfig
    : createAgent({ ...mergeDefaults(agentOrConfig, agencyConfig) });
}

/**
 * Checks the HITL `beforeAgent` gate for a named agent.
 *
 * When the agency-level `hitl.approvals.beforeAgent` list includes the agent
 * name, this function invokes the HITL handler and returns the decision.
 * If the agent name is not in the approval list, or no handler is configured,
 * returns `null` (meaning "no gate — proceed normally").
 *
 * @param name - The agent's declared name in the roster.
 * @param context - The input/context string the agent would receive.
 * @param agentCalls - Agent call records accumulated so far in this run.
 * @param agencyConfig - The full agency configuration.
 * @returns The approval decision, or `null` when no gate applies.
 */
export async function checkBeforeAgent(
  name: string,
  context: string,
  agentCalls: AgentCallRecord[],
  agencyConfig: AgencyOptions,
): Promise<ApprovalDecision | null> {
  const beforeAgent = agencyConfig.hitl?.approvals?.beforeAgent;
  const handler = agencyConfig.hitl?.handler;

  if (!beforeAgent?.includes(name) || !handler) {
    return null;
  }

  const request: ApprovalRequest = {
    id: crypto.randomUUID(),
    type: 'agent',
    agent: name,
    action: 'execute',
    description: `Agent "${name}" is about to execute`,
    details: { input: context },
    context: {
      agentCalls,
      totalTokens: 0,
      totalCostUSD: 0,
      elapsedMs: 0,
    },
  };

  agencyConfig.on?.approvalRequested?.(request);
  const decision = await handler(request);
  agencyConfig.on?.approvalDecided?.(decision);

  return decision;
}
