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



