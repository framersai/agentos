import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureAgentOSObservability,
  getAgentOSObservabilityState,
} from '../../../src/core/observability/otel';

const ENV_KEYS = [
  'AGENTOS_OBSERVABILITY_ENABLED',
  'AGENTOS_TRACING_ENABLED',
  'AGENTOS_METRICS_ENABLED',
  'AGENTOS_TRACE_IDS_IN_RESPONSES',
  'AGENTOS_LOG_TRACE_IDS',
  'AGENTOS_OTEL_TRACER_NAME',
  'AGENTOS_OTEL_METER_NAME',
  'AGENTOS_OTEL_LOGS_ENABLED',
  'AGENTOS_OTEL_LOGGER_NAME',
] as const;

describe('AgentOS OTEL config (opt-in)', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    configureAgentOSObservability(undefined);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    configureAgentOSObservability(undefined);
  });

  it('defaults to disabled', () => {
    const state = getAgentOSObservabilityState();
    expect(state.tracingEnabled).toBe(false);
    expect(state.includeTraceIdsInLogs).toBe(false);
    expect(state.includeTraceInResponses).toBe(false);
    expect(state.tracerName).toBe('@framers/agentos');
    expect(state.metricsEnabled).toBe(false);
    expect(state.meterName).toBe('@framers/agentos');
    expect(state.exportOtelLogs).toBe(false);
    expect(state.otelLoggerName).toBe('@framers/agentos');
  });

  it('enables tracing + log correlation via AGENTOS_OBSERVABILITY_ENABLED', () => {
    process.env.AGENTOS_OBSERVABILITY_ENABLED = 'true';
    configureAgentOSObservability(undefined);
    const state = getAgentOSObservabilityState();
    expect(state.tracingEnabled).toBe(true);
    expect(state.includeTraceIdsInLogs).toBe(true);
    expect(state.includeTraceInResponses).toBe(false);
    expect(state.metricsEnabled).toBe(true);
    expect(state.exportOtelLogs).toBe(false);
  });

  it('config can hard-disable everything even if env enabled', () => {
    process.env.AGENTOS_OBSERVABILITY_ENABLED = 'true';
    configureAgentOSObservability({ enabled: false });
    const state = getAgentOSObservabilityState();
    expect(state.tracingEnabled).toBe(false);
    expect(state.includeTraceIdsInLogs).toBe(false);
    expect(state.includeTraceInResponses).toBe(false);
    expect(state.metricsEnabled).toBe(false);
    expect(state.exportOtelLogs).toBe(false);
  });

  it('config can enable tracing while keeping logs disabled', () => {
    configureAgentOSObservability({
      tracing: { enabled: true, includeTraceInResponses: true, tracerName: 'test-agentos' },
      logging: { includeTraceIds: false },
    });
    const state = getAgentOSObservabilityState();
    expect(state.tracingEnabled).toBe(true);
    expect(state.includeTraceIdsInLogs).toBe(false);
    expect(state.includeTraceInResponses).toBe(true);
    expect(state.tracerName).toBe('test-agentos');
    expect(state.metricsEnabled).toBe(false);
    expect(state.exportOtelLogs).toBe(false);
  });

  it('config can enable metrics without tracing', () => {
    configureAgentOSObservability({
      metrics: { enabled: true, meterName: 'test-agentos-meter' },
      tracing: { enabled: false },
      logging: { includeTraceIds: false },
    });
    const state = getAgentOSObservabilityState();
    expect(state.tracingEnabled).toBe(false);
    expect(state.metricsEnabled).toBe(true);
    expect(state.meterName).toBe('test-agentos-meter');
    expect(state.exportOtelLogs).toBe(false);
  });

  it('config can enable OTEL log export', () => {
    configureAgentOSObservability({
      logging: { exportToOtel: true, otelLoggerName: 'test-agentos-logger' },
      tracing: { enabled: false },
      metrics: { enabled: false },
    });
    const state = getAgentOSObservabilityState();
    expect(state.exportOtelLogs).toBe(true);
    expect(state.otelLoggerName).toBe('test-agentos-logger');
  });
});
