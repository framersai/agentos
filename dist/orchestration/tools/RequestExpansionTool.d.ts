/**
 * @file RequestExpansionTool.ts
 * @description Tool that running agents call to request graph expansion.
 *
 * The tool itself just records the request — the actual expansion decision
 * happens in the mission runtime, which intercepts this tool's result
 * and decides whether to generate and apply a GraphPatch.
 */
import type { ITool, ToolExecutionContext, ToolExecutionResult, JSONSchemaObject } from '../../core/tools/ITool.js';
/** Input args for the request_expansion tool call. */
export interface RequestExpansionInput extends Record<string, any> {
    /** What capability or agent is needed and why. */
    need: string;
    /** How urgently this capability is needed. */
    urgency: 'blocking' | 'would_improve' | 'nice_to_have';
}
/** Output returned to the calling agent. */
export interface RequestExpansionOutput {
    acknowledged: boolean;
    message: string;
}
/**
 * Tool available to all agent nodes in a mission graph.
 * Calling this signals that the agent needs a capability it doesn't have.
 */
export declare class RequestExpansionTool implements ITool<RequestExpansionInput, RequestExpansionOutput> {
    readonly id = "com.framers.orchestration.request-expansion";
    readonly name = "request_expansion";
    readonly displayName = "Request Expansion";
    readonly description = "Request additional agents or capabilities to complete your task. Use when you encounter a need that your current tools cannot fulfill. The mission planner will evaluate your request and may spawn new agents or forge new tools.";
    readonly category = "orchestration";
    readonly hasSideEffects = true;
    readonly requiredPermissions: string[];
    readonly inputSchema: JSONSchemaObject;
    readonly outputSchema: JSONSchemaObject;
    execute(args: RequestExpansionInput, _context: ToolExecutionContext): Promise<ToolExecutionResult<RequestExpansionOutput>>;
}
//# sourceMappingURL=RequestExpansionTool.d.ts.map