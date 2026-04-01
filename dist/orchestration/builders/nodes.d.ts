import type { GraphNode, NodeExecutionMode, EffectClass, MemoryPolicy, DiscoveryPolicy, PersonaPolicy, GuardrailPolicy, RetryPolicy, CompiledExecutionGraph } from '../ir/types.js';
export interface NodePolicies {
    memory?: MemoryPolicy;
    discovery?: DiscoveryPolicy;
    persona?: PersonaPolicy;
    guardrails?: GuardrailPolicy;
    checkpoint?: 'before' | 'after' | 'both' | 'none';
    effectClass?: EffectClass;
}
/**
 * No-op retained for backward compatibility with tests that previously
 * relied on the now-removed sequential `nodeCounter`.
 * @deprecated Node IDs are now UUID-based; resetting has no effect.
 */
export declare function __resetNodeCounter(): void;
export declare function gmiNode(config: {
    instructions: string;
    executionMode?: NodeExecutionMode;
    maxInternalIterations?: number;
    parallelTools?: boolean;
    temperature?: number;
    maxTokens?: number;
}, policies?: NodePolicies): GraphNode;
export declare function toolNode(toolName: string, config?: {
    timeout?: number;
    retryPolicy?: RetryPolicy;
    args?: Record<string, unknown>;
}, policies?: NodePolicies): GraphNode;
/**
 * Creates a human-in-the-loop node that suspends execution until a human
 * (or automated surrogate) provides a decision.
 *
 * @param config.prompt - Message displayed to the human operator.
 * @param config.timeout - Maximum wall-clock milliseconds before the node is aborted or handled by `onTimeout`.
 * @param config.autoAccept - Auto-accept without human input. Useful for testing/dev.
 * @param config.autoReject - Auto-reject without human input. Pass a string to include a rejection reason.
 * @param config.judge - Delegate to an LLM judge instead of a human. When the judge's confidence
 *   falls below `confidenceThreshold`, the node falls through to a normal human interrupt.
 * @param config.onTimeout - Behaviour when timeout expires: `'accept'`, `'reject'`, or `'error'` (default).
 * @param policies - Optional per-node policy overrides.
 */
export declare function humanNode(config: {
    prompt: string;
    timeout?: number;
    /** Auto-accept without human input. Useful for testing/dev. */
    autoAccept?: boolean;
    /** Auto-reject without human input. */
    autoReject?: boolean | string;
    /** Delegate to LLM judge instead of human. */
    judge?: {
        model?: string;
        provider?: string;
        criteria?: string;
        confidenceThreshold?: number;
    };
    /** What to do when timeout expires. @default 'error' */
    onTimeout?: 'accept' | 'reject' | 'error';
    /**
     * Run guardrails AFTER approval to catch destructive actions.
     *
     * Even when the node auto-accepts or is approved by an LLM judge,
     * guardrails can still veto the decision as a safety net. When a
     * guardrail blocks, the node returns `approved: false` with the
     * guardrail's reason.
     *
     * Set to `false` to disable the guardrail safety net for this node.
     *
     * @default true
     */
    guardrailOverride?: boolean;
}, policies?: NodePolicies): GraphNode;
export declare function routerNode(routeFn: ((state: any) => string) | string): GraphNode;
export declare function guardrailNode(guardrailIds: string[], config: {
    onViolation: 'block' | 'reroute' | 'warn' | 'sanitize';
    rerouteTarget?: string;
}): GraphNode;
/**
 * Creates an LLM-as-judge evaluation node with structured rubric output.
 * The judge is a gmiNode that enforces single_turn execution and structured JSON output.
 *
 * @param config.rubric - Evaluation criteria description
 * @param config.schema - Zod schema for structured score output
 * @param config.threshold - Optional minimum passing score per dimension
 * @param config.model - Optional model override for the judge LLM
 */
export declare function judgeNode(config: {
    rubric: string;
    schema: any;
    threshold?: number;
    model?: string;
}, policies?: NodePolicies): GraphNode;
export declare function subgraphNode(compiledGraph: CompiledExecutionGraph, config?: {
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
}): GraphNode;
//# sourceMappingURL=nodes.d.ts.map