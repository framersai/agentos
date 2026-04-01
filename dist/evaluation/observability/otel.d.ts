import type { Attributes, Span, SpanContext, SpanKind } from '@opentelemetry/api';
export interface AgentOSObservabilityConfig {
    /**
     * Master switch. When explicitly `false`, all AgentOS observability helpers are disabled
     * regardless of environment variables.
     */
    enabled?: boolean;
    tracing?: {
        /**
         * Enables manual AgentOS spans (agent turn, tool-result handling, etc).
         * Default: false.
         */
        enabled?: boolean;
        /**
         * OpenTelemetry tracer name used for AgentOS spans.
         * Default: "@framers/agentos".
         */
        tracerName?: string;
        /**
         * When enabled, AgentOS attaches `metadata.trace` (traceId/spanId/traceparent)
         * to select streamed chunks (e.g. metadata updates, final responses, errors).
         * Default: false.
         */
        includeTraceInResponses?: boolean;
    };
    logging?: {
        /**
         * When enabled, `PinoLogger` will add `trace_id` and `span_id` fields to log meta
         * when an active span exists.
         *
         * Note: This does not start OpenTelemetry by itself; it only correlates logs with
         * whatever tracing provider your host app installed.
         *
         * Default: false.
         */
        includeTraceIds?: boolean;
        /**
         * When enabled, AgentOS will emit OpenTelemetry LogRecords using `@opentelemetry/api-logs`.
         *
         * This is still opt-in because it can increase CPU/network usage and may result in double-ingestion
         * if you already ship stdout logs separately.
         *
         * Note: This does not start OpenTelemetry. Your host app must install/start an OTEL SDK and
         * configure a logs exporter (e.g. `OTEL_LOGS_EXPORTER=otlp` in NodeSDK).
         *
         * Default: false.
         */
        exportToOtel?: boolean;
        /**
         * OpenTelemetry logger name used for AgentOS LogRecords.
         * Default: "@framers/agentos".
         */
        otelLoggerName?: string;
    };
    metrics?: {
        /**
         * Enables AgentOS metrics (counters/histograms).
         * Default: false.
         */
        enabled?: boolean;
        /**
         * OpenTelemetry meter name used for AgentOS metrics.
         * Default: "@framers/agentos".
         */
        meterName?: string;
    };
}
export type AgentOSObservabilityState = Readonly<{
    tracingEnabled: boolean;
    tracerName: string;
    includeTraceInResponses: boolean;
    includeTraceIdsInLogs: boolean;
    metricsEnabled: boolean;
    meterName: string;
    exportOtelLogs: boolean;
    otelLoggerName: string;
}>;
export declare function configureAgentOSObservability(config?: AgentOSObservabilityConfig): AgentOSObservabilityState;
export declare function getAgentOSObservabilityState(): AgentOSObservabilityState;
export declare function isAgentOSTracingEnabled(): boolean;
export declare function isAgentOSMetricsEnabled(): boolean;
export declare function shouldIncludeTraceIdsInAgentOSLogs(): boolean;
export declare function shouldExportAgentOSLogsToOtel(): boolean;
export declare function getAgentOSOtelLoggerName(): string;
export declare function shouldIncludeTraceInAgentOSResponses(): boolean;
export type AgentOSTurnMetricInput = Readonly<{
    durationMs: number;
    status: 'ok' | 'error';
    personaId?: string;
    taskOutcomeStatus?: 'success' | 'partial' | 'failed';
    taskOutcomeScore?: number;
    usage?: {
        totalTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalCostUSD?: number;
    };
}>;
export declare function recordAgentOSTurnMetrics(input: AgentOSTurnMetricInput): void;
export type AgentOSToolResultMetricInput = Readonly<{
    durationMs: number;
    status: 'ok' | 'error';
    toolName?: string;
    toolSuccess?: boolean;
}>;
export declare function recordAgentOSToolResultMetrics(input: AgentOSToolResultMetricInput): void;
export declare function startAgentOSSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: Attributes;
}): Span | null;
export declare function runWithSpanContext<T>(span: Span, fn: () => Promise<T>): Promise<T>;
export declare function withAgentOSSpan<T>(name: string, fn: (span: Span | null) => Promise<T>, options?: {
    kind?: SpanKind;
    attributes?: Attributes;
}): Promise<T>;
export declare function recordExceptionOnActiveSpan(error: unknown, message?: string): void;
export declare function getActiveSpanContext(): SpanContext | null;
export type ActiveTraceMetadata = Readonly<{
    traceId: string;
    spanId: string;
    traceparent: string;
}>;
export declare function getActiveTraceMetadata(): ActiveTraceMetadata | null;
//# sourceMappingURL=otel.d.ts.map