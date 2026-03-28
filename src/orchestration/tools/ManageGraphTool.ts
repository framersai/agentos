/**
 * @file ManageGraphTool.ts
 * @description Tool available only to supervisor nodes in hierarchical agency strategies.
 *
 * Requests structural changes to the running mission graph — spawn agents,
 * remove underperforming nodes, reassign roles, add tools, or fork branches.
 * Like RequestExpansionTool, the actual modification happens in the mission
 * runtime, not in this tool.
 */

import type { ITool, ToolExecutionContext, ToolExecutionResult, JSONSchemaObject } from '../../core/tools/ITool.js';

/** Input args for the manage_graph tool call. */
export interface ManageGraphInput extends Record<string, any> {
  /** What graph modification to perform. */
  action: 'spawn_agent' | 'remove_agent' | 'reassign_role' | 'add_tool' | 'fork_branch';
  /** Specification for the modification (agent config, tool definition, etc.). */
  spec: Record<string, unknown>;
  /** Why this modification is needed. */
  reason: string;
}

/** Output returned to the supervisor agent. */
export interface ManageGraphOutput {
  acknowledged: boolean;
  message: string;
}

/**
 * Tool available only to supervisor nodes in hierarchical strategies.
 * Enables supervisors to structurally modify the running mission graph.
 */
export class ManageGraphTool implements ITool<ManageGraphInput, ManageGraphOutput> {
  readonly id = 'com.framers.orchestration.manage-graph';
  readonly name = 'manage_graph';
  readonly displayName = 'Manage Graph';
  readonly description =
    'Add, remove, or reassign agents in the running mission. Only available to supervisor agents. Use to spawn new workers, remove underperforming agents, reassign roles, add tools, or fork execution branches.';
  readonly category = 'orchestration';
  readonly hasSideEffects = true;
  readonly requiredPermissions = ['orchestration:manage_graph'];

  readonly inputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['spawn_agent', 'remove_agent', 'reassign_role', 'add_tool', 'fork_branch'],
        description: 'What graph modification to perform',
      },
      spec: {
        type: 'object',
        description: 'Specification for the modification (agent config, tool definition, etc.)',
      },
      reason: {
        type: 'string',
        description: 'Why this modification is needed',
      },
    },
    required: ['action', 'spec', 'reason'],
  };

  readonly outputSchema: JSONSchemaObject = {
    type: 'object',
    properties: {
      acknowledged: { type: 'boolean' },
      message: { type: 'string' },
    },
  };

  async execute(
    args: ManageGraphInput,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<ManageGraphOutput>> {
    return {
      success: true,
      output: {
        acknowledged: true,
        message: `Graph modification request recorded: ${args.action} — "${args.reason}". The mission runtime will evaluate and apply this request.`,
      },
    };
  }
}
