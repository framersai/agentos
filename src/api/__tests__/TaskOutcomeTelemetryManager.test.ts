import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateTaskOutcome,
  sanitizeKpiEntry,
  resolveTaskOutcomeTelemetryConfig,
  resolveAdaptiveExecutionConfig,
  TaskOutcomeTelemetryManager,
  type TaskOutcomeAssessment,
  type ResolvedTaskOutcomeTelemetryConfig,
  type ResolvedAdaptiveExecutionConfig,
} from '../TaskOutcomeTelemetryManager';
import type { GMIOutput } from '../../cognitive_substrate/IGMI';
import type { TurnPlan } from '../../core/orchestration/TurnPlanner';

// ---------------------------------------------------------------------------
// evaluateTaskOutcome
// ---------------------------------------------------------------------------

describe('evaluateTaskOutcome', () => {
  const baseFinalOutput: GMIOutput = {
    isFinal: true,
    responseText: null,
    toolCalls: [],
  };

  it('returns success for a long response text (>= 48 chars)', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'A'.repeat(50) },
      didForceTerminate: false,
      degraded: false,
    });
    expect(result.status).toBe('success');
    expect(result.score).toBe(0.95);
    expect(result.source).toBe('heuristic');
  });

  it('reduces score when degraded and response is long', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'B'.repeat(60) },
      didForceTerminate: false,
      degraded: true,
    });
    expect(result.status).toBe('success');
    expect(result.score).toBe(0.85);
  });

  it('returns failed when force-terminated', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'A'.repeat(100) },
      didForceTerminate: true,
      degraded: false,
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('force-terminated');
  });

  it('returns failed when finalOutput has an error', () => {
    const result = evaluateTaskOutcome({
      finalOutput: {
        ...baseFinalOutput,
        error: { code: 'ERR', message: 'something broke' },
      },
      didForceTerminate: false,
      degraded: false,
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('error payload');
  });

  it('returns partial for a short response text (> 0, < 48 chars)', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'Short.' },
      didForceTerminate: false,
      degraded: false,
    });
    expect(result.status).toBe('partial');
    expect(result.score).toBe(0.6);
  });

  it('returns partial (degraded) for a short response when degraded', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'Short.' },
      didForceTerminate: false,
      degraded: true,
    });
    expect(result.status).toBe('partial');
    expect(result.score).toBe(0.5);
  });

  it('returns partial when response is empty but tool calls exist', () => {
    const result = evaluateTaskOutcome({
      finalOutput: {
        ...baseFinalOutput,
        responseText: '',
        toolCalls: [{ id: 't1', name: 'test', arguments: {} }],
      },
      didForceTerminate: false,
      degraded: false,
    });
    expect(result.status).toBe('partial');
  });

  it('returns failed for empty response and no tool calls', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: '', toolCalls: [] },
      didForceTerminate: false,
      degraded: false,
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0.1);
  });

  // --- customFlags overrides ---

  it('override via customFlags boolean true', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: true },
    });
    expect(result.status).toBe('success');
    expect(result.score).toBe(1);
    expect(result.source).toBe('request_override');
  });

  it('override via customFlags boolean false', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: false },
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
    expect(result.source).toBe('request_override');
  });

  it('override via customFlags numeric score', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { task_outcome: 0.5 },
    });
    expect(result.status).toBe('partial');
    expect(result.score).toBe(0.5);
    expect(result.source).toBe('request_override');
  });

  it('override via customFlags high numeric score maps to success', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 0.8 },
    });
    expect(result.status).toBe('success');
    expect(result.score).toBe(0.8);
  });

  it('override via customFlags low numeric score maps to failed', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 0.1 },
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0.1);
  });

  it('override via customFlags string "success"', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 'success' },
    });
    expect(result.status).toBe('success');
    expect(result.score).toBe(1);
    expect(result.source).toBe('request_override');
  });

  it('override via customFlags string "failed"', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 'failed' },
    });
    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
  });

  it('override via customFlags string "partial"', () => {
    const result = evaluateTaskOutcome({
      finalOutput: baseFinalOutput,
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 'partial' },
    });
    expect(result.status).toBe('partial');
    expect(result.score).toBe(0.5);
  });

  it('ignores unrecognized string override and falls back to heuristic', () => {
    const result = evaluateTaskOutcome({
      finalOutput: { ...baseFinalOutput, responseText: 'A'.repeat(50) },
      didForceTerminate: false,
      degraded: false,
      customFlags: { taskOutcome: 'unknown_value' },
    });
    expect(result.source).toBe('heuristic');
    expect(result.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// sanitizeKpiEntry
// ---------------------------------------------------------------------------

describe('sanitizeKpiEntry', () => {
  it('returns a valid entry for valid input', () => {
    const entry = sanitizeKpiEntry({ status: 'success', score: 0.9, timestamp: 1000 });
    expect(entry).toEqual({ status: 'success', score: 0.9, timestamp: 1000 });
  });

  it('clamps score to [0, 1]', () => {
    const high = sanitizeKpiEntry({ status: 'failed', score: 5, timestamp: 500 });
    expect(high!.score).toBe(1);
    const low = sanitizeKpiEntry({ status: 'partial', score: -2, timestamp: 500 });
    expect(low!.score).toBe(0);
  });

  it('truncates timestamp to integer', () => {
    const entry = sanitizeKpiEntry({ status: 'success', score: 0.5, timestamp: 1234.7 });
    expect(entry!.timestamp).toBe(1234);
  });

  it('returns null for invalid status', () => {
    expect(sanitizeKpiEntry({ status: 'unknown', score: 0.5, timestamp: 100 })).toBeNull();
  });

  it('returns null for missing status', () => {
    expect(sanitizeKpiEntry({ score: 0.5, timestamp: 100 })).toBeNull();
  });

  it('returns null for non-finite score', () => {
    expect(sanitizeKpiEntry({ status: 'success', score: NaN, timestamp: 100 })).toBeNull();
    expect(sanitizeKpiEntry({ status: 'success', score: Infinity, timestamp: 100 })).toBeNull();
  });

  it('returns null for non-finite timestamp', () => {
    expect(sanitizeKpiEntry({ status: 'success', score: 0.5, timestamp: NaN })).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(sanitizeKpiEntry(null)).toBeNull();
    expect(sanitizeKpiEntry(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveTaskOutcomeTelemetryConfig
// ---------------------------------------------------------------------------

describe('resolveTaskOutcomeTelemetryConfig', () => {
  it('returns sensible defaults when config is undefined', () => {
    const resolved = resolveTaskOutcomeTelemetryConfig(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.rollingWindowSize).toBe(100);
    expect(resolved.scope).toBe('organization_persona');
    expect(resolved.emitAlerts).toBe(true);
    expect(resolved.alertBelowWeightedSuccessRate).toBeCloseTo(0.55);
    expect(resolved.alertMinSamples).toBe(8);
    expect(resolved.alertCooldownMs).toBe(60000);
  });

  it('respects explicit overrides', () => {
    const resolved = resolveTaskOutcomeTelemetryConfig({
      enabled: false,
      rollingWindowSize: 50,
      scope: 'global',
      emitAlerts: false,
      alertBelowWeightedSuccessRate: 0.3,
      alertMinSamples: 20,
      alertCooldownMs: 5000,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.rollingWindowSize).toBe(50);
    expect(resolved.scope).toBe('global');
    expect(resolved.emitAlerts).toBe(false);
    expect(resolved.alertBelowWeightedSuccessRate).toBeCloseTo(0.3);
    expect(resolved.alertMinSamples).toBe(20);
    expect(resolved.alertCooldownMs).toBe(5000);
  });

  it('clamps rollingWindowSize within bounds', () => {
    expect(resolveTaskOutcomeTelemetryConfig({ rollingWindowSize: 1 }).rollingWindowSize).toBe(5);
    expect(resolveTaskOutcomeTelemetryConfig({ rollingWindowSize: 99999 }).rollingWindowSize).toBe(5000);
  });

  it('defaults scope to organization_persona for unknown scope values', () => {
    expect(resolveTaskOutcomeTelemetryConfig({ scope: 'invalid' as any }).scope).toBe('organization_persona');
  });
});

// ---------------------------------------------------------------------------
// resolveAdaptiveExecutionConfig
// ---------------------------------------------------------------------------

describe('resolveAdaptiveExecutionConfig', () => {
  it('returns sensible defaults when config is undefined', () => {
    const resolved = resolveAdaptiveExecutionConfig(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.minSamples).toBe(5);
    expect(resolved.minWeightedSuccessRate).toBeCloseTo(0.7);
    expect(resolved.forceAllToolsWhenDegraded).toBe(true);
    expect(resolved.forceFailOpenWhenDegraded).toBe(true);
  });

  it('respects explicit overrides', () => {
    const resolved = resolveAdaptiveExecutionConfig({
      enabled: false,
      minSamples: 10,
      minWeightedSuccessRate: 0.5,
      forceAllToolsWhenDegraded: false,
      forceFailOpenWhenDegraded: false,
    });
    expect(resolved.enabled).toBe(false);
    expect(resolved.minSamples).toBe(10);
    expect(resolved.minWeightedSuccessRate).toBeCloseTo(0.5);
    expect(resolved.forceAllToolsWhenDegraded).toBe(false);
    expect(resolved.forceFailOpenWhenDegraded).toBe(false);
  });

  it('clamps minSamples', () => {
    expect(resolveAdaptiveExecutionConfig({ minSamples: -5 }).minSamples).toBe(1);
    expect(resolveAdaptiveExecutionConfig({ minSamples: 99999 }).minSamples).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// TaskOutcomeTelemetryManager
// ---------------------------------------------------------------------------

describe('TaskOutcomeTelemetryManager', () => {
  const defaultTelemetryConfig: ResolvedTaskOutcomeTelemetryConfig = {
    enabled: true,
    rollingWindowSize: 10,
    scope: 'organization_persona',
    emitAlerts: true,
    alertBelowWeightedSuccessRate: 0.55,
    alertMinSamples: 3,
    alertCooldownMs: 60000,
  };

  const defaultAdaptiveConfig: ResolvedAdaptiveExecutionConfig = {
    enabled: true,
    minSamples: 3,
    minWeightedSuccessRate: 0.7,
    forceAllToolsWhenDegraded: true,
    forceFailOpenWhenDegraded: true,
  };

  let manager: TaskOutcomeTelemetryManager;

  beforeEach(() => {
    manager = new TaskOutcomeTelemetryManager(defaultTelemetryConfig, defaultAdaptiveConfig);
  });

  // --- updateKpi ---

  describe('updateKpi', () => {
    it('adds entries and returns a summary', () => {
      const outcome: TaskOutcomeAssessment = {
        status: 'success',
        score: 0.95,
        reason: 'test',
        source: 'heuristic',
      };
      const summary = manager.updateKpi({ outcome, organizationId: 'org1', personaId: 'p1' });
      expect(summary).not.toBeNull();
      expect(summary!.sampleCount).toBe(1);
      expect(summary!.successCount).toBe(1);
      expect(summary!.failedCount).toBe(0);
      expect(summary!.scopeKey).toBe('org:org1:persona:p1');
    });

    it('respects rolling window cap', () => {
      for (let i = 0; i < 15; i++) {
        manager.updateKpi({
          outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' },
          organizationId: 'org1',
          personaId: 'p1',
        });
      }
      const summary = manager.updateKpi({
        outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
        organizationId: 'org1',
        personaId: 'p1',
      });
      // Window cap is 10 — 15 success + 1 failed = 16, trimmed to last 10
      expect(summary!.sampleCount).toBe(10);
    });

    it('returns null when telemetry is disabled', () => {
      const disabledManager = new TaskOutcomeTelemetryManager(
        { ...defaultTelemetryConfig, enabled: false },
        defaultAdaptiveConfig,
      );
      const summary = disabledManager.updateKpi({
        outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' },
      });
      expect(summary).toBeNull();
    });
  });

  // --- summarizeWindow ---

  describe('summarizeWindow', () => {
    it('returns null for an empty window', () => {
      expect(manager.summarizeWindow('nonexistent')).toBeNull();
    });

    it('computes correct stats', () => {
      manager.updateKpi({
        outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' },
        organizationId: 'o',
        personaId: 'p',
      });
      manager.updateKpi({
        outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
        organizationId: 'o',
        personaId: 'p',
      });
      manager.updateKpi({
        outcome: { status: 'partial', score: 0.5, reason: '', source: 'heuristic' },
        organizationId: 'o',
        personaId: 'p',
      });
      const summary = manager.summarizeWindow('org:o:persona:p');
      expect(summary).not.toBeNull();
      expect(summary!.sampleCount).toBe(3);
      expect(summary!.successCount).toBe(1);
      expect(summary!.failedCount).toBe(1);
      expect(summary!.partialCount).toBe(1);
      expect(summary!.successRate).toBeCloseTo(1 / 3);
      expect(summary!.averageScore).toBeCloseTo(0.5);
      expect(summary!.weightedSuccessRate).toBeCloseTo(0.5);
    });
  });

  // --- maybeBuildAlert ---

  describe('maybeBuildAlert', () => {
    it('returns null when kpi is null', () => {
      expect(manager.maybeBuildAlert(null)).toBeNull();
    });

    it('returns null when sample count is below alertMinSamples', () => {
      const kpi = manager.summarizeWindow('global')!;
      // kpi is null since no data
      expect(manager.maybeBuildAlert(kpi)).toBeNull();
    });

    it('returns null when weighted success rate is above threshold', () => {
      // Push enough successes to be above the 0.55 threshold
      for (let i = 0; i < 5; i++) {
        manager.updateKpi({
          outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const kpi = manager.summarizeWindow('org:o:persona:p');
      expect(manager.maybeBuildAlert(kpi)).toBeNull();
    });

    it('triggers alert on low success rate', () => {
      for (let i = 0; i < 4; i++) {
        manager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const kpi = manager.summarizeWindow('org:o:persona:p');
      const alert = manager.maybeBuildAlert(kpi);
      expect(alert).not.toBeNull();
      expect(alert!.scopeKey).toBe('org:o:persona:p');
      expect(alert!.severity).toBe('critical'); // 0.0 < 0.55 * 0.6 = 0.33
      expect(alert!.value).toBe(0);
    });

    it('returns warning severity for moderately low success rate', () => {
      // 3 failed + 1 partial (score 0.5) => weighted = 0.5/4 = 0.125
      // 0.125 < 0.55 * 0.6 = 0.33 => critical still
      // Need weighted > 0.33 but < 0.55 for warning
      // 2 success (score 1) + 2 failed (score 0) => weighted = 2/4 = 0.5 => 0.5 < 0.55 and 0.5 >= 0.33
      manager.updateKpi({ outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' }, organizationId: 'o', personaId: 'p' });
      manager.updateKpi({ outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' }, organizationId: 'o', personaId: 'p' });
      manager.updateKpi({ outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' }, organizationId: 'o', personaId: 'p' });
      manager.updateKpi({ outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' }, organizationId: 'o', personaId: 'p' });
      const kpi = manager.summarizeWindow('org:o:persona:p');
      const alert = manager.maybeBuildAlert(kpi);
      expect(alert).not.toBeNull();
      expect(alert!.severity).toBe('warning');
    });

    it('respects cooldown — second alert within cooldown is suppressed', () => {
      for (let i = 0; i < 4; i++) {
        manager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const kpi = manager.summarizeWindow('org:o:persona:p');
      const first = manager.maybeBuildAlert(kpi);
      expect(first).not.toBeNull();

      // Second call immediately should be suppressed by cooldown
      const second = manager.maybeBuildAlert(kpi);
      expect(second).toBeNull();
    });

    it('returns null when alerts are disabled', () => {
      const noAlertManager = new TaskOutcomeTelemetryManager(
        { ...defaultTelemetryConfig, emitAlerts: false },
        defaultAdaptiveConfig,
      );
      for (let i = 0; i < 4; i++) {
        noAlertManager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const kpi = noAlertManager.summarizeWindow('org:o:persona:p');
      expect(noAlertManager.maybeBuildAlert(kpi)).toBeNull();
    });
  });

  // --- maybeApplyAdaptivePolicy ---

  describe('maybeApplyAdaptivePolicy', () => {
    function makeTurnPlan(overrides?: Partial<TurnPlan>): TurnPlan {
      return {
        policy: {
          plannerVersion: 'v1',
          toolFailureMode: 'fail_closed',
          toolSelectionMode: 'discovered',
          ...overrides?.policy,
        },
        capability: {
          enabled: true,
          query: 'test',
          kind: 'any',
          onlyAvailable: true,
          selectedToolNames: [],
          ...overrides?.capability,
        },
        diagnostics: {
          planningLatencyMs: 5,
          discoveryAttempted: false,
          discoveryApplied: false,
          discoveryAttempts: 0,
          usedFallback: false,
          ...overrides?.diagnostics,
        },
      };
    }

    it('returns not applied when adaptive is disabled', () => {
      const disabled = new TaskOutcomeTelemetryManager(
        defaultTelemetryConfig,
        { ...defaultAdaptiveConfig, enabled: false },
      );
      const decision = disabled.maybeApplyAdaptivePolicy({
        turnPlan: makeTurnPlan(),
      });
      expect(decision.applied).toBe(false);
    });

    it('returns not applied when turnPlan is null', () => {
      const decision = manager.maybeApplyAdaptivePolicy({ turnPlan: null });
      expect(decision.applied).toBe(false);
    });

    it('returns not applied when no KPI data exists', () => {
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan: makeTurnPlan(),
        organizationId: 'o',
        personaId: 'p',
      });
      expect(decision.applied).toBe(false);
    });

    it('returns not applied when sample count is below minSamples', () => {
      manager.updateKpi({
        outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
        organizationId: 'o',
        personaId: 'p',
      });
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan: makeTurnPlan(),
        organizationId: 'o',
        personaId: 'p',
      });
      expect(decision.applied).toBe(false);
    });

    it('returns not applied when success rate is above threshold', () => {
      for (let i = 0; i < 5; i++) {
        manager.updateKpi({
          outcome: { status: 'success', score: 1, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan: makeTurnPlan(),
        organizationId: 'o',
        personaId: 'p',
      });
      expect(decision.applied).toBe(false);
    });

    it('forces toolSelectionMode and toolFailureMode when degraded', () => {
      for (let i = 0; i < 5; i++) {
        manager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const turnPlan = makeTurnPlan();
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan,
        organizationId: 'o',
        personaId: 'p',
      });
      expect(decision.applied).toBe(true);
      expect(turnPlan.policy.toolSelectionMode).toBe('all');
      expect(turnPlan.policy.toolFailureMode).toBe('fail_open');
      expect(turnPlan.capability.fallbackApplied).toBe(true);
      expect(turnPlan.diagnostics.usedFallback).toBe(true);
      expect(decision.actions?.forcedToolSelectionMode).toBe(true);
      expect(decision.actions?.forcedToolFailureMode).toBe(true);
    });

    it('preserves explicit fail_closed request override', () => {
      for (let i = 0; i < 5; i++) {
        manager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const turnPlan = makeTurnPlan();
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan,
        organizationId: 'o',
        personaId: 'p',
        requestCustomFlags: { toolFailureMode: 'fail_closed' },
      });
      // toolSelectionMode should still be forced
      expect(decision.applied).toBe(true);
      expect(turnPlan.policy.toolSelectionMode).toBe('all');
      // But fail_closed is preserved — not overridden
      expect(turnPlan.policy.toolFailureMode).toBe('fail_closed');
      expect(decision.actions?.preservedRequestedFailClosed).toBe(true);
    });

    it('does not apply when toolSelectionMode is already "all" and toolFailureMode is already "fail_open"', () => {
      for (let i = 0; i < 5; i++) {
        manager.updateKpi({
          outcome: { status: 'failed', score: 0, reason: '', source: 'heuristic' },
          organizationId: 'o',
          personaId: 'p',
        });
      }
      const turnPlan = makeTurnPlan({
        policy: {
          plannerVersion: 'v1',
          toolSelectionMode: 'all',
          toolFailureMode: 'fail_open',
        },
      });
      const decision = manager.maybeApplyAdaptivePolicy({
        turnPlan,
        organizationId: 'o',
        personaId: 'p',
      });
      // Neither was changed, so applied is false
      expect(decision.applied).toBe(false);
    });
  });
});
