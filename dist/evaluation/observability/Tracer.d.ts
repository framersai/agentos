/**
 * @file Tracer.ts
 * @description Implementation of distributed tracing for AgentOS.
 * @module AgentOS/Observability
 * @version 1.0.0
 */
import type { ITracer, ISpan, ISpanExporter, TraceContext, SpanOptions, ExportedSpan, TracerStats } from './ITracer';
/**
 * Simple console exporter for development.
 */
export declare class ConsoleSpanExporter implements ISpanExporter {
    private readonly prefix;
    constructor(prefix?: string);
    export(spans: ExportedSpan[]): Promise<void>;
    shutdown(): Promise<void>;
}
/**
 * In-memory exporter that stores spans for retrieval.
 */
export declare class InMemorySpanExporter implements ISpanExporter {
    private spans;
    private maxSpans;
    constructor(maxSpans?: number);
    export(spans: ExportedSpan[]): Promise<void>;
    getSpans(): ExportedSpan[];
    getSpansByName(name: string): ExportedSpan[];
    getSpansByTraceId(traceId: string): ExportedSpan[];
    clear(): void;
    shutdown(): Promise<void>;
}
/**
 * Tracer configuration.
 */
export interface TracerConfig {
    /** Tracer name */
    name?: string;
    /** Whether to auto-export on span end */
    autoExport?: boolean;
    /** Batch size for export */
    exportBatchSize?: number;
    /** Export interval in ms */
    exportIntervalMs?: number;
    /** Maximum spans to buffer */
    maxBufferSize?: number;
}
/**
 * Distributed tracer implementation.
 */
export declare class Tracer implements ITracer {
    readonly name: string;
    private readonly config;
    private readonly activeSpans;
    private readonly completedSpans;
    private readonly exporters;
    private currentContext?;
    private exportTimer?;
    private stats;
    constructor(config?: Partial<TracerConfig>);
    getCurrentContext(): TraceContext | undefined;
    startSpan(name: string, options?: SpanOptions): ISpan;
    withSpan<T>(name: string, fn: (span: ISpan) => Promise<T>, options?: SpanOptions): Promise<T>;
    inject<T extends Record<string, string>>(carrier: T): T;
    extract(carrier: Record<string, string>): TraceContext | undefined;
    getSpan(spanId: string): ISpan | undefined;
    getActiveSpans(): ISpan[];
    addExporter(exporter: ISpanExporter): void;
    flush(): Promise<void>;
    getStats(): TracerStats;
    resetStats(): void;
    shutdown(): Promise<void>;
    private onSpanEnd;
    private startExportTimer;
    private generateId;
    private createEmptyStats;
}
//# sourceMappingURL=Tracer.d.ts.map