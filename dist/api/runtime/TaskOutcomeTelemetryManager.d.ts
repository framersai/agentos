/**
 * @fileoverview Task outcome telemetry — rolling KPI windows, adaptive execution,
 * and alert generation. Extracted from AgentOSOrchestrator for readability.
 */
import type { GMIOutput } from '../../cognitive_substrate/IGMI';
import type { TaskOutcomeTelemetryScope, AgentOSTaskOutcomeTelemetryConfig, AgentOSAdaptiveExecutionConfig, TaskOutcomeKpiWindowEntry, ITaskOutcomeTelemetryStore } from '../types/OrchestratorConfig';
import type { TurnPlan } from '../../orchestration/turn-planner/TurnPlanner';
type TaskOutcomeStatus = 'success' | 'partial' | 'failed';
export type TaskOutcomeAssessment = {
    status: TaskOutcomeStatus;
    score: number;
    reason: string;
    source: 'heuristic' | 'request_override';
};
export type TaskOutcomeKpiSummary = {
    scopeKey: string;
    scopeMode: TaskOutcomeTelemetryScope;
    windowSize: number;
    sampleCount: number;
    successCount: number;
    partialCount: number;
    failedCount: number;
    successRate: number;
    averageScore: number;
    weightedSuccessRate: number;
    timestamp: string;
};
export type TaskOutcomeKpiAlert = {
    scopeKey: string;
    severity: 'warning' | 'critical';
    reason: string;
    threshold: number;
    value: number;
    sampleCount: number;
    timestamp: string;
};
export type AdaptiveExecutionDecision = {
    applied: boolean;
    reason?: string;
    kpi?: TaskOutcomeKpiSummary | null;
    actions?: {
        forcedToolSelectionMode?: boolean;
        forcedToolFailureMode?: boolean;
        preservedRequestedFailClosed?: boolean;
    };
};
export type ResolvedTaskOutcomeTelemetryConfig = {
    enabled: boolean;
    rollingWindowSize: number;
    scope: TaskOutcomeTelemetryScope;
    emitAlerts: boolean;
    alertBelowWeightedSuccessRate: number;
    alertMinSamples: number;
    alertCooldownMs: number;
};
export type ResolvedAdaptiveExecutionConfig = {
    enabled: boolean;
    minSamples: number;
    minWeightedSuccessRate: number;
    forceAllToolsWhenDegraded: boolean;
    forceFailOpenWhenDegraded: boolean;
};
export declare function resolveTaskOutcomeTelemetryConfig(config: AgentOSTaskOutcomeTelemetryConfig | undefined): ResolvedTaskOutcomeTelemetryConfig;
export declare function resolveAdaptiveExecutionConfig(config: AgentOSAdaptiveExecutionConfig | undefined): ResolvedAdaptiveExecutionConfig;
export declare function sanitizeKpiEntry(raw: any): TaskOutcomeKpiWindowEntry | null;
export declare function evaluateTaskOutcome(args: {
    finalOutput: GMIOutput;
    didForceTerminate: boolean;
    degraded: boolean;
    customFlags?: Record<string, any>;
}): TaskOutcomeAssessment;
/**
 * Manages rolling task outcome KPI windows, adaptive execution policies,
 * and alert generation. Designed to be used as a delegate within AgentOSOrchestrator.
 */
export declare class TaskOutcomeTelemetryManager {
    private readonly telemetryConfig;
    private readonly adaptiveConfig;
    private readonly store?;
    readonly kpiWindows: Map<string, TaskOutcomeKpiWindowEntry[]>;
    readonly alertState: Map<string, number>;
    constructor(telemetryConfig: ResolvedTaskOutcomeTelemetryConfig, adaptiveConfig: ResolvedAdaptiveExecutionConfig, store?: ITaskOutcomeTelemetryStore | undefined);
    loadPersistedWindows(): Promise<void>;
    resolveScopeKey(args: {
        organizationId?: string;
        personaId?: string;
    }): string;
    updateKpi(args: {
        outcome: TaskOutcomeAssessment;
        organizationId?: string;
        personaId?: string;
    }): TaskOutcomeKpiSummary | null;
    getCurrentKpi(args: {
        organizationId?: string;
        personaId?: string;
    }): TaskOutcomeKpiSummary | null;
    summarizeWindow(scopeKey: string): TaskOutcomeKpiSummary | null;
    maybeApplyAdaptivePolicy(args: {
        turnPlan: TurnPlan | null;
        organizationId?: string;
        personaId?: string;
        requestCustomFlags?: Record<string, any>;
    }): AdaptiveExecutionDecision;
    maybeBuildAlert(kpi: TaskOutcomeKpiSummary | null): TaskOutcomeKpiAlert | null;
}
export {};
//# sourceMappingURL=TaskOutcomeTelemetryManager.d.ts.map