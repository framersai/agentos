/**
 * Exports for tracing and observability.
 *
 * @module AgentOS/Observability
 */
export { formatTraceId, SemanticAttributes } from './ITracer.js';
export { Tracer, ConsoleSpanExporter, InMemorySpanExporter, } from './Tracer.js';
export { configureAgentOSObservability, getAgentOSObservabilityState, isAgentOSTracingEnabled, shouldIncludeTraceIdsInAgentOSLogs, shouldIncludeTraceInAgentOSResponses, startAgentOSSpan, runWithSpanContext, withAgentOSSpan, recordExceptionOnActiveSpan, getActiveSpanContext, getActiveTraceMetadata, } from './otel.js';
//# sourceMappingURL=index.js.map