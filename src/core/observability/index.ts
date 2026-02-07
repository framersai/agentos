/**
 * @file Observability Module Index
 * @description Exports for tracing and observability.
 * @module AgentOS/Observability
 */

export type {
  ITracer,
  ISpan,
  ISpanExporter,
  TraceContext,
  SpanOptions,
  SpanKind,
  SpanStatus,
  SpanAttributes,
  SpanEvent,
  SpanLink,
  ExportedSpan,
  TracerStats,
  AttributeValue,
} from './ITracer';

export { formatTraceId, SemanticAttributes } from './ITracer';

export {
  Tracer,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  type TracerConfig,
} from './Tracer';

export type { AgentOSObservabilityConfig, AgentOSObservabilityState, ActiveTraceMetadata } from './otel';
export {
  configureAgentOSObservability,
  getAgentOSObservabilityState,
  isAgentOSTracingEnabled,
  shouldIncludeTraceIdsInAgentOSLogs,
  shouldIncludeTraceInAgentOSResponses,
  startAgentOSSpan,
  runWithSpanContext,
  withAgentOSSpan,
  recordExceptionOnActiveSpan,
  getActiveSpanContext,
  getActiveTraceMetadata,
} from './otel';

