/**
 * @file ITracer.ts
 * @description Interface for distributed tracing in AgentOS.
 *
 * Provides span-based tracing for tracking request flows across
 * GMIs, agencies, tool calls, and LLM interactions.
 *
 * @module AgentOS/Observability
 * @version 1.0.0
 */
/**
 * Span status codes.
 */
export type SpanStatus = 'unset' | 'ok' | 'error';
/**
 * Span kind indicating the relationship.
 */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
/**
 * Attribute value types.
 */
export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];
/**
 * Span attributes map.
 */
export type SpanAttributes = Record<string, AttributeValue>;
/**
 * Context for propagating trace information.
 */
export interface TraceContext {
    /** Unique trace ID */
    traceId: string;
    /** Current span ID */
    spanId: string;
    /** Parent span ID if exists */
    parentSpanId?: string;
    /** Trace flags (e.g., sampling) */
    traceFlags: number;
    /** Baggage items */
    baggage?: Record<string, string>;
}
/**
 * A recorded event within a span.
 */
export interface SpanEvent {
    /** Event name */
    name: string;
    /** Event timestamp */
    timestamp: number;
    /** Event attributes */
    attributes?: SpanAttributes;
}
/**
 * A link to another span.
 */
export interface SpanLink {
    /** Linked trace context */
    context: TraceContext;
    /** Link attributes */
    attributes?: SpanAttributes;
}
/**
 * Represents a single trace span.
 */
export interface ISpan {
    /** Span name */
    name: string;
    /** Trace context */
    context: TraceContext;
    /** Span kind */
    kind: SpanKind;
    /** Start timestamp in milliseconds */
    startTime: number;
    /** End timestamp in milliseconds */
    endTime?: number;
    /** Span status */
    status: SpanStatus;
    /** Status message */
    statusMessage?: string;
    /** Span attributes */
    attributes: SpanAttributes;
    /** Span events */
    events: SpanEvent[];
    /** Links to other spans */
    links: SpanLink[];
    /**
     * Sets an attribute on the span.
     * @param key - Attribute key
     * @param value - Attribute value
     */
    setAttribute(key: string, value: AttributeValue): void;
    /**
     * Sets multiple attributes.
     * @param attributes - Attributes to set
     */
    setAttributes(attributes: SpanAttributes): void;
    /**
     * Records an event.
     * @param name - Event name
     * @param attributes - Event attributes
     */
    addEvent(name: string, attributes?: SpanAttributes): void;
    /**
     * Sets the span status.
     * @param status - Status code
     * @param message - Optional message
     */
    setStatus(status: SpanStatus, message?: string): void;
    /**
     * Records an exception.
     * @param error - The error object
     */
    recordException(error: Error): void;
    /**
     * Ends the span.
     */
    end(): void;
    /**
     * Checks if the span is recording.
     */
    isRecording(): boolean;
}
/**
 * Options for creating a span.
 */
export interface SpanOptions {
    /** Span kind */
    kind?: SpanKind;
    /** Initial attributes */
    attributes?: SpanAttributes;
    /** Links to other spans */
    links?: SpanLink[];
    /** Start time override */
    startTime?: number;
    /** Parent context */
    parent?: TraceContext;
}
/**
 * Exported span data for serialization.
 */
export interface ExportedSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: SpanKind;
    startTime: number;
    endTime?: number;
    status: SpanStatus;
    statusMessage?: string;
    attributes: SpanAttributes;
    events: SpanEvent[];
    links: SpanLink[];
}
/**
 * Span exporter interface.
 */
export interface ISpanExporter {
    /**
     * Exports spans to a backend.
     * @param spans - Spans to export
     */
    export(spans: ExportedSpan[]): Promise<void>;
    /**
     * Shuts down the exporter.
     */
    shutdown(): Promise<void>;
}
/**
 * Tracer statistics.
 */
export interface TracerStats {
    /** Total spans created */
    totalSpans: number;
    /** Active (unfinished) spans */
    activeSpans: number;
    /** Error spans */
    errorSpans: number;
    /** Total events recorded */
    totalEvents: number;
    /** Spans by operation name */
    spansByName: Record<string, number>;
    /** Average span duration */
    avgDurationMs: number;
    /** Spans exported */
    exportedSpans: number;
}
/**
 * Interface for the distributed tracer.
 *
 * @example
 * ```typescript
 * const tracer = new Tracer();
 *
 * const span = tracer.startSpan('process-request', {
 *   kind: 'server',
 *   attributes: { 'gmi.id': 'gmi-123' },
 * });
 *
 * try {
 *   // Process request
 *   span.addEvent('processing-started');
 *   const result = await processRequest();
 *   span.setAttribute('result.count', result.length);
 *   span.setStatus('ok');
 * } catch (error) {
 *   span.recordException(error);
 *   span.setStatus('error', error.message);
 * } finally {
 *   span.end();
 * }
 * ```
 */
export interface ITracer {
    /**
     * Gets the tracer name.
     */
    readonly name: string;
    /**
     * Gets the current trace context.
     */
    getCurrentContext(): TraceContext | undefined;
    /**
     * Starts a new span.
     * @param name - Span name
     * @param options - Span options
     * @returns The created span
     */
    startSpan(name: string, options?: SpanOptions): ISpan;
    /**
     * Wraps an async function with tracing.
     * @param name - Span name
     * @param fn - Function to wrap
     * @param options - Span options
     * @returns Result of the function
     */
    withSpan<T>(name: string, fn: (span: ISpan) => Promise<T>, options?: SpanOptions): Promise<T>;
    /**
     * Injects trace context into a carrier (for propagation).
     * @param carrier - Object to inject into
     * @returns The carrier with injected context
     */
    inject<T extends Record<string, string>>(carrier: T): T;
    /**
     * Extracts trace context from a carrier.
     * @param carrier - Object to extract from
     * @returns Extracted context or undefined
     */
    extract(carrier: Record<string, string>): TraceContext | undefined;
    /**
     * Gets a span by ID.
     * @param spanId - Span ID
     * @returns The span or undefined
     */
    getSpan(spanId: string): ISpan | undefined;
    /**
     * Gets all active spans.
     * @returns Array of active spans
     */
    getActiveSpans(): ISpan[];
    /**
     * Adds a span exporter.
     * @param exporter - Exporter to add
     */
    addExporter(exporter: ISpanExporter): void;
    /**
     * Forces export of all completed spans.
     */
    flush(): Promise<void>;
    /**
     * Gets tracer statistics.
     */
    getStats(): TracerStats;
    /**
     * Resets statistics.
     */
    resetStats(): void;
    /**
     * Shuts down the tracer.
     */
    shutdown(): Promise<void>;
}
/**
 * Creates a formatted trace ID for display.
 * @param traceId - The trace ID
 * @param spanId - The span ID
 * @returns Formatted string
 */
export declare function formatTraceId(traceId: string, spanId?: string): string;
/**
 * Semantic conventions for span attributes.
 */
export declare const SemanticAttributes: {
    readonly SERVICE_NAME: "service.name";
    readonly SERVICE_VERSION: "service.version";
    readonly GMI_ID: "gmi.id";
    readonly GMI_PERSONA_ID: "gmi.persona.id";
    readonly GMI_CONVERSATION_ID: "gmi.conversation.id";
    readonly AGENCY_ID: "agency.id";
    readonly AGENCY_ROLE_ID: "agency.role.id";
    readonly LLM_PROVIDER: "llm.provider";
    readonly LLM_MODEL: "llm.model";
    readonly LLM_PROMPT_TOKENS: "llm.prompt_tokens";
    readonly LLM_COMPLETION_TOKENS: "llm.completion_tokens";
    readonly LLM_TOTAL_TOKENS: "llm.total_tokens";
    readonly TOOL_ID: "tool.id";
    readonly TOOL_NAME: "tool.name";
    readonly TOOL_RESULT_STATUS: "tool.result.status";
    readonly EXCEPTION_TYPE: "exception.type";
    readonly EXCEPTION_MESSAGE: "exception.message";
    readonly EXCEPTION_STACKTRACE: "exception.stacktrace";
    readonly HTTP_METHOD: "http.method";
    readonly HTTP_URL: "http.url";
    readonly HTTP_STATUS_CODE: "http.status_code";
    readonly USER_ID: "user.id";
};
//# sourceMappingURL=ITracer.d.ts.map