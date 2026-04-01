/**
 * @file ManageGraphTool.ts
 * @description Tool available only to supervisor nodes in hierarchical agency strategies.
 *
 * Requests structural changes to the running mission graph — spawn agents,
 * remove underperforming nodes, reassign roles, add tools, or fork branches.
 * Like RequestExpansionTool, the actual modification happens in the mission
 * runtime, not in this tool.
 */
/**
 * Tool available only to supervisor nodes in hierarchical strategies.
 * Enables supervisors to structurally modify the running mission graph.
 */
export class ManageGraphTool {
    constructor() {
        this.id = 'com.framers.orchestration.manage-graph';
        this.name = 'manage_graph';
        this.displayName = 'Manage Graph';
        this.description = 'Add, remove, or reassign agents in the running mission. Only available to supervisor agents. Use to spawn new workers, remove underperforming agents, reassign roles, add tools, or fork execution branches.';
        this.category = 'orchestration';
        this.hasSideEffects = true;
        this.requiredPermissions = ['orchestration:manage_graph'];
        this.inputSchema = {
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
        this.outputSchema = {
            type: 'object',
            properties: {
                acknowledged: { type: 'boolean' },
                message: { type: 'string' },
            },
        };
    }
    async execute(args, _context) {
        return {
            success: true,
            output: {
                acknowledged: true,
                message: `Graph modification request recorded: ${args.action} — "${args.reason}". The mission runtime will evaluate and apply this request.`,
            },
        };
    }
}
//# sourceMappingURL=ManageGraphTool.js.map