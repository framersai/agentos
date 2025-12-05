/**
 * @file Tracer.ts
 * @description Implementation of distributed tracing for AgentOS.
 * @module AgentOS/Observability
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';
import type {
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

// ============================================================================
// Span Implementation
// ============================================================================

/**
 * Span implementation.
 */
class Span implements ISpan {
  public readonly name: string;
  public readonly context: TraceContext;
  public readonly kind: SpanKind;
  public readonly startTime: number;
  public endTime?: number;
  public status: SpanStatus = 'unset';
  public statusMessage?: string;
  public attributes: SpanAttributes = {};
  public events: SpanEvent[] = [];
  public links: SpanLink[];

  private _isRecording = true;
  private readonly onEnd: (span: Span) => void;

  constructor(
    name: string,
    context: TraceContext,
    kind: SpanKind,
    links: SpanLink[],
    onEnd: (span: Span) => void,
    startTime?: number,
  ) {
    this.name = name;
    this.context = context;
    this.kind = kind;
    this.links = links;
    this.startTime = startTime || Date.now();
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: AttributeValue): void {
    if (this._isRecording) {
      this.attributes[key] = value;
    }
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this._isRecording) {
      Object.assign(this.attributes, attributes);
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this._isRecording) {
      this.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
  }

  setStatus(status: SpanStatus, message?: string): void {
    if (this._isRecording) {
      this.status = status;
      this.statusMessage = message;
    }
  }

  recordException(error: Error): void {
    if (this._isRecording) {
      this.addEvent('exception', {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack || '',
      });
      this.setStatus('error', error.message);
    }
  }

  end(): void {
    if (this._isRecording) {
      this.endTime = Date.now();
      this._isRecording = false;
      this.onEnd(this);
    }
  }

  isRecording(): boolean {
    return this._isRecording;
  }

  toExportedSpan(): ExportedSpan {
    return {
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      parentSpanId: this.context.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      statusMessage: this.statusMessage,
      attributes: { ...this.attributes },
      events: [...this.events],
      links: [...this.links],
    };
  }
}

// ============================================================================
// Console Exporter
// ============================================================================

/**
 * Simple console exporter for development.
 */
export class ConsoleSpanExporter implements ISpanExporter {
  private readonly prefix: string;

  constructor(prefix = '[Trace]') {
    this.prefix = prefix;
  }

  async export(spans: ExportedSpan[]): Promise<void> {
    for (const span of spans) {
      const duration = span.endTime ? span.endTime - span.startTime : 'ongoing';
      const status = span.status === 'error' ? '❌' : span.status === 'ok' ? '✅' : '⚪';

      console.log(
        `${this.prefix} ${status} ${span.name} [${span.traceId.slice(0, 8)}:${span.spanId.slice(0, 8)}] ${duration}ms`,
      );

      if (Object.keys(span.attributes).length > 0) {
        console.log(`  Attributes:`, span.attributes);
      }

      if (span.events.length > 0) {
        console.log(`  Events:`, span.events.map(e => e.name).join(', '));
      }
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}

// ============================================================================
// In-Memory Exporter (for testing)
// ============================================================================

/**
 * In-memory exporter that stores spans for retrieval.
 */
export class InMemorySpanExporter implements ISpanExporter {
  private spans: ExportedSpan[] = [];
  private maxSpans: number;

  constructor(maxSpans = 1000) {
    this.maxSpans = maxSpans;
  }

  async export(spans: ExportedSpan[]): Promise<void> {
    this.spans.push(...spans);
    // Trim if over limit
    if (this.spans.length > this.maxSpans) {
      this.spans = this.spans.slice(-this.maxSpans);
    }
  }

  getSpans(): ExportedSpan[] {
    return [...this.spans];
  }

  getSpansByName(name: string): ExportedSpan[] {
    return this.spans.filter(s => s.name === name);
  }

  getSpansByTraceId(traceId: string): ExportedSpan[] {
    return this.spans.filter(s => s.traceId === traceId);
  }

  clear(): void {
    this.spans = [];
  }

  async shutdown(): Promise<void> {
    this.spans = [];
  }
}

// ============================================================================
// Tracer Implementation
// ============================================================================

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

const DEFAULT_CONFIG: TracerConfig = {
  name: 'agentos-tracer',
  autoExport: true,
  exportBatchSize: 100,
  exportIntervalMs: 5000,
  maxBufferSize: 1000,
};

/**
 * Distributed tracer implementation.
 */
export class Tracer implements ITracer {
  public readonly name: string;

  private readonly config: TracerConfig;
  private readonly activeSpans = new Map<string, Span>();
  private readonly completedSpans: Span[] = [];
  private readonly exporters: ISpanExporter[] = [];
  private currentContext?: TraceContext;
  private exportTimer?: NodeJS.Timeout;
  private stats: TracerStats;

  constructor(config?: Partial<TracerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.name = this.config.name!;
    this.stats = this.createEmptyStats();

    if (this.config.autoExport && this.config.exportIntervalMs) {
      this.startExportTimer();
    }
  }

  getCurrentContext(): TraceContext | undefined {
    return this.currentContext;
  }

  startSpan(name: string, options?: SpanOptions): ISpan {
    const kind = options?.kind || 'internal';

    // Generate IDs
    const spanId = this.generateId(16);
    let traceId: string;
    let parentSpanId: string | undefined;

    if (options?.parent) {
      traceId = options.parent.traceId;
      parentSpanId = options.parent.spanId;
    } else if (this.currentContext) {
      traceId = this.currentContext.traceId;
      parentSpanId = this.currentContext.spanId;
    } else {
      traceId = this.generateId(32);
    }

    const context: TraceContext = {
      traceId,
      spanId,
      parentSpanId,
      traceFlags: 1, // Sampled
    };

    const span = new Span(
      name,
      context,
      kind,
      options?.links || [],
      this.onSpanEnd.bind(this),
      options?.startTime,
    );

    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }

    this.activeSpans.set(spanId, span);
    this.currentContext = context;

    // Update stats
    this.stats.totalSpans++;
    this.stats.activeSpans++;
    this.stats.spansByName[name] = (this.stats.spansByName[name] || 0) + 1;

    return span;
  }

  async withSpan<T>(name: string, fn: (span: ISpan) => Promise<T>, options?: SpanOptions): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  inject<T extends Record<string, string>>(carrier: T): T {
    if (this.currentContext) {
      carrier['traceparent'] = `00-${this.currentContext.traceId}-${this.currentContext.spanId}-0${this.currentContext.traceFlags}`;
      if (this.currentContext.baggage) {
        carrier['baggage'] = Object.entries(this.currentContext.baggage)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join(',');
      }
    }
    return carrier;
  }

  extract(carrier: Record<string, string>): TraceContext | undefined {
    const traceparent = carrier['traceparent'];
    if (!traceparent) return undefined;

    const parts = traceparent.split('-');
    if (parts.length < 4) return undefined;

    const context: TraceContext = {
      traceId: parts[1],
      spanId: parts[2],
      traceFlags: parseInt(parts[3], 16),
    };

    const baggage = carrier['baggage'];
    if (baggage) {
      context.baggage = {};
      baggage.split(',').forEach(item => {
        const [key, value] = item.split('=');
        if (key && value) {
          context.baggage![key.trim()] = decodeURIComponent(value.trim());
        }
      });
    }

    return context;
  }

  getSpan(spanId: string): ISpan | undefined {
    return this.activeSpans.get(spanId);
  }

  getActiveSpans(): ISpan[] {
    return Array.from(this.activeSpans.values());
  }

  addExporter(exporter: ISpanExporter): void {
    this.exporters.push(exporter);
  }

  async flush(): Promise<void> {
    if (this.completedSpans.length === 0) return;

    const spans = this.completedSpans.splice(0);
    const exported = spans.map(s => s.toExportedSpan());

    for (const exporter of this.exporters) {
      try {
        await exporter.export(exported);
        this.stats.exportedSpans += exported.length;
      } catch (error) {
        console.error('[Tracer] Export failed:', error);
      }
    }
  }

  getStats(): TracerStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = this.createEmptyStats();
  }

  async shutdown(): Promise<void> {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }

    // End all active spans
    for (const span of this.activeSpans.values()) {
      span.setStatus('error', 'Tracer shutdown');
      span.end();
    }

    // Final flush
    await this.flush();

    // Shutdown exporters
    for (const exporter of this.exporters) {
      await exporter.shutdown();
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private onSpanEnd(span: Span): void {
    this.activeSpans.delete(span.context.spanId);
    this.completedSpans.push(span);
    this.stats.activeSpans--;

    if (span.status === 'error') {
      this.stats.errorSpans++;
    }

    this.stats.totalEvents += span.events.length;

    // Update average duration
    if (span.endTime) {
      const duration = span.endTime - span.startTime;
      const totalCompleted = this.stats.totalSpans - this.stats.activeSpans;
      this.stats.avgDurationMs =
        (this.stats.avgDurationMs * (totalCompleted - 1) + duration) / totalCompleted;
    }

    // Restore parent context
    if (span.context.parentSpanId) {
      const parent = this.activeSpans.get(span.context.parentSpanId);
      if (parent) {
        this.currentContext = parent.context;
      }
    }

    // Auto-export if batch size reached
    if (
      this.config.autoExport &&
      this.completedSpans.length >= (this.config.exportBatchSize || 100)
    ) {
      this.flush().catch(console.error);
    }
  }

  private startExportTimer(): void {
    this.exportTimer = setInterval(() => {
      if (this.completedSpans.length > 0) {
        this.flush().catch(console.error);
      }
    }, this.config.exportIntervalMs);
  }

  private generateId(length: number): string {
    const id = uuidv4().replace(/-/g, '');
    return id.slice(0, length).padEnd(length, '0');
  }

  private createEmptyStats(): TracerStats {
    return {
      totalSpans: 0,
      activeSpans: 0,
      errorSpans: 0,
      totalEvents: 0,
      spansByName: {},
      avgDurationMs: 0,
      exportedSpans: 0,
    };
  }
}

