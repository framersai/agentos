/**
 * @fileoverview Turn planner for AgentOS orchestration.
 *
 * The planner sits before GMI execution and determines:
 * - execution policy for tool failures (fail-open vs fail-closed)
 * - tool selection scope (all tools vs discovery-selected tools)
 * - optional per-turn capability discovery payload
 */
import type { ProcessingOptions } from '../../api/types/AgentOSInput';
import type { IPersonaDefinition } from '../../cognitive_substrate/personas/IPersonaDefinition';
import type { CapabilityDiscoveryResult, CapabilityKind, ICapabilityDiscoveryEngine } from '../../discovery/types';
import type { ILogger } from '../../logging/ILogger';
export type ToolFailureMode = 'fail_open' | 'fail_closed';
export type ToolSelectionMode = 'all' | 'discovered';
export interface TurnPlannerDiscoveryConfig {
    enabled?: boolean;
    onlyAvailable?: boolean;
    defaultKind?: CapabilityKind | 'any';
    includePromptContext?: boolean;
    defaultToolSelectionMode?: ToolSelectionMode;
    /**
     * Number of retry attempts after the initial discovery call.
     * Example: `1` = up to 2 total attempts.
     */
    maxRetries?: number;
    /**
     * Delay between discovery retries in milliseconds.
     */
    retryBackoffMs?: number;
}
export interface TurnPlannerConfig {
    enabled?: boolean;
    defaultToolFailureMode?: ToolFailureMode;
    allowRequestOverrides?: boolean;
    discovery?: TurnPlannerDiscoveryConfig;
}
export interface TurnPlanningRequestContext {
    userId: string;
    organizationId?: string;
    sessionId: string;
    conversationId?: string;
    persona: IPersonaDefinition;
    userMessage: string;
    options?: ProcessingOptions;
    excludedCapabilityIds?: string[];
}
export interface TurnExecutionPolicy {
    plannerVersion: string;
    toolFailureMode: ToolFailureMode;
    toolSelectionMode: ToolSelectionMode;
}
export interface TurnCapabilityPlan {
    enabled: boolean;
    query: string;
    kind: CapabilityKind | 'any';
    category?: string;
    onlyAvailable: boolean;
    selectedToolNames: string[];
    promptContext?: string;
    result?: CapabilityDiscoveryResult;
    fallbackApplied?: boolean;
    fallbackReason?: string;
}
export interface TurnPlanningDiagnostics {
    planningLatencyMs: number;
    discoveryAttempted: boolean;
    discoveryApplied: boolean;
    discoveryAttempts: number;
    usedFallback: boolean;
}
export interface TurnPlan {
    policy: TurnExecutionPolicy;
    capability: TurnCapabilityPlan;
    diagnostics: TurnPlanningDiagnostics;
}
export interface ITurnPlanner {
    readonly plannerId: string;
    planTurn(input: TurnPlanningRequestContext): Promise<TurnPlan>;
    isDiscoveryAvailable(): boolean;
}
export declare class AgentOSTurnPlanner implements ITurnPlanner {
    private readonly discoveryEngine?;
    private readonly logger?;
    readonly plannerId = "agentos-turn-planner-v1";
    private readonly config;
    constructor(config?: TurnPlannerConfig, discoveryEngine?: ICapabilityDiscoveryEngine | undefined, logger?: ILogger | undefined);
    isDiscoveryAvailable(): boolean;
    planTurn(input: TurnPlanningRequestContext): Promise<TurnPlan>;
}
//# sourceMappingURL=TurnPlanner.d.ts.map