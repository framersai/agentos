/**
 * @file RequestExpansionTool.ts
 * @description Tool that running agents call to request graph expansion.
 *
 * The tool itself just records the request — the actual expansion decision
 * happens in the mission runtime, which intercepts this tool's result
 * and decides whether to generate and apply a GraphPatch.
 */
/**
 * Tool available to all agent nodes in a mission graph.
 * Calling this signals that the agent needs a capability it doesn't have.
 */
export class RequestExpansionTool {
    constructor() {
        this.id = 'com.framers.orchestration.request-expansion';
        this.name = 'request_expansion';
        this.displayName = 'Request Expansion';
        this.description = 'Request additional agents or capabilities to complete your task. Use when you encounter a need that your current tools cannot fulfill. The mission planner will evaluate your request and may spawn new agents or forge new tools.';
        this.category = 'orchestration';
        this.hasSideEffects = true;
        this.requiredPermissions = [];
        this.inputSchema = {
            type: 'object',
            properties: {
                need: {
                    type: 'string',
                    description: 'What capability or agent is needed and why',
                },
                urgency: {
                    type: 'string',
                    enum: ['blocking', 'would_improve', 'nice_to_have'],
                    description: 'blocking = cannot continue without this, would_improve = quality suffers, nice_to_have = optional enhancement',
                },
            },
            required: ['need', 'urgency'],
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
                message: `Expansion request recorded: "${args.need}" (urgency: ${args.urgency}). The mission planner will evaluate this request.`,
            },
        };
    }
}
//# sourceMappingURL=RequestExpansionTool.js.map