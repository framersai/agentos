/**
 * @fileoverview Task outcome telemetry — rolling KPI windows, adaptive execution,
 * and alert generation. Extracted from AgentOSOrchestrator for readability.
 */

import type { GMIOutput } from '../cognitive_substrate/IGMI';
import type {
  TaskOutcomeTelemetryScope,
  AgentOSTaskOutcomeTelemetryConfig,
  AgentOSAdaptiveExecutionConfig,
  TaskOutcomeKpiWindowEntry,
  ITaskOutcomeTelemetryStore,
} from './types/OrchestratorConfig';
import type { TurnPlan, ToolFailureMode } from '../core/orchestration/TurnPlanner';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function resolveTaskOutcomeTelemetryConfig(
  config: AgentOSTaskOutcomeTelemetryConfig | undefined,
): ResolvedTaskOutcomeTelemetryConfig {
  const scope: TaskOutcomeTelemetryScope =
    config?.scope === 'global' || config?.scope === 'organization'
      ? config.scope
      : 'organization_persona';
  return {
    enabled: config?.enabled !== false,
    rollingWindowSize: clampInteger(config?.rollingWindowSize, 100, 5, 5000),
    scope,
    emitAlerts: config?.emitAlerts !== false,
    alertBelowWeightedSuccessRate: Math.max(
      0,
      Math.min(1, Number(config?.alertBelowWeightedSuccessRate ?? 0.55)),
    ),
    alertMinSamples: clampInteger(config?.alertMinSamples, 8, 1, 10000),
    alertCooldownMs: clampInteger(config?.alertCooldownMs, 60000, 0, 86400000),
  };
}

export function resolveAdaptiveExecutionConfig(
  config: AgentOSAdaptiveExecutionConfig | undefined,
): ResolvedAdaptiveExecutionConfig {
  return {
    enabled: config?.enabled !== false,
    minSamples: clampInteger(config?.minSamples, 5, 1, 1000),
    minWeightedSuccessRate: Math.max(
      0,
      Math.min(1, Number(config?.minWeightedSuccessRate ?? 0.7)),
    ),
    forceAllToolsWhenDegraded: config?.forceAllToolsWhenDegraded !== false,
    forceFailOpenWhenDegraded: config?.forceFailOpenWhenDegraded !== false,
  };
}

export function sanitizeKpiEntry(raw: any): TaskOutcomeKpiWindowEntry | null {
  const status = raw?.status;
  const validStatus: TaskOutcomeStatus | null =
    status === 'success' || status === 'partial' || status === 'failed' ? status : null;
  if (!validStatus) return null;

  const scoreNum = Number(raw?.score);
  const timestampNum = Number(raw?.timestamp);
  if (!Number.isFinite(scoreNum) || !Number.isFinite(timestampNum)) return null;

  return {
    status: validStatus,
    score: Math.max(0, Math.min(1, scoreNum)),
    timestamp: Math.max(0, Math.trunc(timestampNum)),
  };
}

function normalizeTaskOutcomeOverride(
  customFlags: Record<string, any> | undefined,
): TaskOutcomeAssessment | null {
  if (!customFlags) return null;
  const raw = customFlags.taskOutcome ?? customFlags.task_outcome;
  if (raw == null) return null;

  if (typeof raw === 'boolean') {
    return {
      status: raw ? 'success' : 'failed',
      score: raw ? 1 : 0,
      reason: 'Caller explicitly set task outcome boolean.',
      source: 'request_override',
    };
  }
  if (typeof raw === 'number') {
    const clamped = Math.max(0, Math.min(1, raw));
    return {
      status: clamped >= 0.7 ? 'success' : clamped >= 0.3 ? 'partial' : 'failed',
      score: clamped,
      reason: 'Caller supplied numeric task outcome score.',
      source: 'request_override',
    };
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (['success', 'succeeded', 'done', 'completed', 'true'].includes(normalized)) {
    return { status: 'success', score: 1, reason: 'Caller marked task successful.', source: 'request_override' };
  }
  if (['failed', 'failure', 'error', 'false'].includes(normalized)) {
    return { status: 'failed', score: 0, reason: 'Caller marked task failed.', source: 'request_override' };
  }
  if (['partial', 'partially', 'mixed'].includes(normalized)) {
    return { status: 'partial', score: 0.5, reason: 'Caller marked task as partial.', source: 'request_override' };
  }
  return null;
}

function normalizeRequestedToolFailureMode(
  customFlags: Record<string, any> | undefined,
): ToolFailureMode | null {
  if (!customFlags) return null;
  const raw = customFlags.toolFailureMode ?? customFlags.tool_failure_mode;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (normalized === 'fail_open') return 'fail_open';
  if (normalized === 'fail_closed') return 'fail_closed';
  return null;
}

export function evaluateTaskOutcome(args: {
  finalOutput: GMIOutput;
  didForceTerminate: boolean;
  degraded: boolean;
  customFlags?: Record<string, any>;
}): TaskOutcomeAssessment {
  const override = normalizeTaskOutcomeOverride(args.customFlags);
  if (override) return override;

  if (args.didForceTerminate || args.finalOutput.error) {
    return {
      status: 'failed',
      score: 0,
      reason: args.didForceTerminate
        ? 'Turn force-terminated due to iteration cap.'
        : 'Final response contains an error payload.',
      source: 'heuristic',
    };
  }

  const text = typeof args.finalOutput.responseText === 'string'
    ? args.finalOutput.responseText.trim()
    : '';
  if (text.length >= 48) {
    return {
      status: 'success',
      score: args.degraded ? 0.85 : 0.95,
      reason: 'Final response was produced without terminal errors.',
      source: 'heuristic',
    };
  }
  if (text.length > 0 || (args.finalOutput.toolCalls?.length ?? 0) > 0) {
    return {
      status: 'partial',
      score: args.degraded ? 0.5 : 0.6,
      reason: 'Turn completed but produced a limited final response.',
      source: 'heuristic',
    };
  }
  return {
    status: 'failed',
    score: 0.1,
    reason: 'No usable final response was produced.',
    source: 'heuristic',
  };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

function normalizeOrganizationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Manages rolling task outcome KPI windows, adaptive execution policies,
 * and alert generation. Designed to be used as a delegate within AgentOSOrchestrator.
 */
export class TaskOutcomeTelemetryManager {
  readonly kpiWindows = new Map<string, TaskOutcomeKpiWindowEntry[]>();
  readonly alertState = new Map<string, number>();

  constructor(
    private readonly telemetryConfig: ResolvedTaskOutcomeTelemetryConfig,
    private readonly adaptiveConfig: ResolvedAdaptiveExecutionConfig,
    private readonly store?: ITaskOutcomeTelemetryStore,
  ) {}

  async loadPersistedWindows(): Promise<void> {
    if (!this.store || !this.telemetryConfig.enabled) return;
    try {
      const persisted = await this.store.loadWindows();
      const cap = this.telemetryConfig.rollingWindowSize;
      for (const [scopeKey, rawEntries] of Object.entries(persisted ?? {})) {
        if (!Array.isArray(rawEntries)) continue;
        const normalized = rawEntries
          .map((entry) => sanitizeKpiEntry(entry))
          .filter((entry): entry is TaskOutcomeKpiWindowEntry => Boolean(entry))
          .sort((a, b) => a.timestamp - b.timestamp);
        if (normalized.length === 0) continue;
        this.kpiWindows.set(scopeKey, normalized.slice(Math.max(0, normalized.length - cap)));
      }
    } catch (error: any) {
      console.warn('TaskOutcomeTelemetryManager: Failed to load persisted windows.', error);
    }
  }

  resolveScopeKey(args: { organizationId?: string; personaId?: string }): string {
    const scope = this.telemetryConfig.scope;
    const org = normalizeOrganizationId(args.organizationId) ?? 'none';
    const persona = normalizeOrganizationId(args.personaId) ?? 'unknown';
    if (scope === 'global') return 'global';
    if (scope === 'organization') return `org:${org}`;
    return `org:${org}:persona:${persona}`;
  }

  updateKpi(args: {
    outcome: TaskOutcomeAssessment;
    organizationId?: string;
    personaId?: string;
  }): TaskOutcomeKpiSummary | null {
    if (!this.telemetryConfig.enabled) return null;

    const scopeKey = this.resolveScopeKey(args);
    const window = this.kpiWindows.get(scopeKey) ?? [];
    window.push({
      status: args.outcome.status,
      score: Math.max(0, Math.min(1, Number(args.outcome.score) || 0)),
      timestamp: Date.now(),
    });

    const cap = this.telemetryConfig.rollingWindowSize;
    if (window.length > cap) window.splice(0, window.length - cap);
    this.kpiWindows.set(scopeKey, window);

    if (this.store) {
      void this.store
        .saveWindow(scopeKey, window.map((e) => ({ ...e })))
        .catch((err: any) => console.warn(`Failed to persist KPI window for '${scopeKey}'.`, err));
    }

    return this.summarizeWindow(scopeKey);
  }

  getCurrentKpi(args: { organizationId?: string; personaId?: string }): TaskOutcomeKpiSummary | null {
    if (!this.telemetryConfig.enabled) return null;
    return this.summarizeWindow(this.resolveScopeKey(args));
  }

  summarizeWindow(scopeKey: string): TaskOutcomeKpiSummary | null {
    const window = this.kpiWindows.get(scopeKey) ?? [];
    if (window.length === 0) return null;

    let successCount = 0, partialCount = 0, failedCount = 0, scoreSum = 0;
    for (const entry of window) {
      if (entry.status === 'success') successCount++;
      else if (entry.status === 'partial') partialCount++;
      else failedCount++;
      scoreSum += entry.score;
    }

    const sampleCount = window.length;
    return {
      scopeKey,
      scopeMode: this.telemetryConfig.scope,
      windowSize: this.telemetryConfig.rollingWindowSize,
      sampleCount,
      successCount,
      partialCount,
      failedCount,
      successRate: sampleCount > 0 ? successCount / sampleCount : 0,
      averageScore: sampleCount > 0 ? scoreSum / sampleCount : 0,
      weightedSuccessRate: sampleCount > 0 ? scoreSum / sampleCount : 0,
      timestamp: new Date().toISOString(),
    };
  }

  maybeApplyAdaptivePolicy(args: {
    turnPlan: TurnPlan | null;
    organizationId?: string;
    personaId?: string;
    requestCustomFlags?: Record<string, any>;
  }): AdaptiveExecutionDecision {
    if (!this.adaptiveConfig.enabled || !args.turnPlan) return { applied: false };

    const kpi = this.getCurrentKpi({ organizationId: args.organizationId, personaId: args.personaId });
    if (!kpi) return { applied: false, kpi };
    if (kpi.sampleCount < this.adaptiveConfig.minSamples) return { applied: false, kpi };
    if (kpi.weightedSuccessRate >= this.adaptiveConfig.minWeightedSuccessRate) return { applied: false, kpi };

    const reasons: string[] = [
      `weightedSuccessRate=${kpi.weightedSuccessRate.toFixed(3)} below threshold=${this.adaptiveConfig.minWeightedSuccessRate.toFixed(3)}`,
    ];
    let forcedToolSelectionMode = false;
    let forcedToolFailureMode = false;
    let preservedRequestedFailClosed = false;

    if (this.adaptiveConfig.forceAllToolsWhenDegraded && args.turnPlan.policy.toolSelectionMode === 'discovered') {
      args.turnPlan.policy.toolSelectionMode = 'all';
      forcedToolSelectionMode = true;
      reasons.push('toolSelectionMode switched discovered -> all');
    }

    if (this.adaptiveConfig.forceFailOpenWhenDegraded && args.turnPlan.policy.toolFailureMode !== 'fail_open') {
      const requested = normalizeRequestedToolFailureMode(args.requestCustomFlags);
      if (requested === 'fail_closed') {
        preservedRequestedFailClosed = true;
        reasons.push('preserved explicit request override toolFailureMode=fail_closed');
      } else {
        const before = args.turnPlan.policy.toolFailureMode;
        args.turnPlan.policy.toolFailureMode = 'fail_open';
        forcedToolFailureMode = true;
        reasons.push(`toolFailureMode switched ${before} -> fail_open`);
      }
    }

    if (!forcedToolSelectionMode && !forcedToolFailureMode) {
      return {
        applied: false,
        reason: preservedRequestedFailClosed
          ? 'Adaptive execution detected degraded KPI but preserved explicit fail-closed request override.'
          : undefined,
        kpi,
        actions: preservedRequestedFailClosed ? { preservedRequestedFailClosed: true } : undefined,
      };
    }

    args.turnPlan.capability.fallbackApplied = true;
    args.turnPlan.capability.fallbackReason = `Adaptive fallback applied: ${reasons.join('; ')}.`;
    args.turnPlan.diagnostics.usedFallback = true;

    return {
      applied: true,
      reason: args.turnPlan.capability.fallbackReason,
      kpi,
      actions: {
        forcedToolSelectionMode,
        forcedToolFailureMode,
        preservedRequestedFailClosed: preservedRequestedFailClosed || undefined,
      },
    };
  }

  maybeBuildAlert(kpi: TaskOutcomeKpiSummary | null): TaskOutcomeKpiAlert | null {
    if (!this.telemetryConfig.enabled || !this.telemetryConfig.emitAlerts || !kpi) return null;
    if (kpi.sampleCount < this.telemetryConfig.alertMinSamples) return null;
    if (kpi.weightedSuccessRate >= this.telemetryConfig.alertBelowWeightedSuccessRate) return null;

    const now = Date.now();
    const lastAlertAt = this.alertState.get(kpi.scopeKey) ?? 0;
    if (this.telemetryConfig.alertCooldownMs > 0 && now - lastAlertAt < this.telemetryConfig.alertCooldownMs) return null;
    this.alertState.set(kpi.scopeKey, now);

    return {
      scopeKey: kpi.scopeKey,
      severity: kpi.weightedSuccessRate < this.telemetryConfig.alertBelowWeightedSuccessRate * 0.6 ? 'critical' : 'warning',
      reason: `Weighted success rate ${kpi.weightedSuccessRate.toFixed(3)} below alert threshold ${this.telemetryConfig.alertBelowWeightedSuccessRate.toFixed(3)}.`,
      threshold: this.telemetryConfig.alertBelowWeightedSuccessRate,
      value: kpi.weightedSuccessRate,
      sampleCount: kpi.sampleCount,
      timestamp: new Date(now).toISOString(),
    };
  }
}
