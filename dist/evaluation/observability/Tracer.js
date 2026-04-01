/**
 * @file Tracer.ts
 * @description Implementation of distributed tracing for AgentOS.
 * @module AgentOS/Observability
 * @version 1.0.0
 */
import { v4 as uuidv4 } from 'uuid';
// ============================================================================
// Span Implementation
// ============================================================================
/**
 * Span implementation.
 */
class Span {
    constructor(name, context, kind, links, onEnd, startTime) {
        this.status = 'unset';
        this.attributes = {};
        this.events = [];
        this._isRecording = true;
        this.name = name;
        this.context = context;
        this.kind = kind;
        this.links = links;
        this.startTime = startTime || Date.now();
        this.onEnd = onEnd;
    }
    setAttribute(key, value) {
        if (this._isRecording) {
            this.attributes[key] = value;
        }
    }
    setAttributes(attributes) {
        if (this._isRecording) {
            Object.assign(this.attributes, attributes);
        }
    }
    addEvent(name, attributes) {
        if (this._isRecording) {
            this.events.push({
                name,
                timestamp: Date.now(),
                attributes,
            });
        }
    }
    setStatus(status, message) {
        if (this._isRecording) {
            this.status = status;
            this.statusMessage = message;
        }
    }
    recordException(error) {
        if (this._isRecording) {
            this.addEvent('exception', {
                'exception.type': error.name,
                'exception.message': error.message,
                'exception.stacktrace': error.stack || '',
            });
            this.setStatus('error', error.message);
        }
    }
    end() {
        if (this._isRecording) {
            this.endTime = Date.now();
            this._isRecording = false;
            this.onEnd(this);
        }
    }
    isRecording() {
        return this._isRecording;
    }
    toExportedSpan() {
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
export class ConsoleSpanExporter {
    constructor(prefix = '[Trace]') {
        this.prefix = prefix;
    }
    async export(spans) {
        for (const span of spans) {
            const duration = span.endTime ? span.endTime - span.startTime : 'ongoing';
            const status = span.status === 'error' ? '❌' : span.status === 'ok' ? '✅' : '⚪';
            console.log(`${this.prefix} ${status} ${span.name} [${span.traceId.slice(0, 8)}:${span.spanId.slice(0, 8)}] ${duration}ms`);
            if (Object.keys(span.attributes).length > 0) {
                console.log(`  Attributes:`, span.attributes);
            }
            if (span.events.length > 0) {
                console.log(`  Events:`, span.events.map(e => e.name).join(', '));
            }
        }
    }
    async shutdown() {
        // No cleanup needed
    }
}
// ============================================================================
// In-Memory Exporter (for testing)
// ============================================================================
/**
 * In-memory exporter that stores spans for retrieval.
 */
export class InMemorySpanExporter {
    constructor(maxSpans = 1000) {
        this.spans = [];
        this.maxSpans = maxSpans;
    }
    async export(spans) {
        this.spans.push(...spans);
        // Trim if over limit
        if (this.spans.length > this.maxSpans) {
            this.spans = this.spans.slice(-this.maxSpans);
        }
    }
    getSpans() {
        return [...this.spans];
    }
    getSpansByName(name) {
        return this.spans.filter(s => s.name === name);
    }
    getSpansByTraceId(traceId) {
        return this.spans.filter(s => s.traceId === traceId);
    }
    clear() {
        this.spans = [];
    }
    async shutdown() {
        this.spans = [];
    }
}
const DEFAULT_CONFIG = {
    name: 'agentos-tracer',
    autoExport: true,
    exportBatchSize: 100,
    exportIntervalMs: 5000,
    maxBufferSize: 1000,
};
/**
 * Distributed tracer implementation.
 */
export class Tracer {
    constructor(config) {
        this.activeSpans = new Map();
        this.completedSpans = [];
        this.exporters = [];
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.name = this.config.name;
        this.stats = this.createEmptyStats();
        if (this.config.autoExport && this.config.exportIntervalMs) {
            this.startExportTimer();
        }
    }
    getCurrentContext() {
        return this.currentContext;
    }
    startSpan(name, options) {
        const kind = options?.kind || 'internal';
        // Generate IDs
        const spanId = this.generateId(16);
        let traceId;
        let parentSpanId;
        if (options?.parent) {
            traceId = options.parent.traceId;
            parentSpanId = options.parent.spanId;
        }
        else if (this.currentContext) {
            traceId = this.currentContext.traceId;
            parentSpanId = this.currentContext.spanId;
        }
        else {
            traceId = this.generateId(32);
        }
        const context = {
            traceId,
            spanId,
            parentSpanId,
            traceFlags: 1, // Sampled
        };
        const span = new Span(name, context, kind, options?.links || [], this.onSpanEnd.bind(this), options?.startTime);
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
    async withSpan(name, fn, options) {
        const span = this.startSpan(name, options);
        try {
            const result = await fn(span);
            span.setStatus('ok');
            return result;
        }
        catch (error) {
            span.recordException(error);
            throw error;
        }
        finally {
            span.end();
        }
    }
    inject(carrier) {
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
    extract(carrier) {
        const traceparent = carrier['traceparent'];
        if (!traceparent)
            return undefined;
        const parts = traceparent.split('-');
        if (parts.length < 4)
            return undefined;
        const context = {
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
                    context.baggage[key.trim()] = decodeURIComponent(value.trim());
                }
            });
        }
        return context;
    }
    getSpan(spanId) {
        return this.activeSpans.get(spanId);
    }
    getActiveSpans() {
        return Array.from(this.activeSpans.values());
    }
    addExporter(exporter) {
        this.exporters.push(exporter);
    }
    async flush() {
        if (this.completedSpans.length === 0)
            return;
        const spans = this.completedSpans.splice(0);
        const exported = spans.map(s => s.toExportedSpan());
        for (const exporter of this.exporters) {
            try {
                await exporter.export(exported);
                this.stats.exportedSpans += exported.length;
            }
            catch (error) {
                console.error('[Tracer] Export failed:', error);
            }
        }
    }
    getStats() {
        return { ...this.stats };
    }
    resetStats() {
        this.stats = this.createEmptyStats();
    }
    async shutdown() {
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
    onSpanEnd(span) {
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
        if (this.config.autoExport &&
            this.completedSpans.length >= (this.config.exportBatchSize || 100)) {
            this.flush().catch(console.error);
        }
    }
    startExportTimer() {
        this.exportTimer = setInterval(() => {
            if (this.completedSpans.length > 0) {
                this.flush().catch(console.error);
            }
        }, this.config.exportIntervalMs);
    }
    generateId(length) {
        const id = uuidv4().replace(/-/g, '');
        return id.slice(0, length).padEnd(length, '0');
    }
    createEmptyStats() {
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
//# sourceMappingURL=Tracer.js.map