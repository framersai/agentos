/**
 * @file Tracer.spec.ts
 * @description Unit tests for the distributed tracer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Tracer, InMemorySpanExporter, ConsoleSpanExporter } from '../../../src/core/observability/Tracer';
import { SemanticAttributes } from '../../../src/core/observability/ITracer';

describe('Tracer', () => {
  let tracer: Tracer;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    tracer = new Tracer({ autoExport: false });
    tracer.addExporter(exporter);
  });

  afterEach(async () => {
    await tracer.shutdown();
  });

  describe('span creation', () => {
    it('should create a span with name', () => {
      const span = tracer.startSpan('test-span');

      expect(span.name).toBe('test-span');
      expect(span.context.traceId).toBeDefined();
      expect(span.context.spanId).toBeDefined();
      expect(span.isRecording()).toBe(true);
    });

    it('should create child spans with same trace ID', () => {
      const parent = tracer.startSpan('parent');
      const child = tracer.startSpan('child');

      expect(child.context.traceId).toBe(parent.context.traceId);
      expect(child.context.parentSpanId).toBe(parent.context.spanId);
    });

    it('should create span with attributes', () => {
      const span = tracer.startSpan('test', {
        attributes: {
          [SemanticAttributes.GMI_ID]: 'gmi-123',
          [SemanticAttributes.LLM_MODEL]: 'gpt-4',
        },
      });

      expect(span.attributes[SemanticAttributes.GMI_ID]).toBe('gmi-123');
      expect(span.attributes[SemanticAttributes.LLM_MODEL]).toBe('gpt-4');
    });

    it('should create span with specific kind', () => {
      const span = tracer.startSpan('server-span', { kind: 'server' });
      expect(span.kind).toBe('server');
    });
  });

  describe('span operations', () => {
    it('should set attributes', () => {
      const span = tracer.startSpan('test');

      span.setAttribute('key1', 'value1');
      span.setAttribute('key2', 42);

      expect(span.attributes['key1']).toBe('value1');
      expect(span.attributes['key2']).toBe(42);
    });

    it('should set multiple attributes', () => {
      const span = tracer.startSpan('test');

      span.setAttributes({
        'a': 1,
        'b': 2,
        'c': 3,
      });

      expect(span.attributes['a']).toBe(1);
      expect(span.attributes['b']).toBe(2);
      expect(span.attributes['c']).toBe(3);
    });

    it('should add events', () => {
      const span = tracer.startSpan('test');

      span.addEvent('event1');
      span.addEvent('event2', { detail: 'info' });

      expect(span.events.length).toBe(2);
      expect(span.events[0].name).toBe('event1');
      expect(span.events[1].attributes).toEqual({ detail: 'info' });
    });

    it('should set status', () => {
      const span = tracer.startSpan('test');

      span.setStatus('ok');
      expect(span.status).toBe('ok');

      span.setStatus('error', 'Something went wrong');
      expect(span.status).toBe('error');
      expect(span.statusMessage).toBe('Something went wrong');
    });

    it('should record exceptions', () => {
      const span = tracer.startSpan('test');
      const error = new Error('Test error');

      span.recordException(error);

      expect(span.status).toBe('error');
      expect(span.events.length).toBe(1);
      expect(span.events[0].name).toBe('exception');
      expect(span.events[0].attributes?.['exception.message']).toBe('Test error');
    });

    it('should end span', () => {
      const span = tracer.startSpan('test');

      expect(span.isRecording()).toBe(true);
      span.end();
      expect(span.isRecording()).toBe(false);
      expect(span.endTime).toBeDefined();
    });

    it('should not modify span after end', () => {
      const span = tracer.startSpan('test');
      span.end();

      span.setAttribute('new', 'value');
      span.addEvent('new-event');

      expect(span.attributes['new']).toBeUndefined();
      expect(span.events.length).toBe(0);
    });
  });

  describe('withSpan helper', () => {
    it('should wrap function with tracing', async () => {
      const result = await tracer.withSpan('wrapped', async (span) => {
        span.setAttribute('input', 42);
        return 'result';
      });

      expect(result).toBe('result');

      await tracer.flush();
      const spans = exporter.getSpans();
      expect(spans.length).toBe(1);
      expect(spans[0].status).toBe('ok');
    });

    it('should record errors in withSpan', async () => {
      await expect(
        tracer.withSpan('failing', async () => {
          throw new Error('Intentional error');
        }),
      ).rejects.toThrow('Intentional error');

      await tracer.flush();
      const spans = exporter.getSpans();
      expect(spans[0].status).toBe('error');
    });
  });

  describe('context propagation', () => {
    it('should inject context into carrier', () => {
      tracer.startSpan('test');
      const carrier: Record<string, string> = {};

      tracer.inject(carrier);

      expect(carrier['traceparent']).toBeDefined();
      expect(carrier['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9]$/);
    });

    it('should extract context from carrier', () => {
      const carrier = {
        traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
      };

      const context = tracer.extract(carrier);

      expect(context).toBeDefined();
      expect(context?.traceId).toBe('12345678901234567890123456789012');
      expect(context?.spanId).toBe('1234567890123456');
    });

    it('should return undefined for missing traceparent', () => {
      const context = tracer.extract({});
      expect(context).toBeUndefined();
    });
  });

  describe('span management', () => {
    it('should get active spans', () => {
      const span1 = tracer.startSpan('span1');
      const span2 = tracer.startSpan('span2');

      const active = tracer.getActiveSpans();
      expect(active.length).toBe(2);

      span1.end();
      const afterEnd = tracer.getActiveSpans();
      expect(afterEnd.length).toBe(1);
    });

    it('should get span by ID', () => {
      const span = tracer.startSpan('test');
      const retrieved = tracer.getSpan(span.context.spanId);

      expect(retrieved).toBe(span);
    });

    it('should return undefined for ended span', () => {
      const span = tracer.startSpan('test');
      const spanId = span.context.spanId;
      span.end();

      const retrieved = tracer.getSpan(spanId);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('export', () => {
    it('should export spans on flush', async () => {
      const span = tracer.startSpan('test');
      span.end();

      await tracer.flush();

      const spans = exporter.getSpans();
      expect(spans.length).toBe(1);
      expect(spans[0].name).toBe('test');
    });

    it('should filter spans by name', async () => {
      tracer.startSpan('span-a').end();
      tracer.startSpan('span-b').end();
      tracer.startSpan('span-a').end();

      await tracer.flush();

      const aSpans = exporter.getSpansByName('span-a');
      expect(aSpans.length).toBe(2);
    });

    it('should filter spans by trace ID', async () => {
      const parent = tracer.startSpan('parent');
      const traceId = parent.context.traceId;

      tracer.startSpan('child1').end();
      tracer.startSpan('child2').end();
      parent.end();

      await tracer.flush();

      const traceSpans = exporter.getSpansByTraceId(traceId);
      expect(traceSpans.length).toBe(3);
    });
  });

  describe('statistics', () => {
    it('should track span counts', () => {
      tracer.startSpan('span1').end();
      tracer.startSpan('span2').end();
      tracer.startSpan('span3');

      const stats = tracer.getStats();
      expect(stats.totalSpans).toBe(3);
      expect(stats.activeSpans).toBe(1);
    });

    it('should track error spans', () => {
      const span = tracer.startSpan('error-span');
      span.setStatus('error');
      span.end();

      const stats = tracer.getStats();
      expect(stats.errorSpans).toBe(1);
    });

    it('should track spans by name', () => {
      tracer.startSpan('type-a').end();
      tracer.startSpan('type-a').end();
      tracer.startSpan('type-b').end();

      const stats = tracer.getStats();
      expect(stats.spansByName['type-a']).toBe(2);
      expect(stats.spansByName['type-b']).toBe(1);
    });

    it('should reset statistics', () => {
      tracer.startSpan('test').end();
      tracer.resetStats();

      const stats = tracer.getStats();
      expect(stats.totalSpans).toBe(0);
    });
  });

  describe('console exporter', () => {
    it('should log spans to console', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleExporter = new ConsoleSpanExporter('[Test]');

      const span = tracer.startSpan('console-test');
      span.setAttribute('key', 'value');
      span.end();

      await tracer.flush();
      await consoleExporter.export([
        {
          traceId: span.context.traceId,
          spanId: span.context.spanId,
          name: span.name,
          kind: span.kind,
          startTime: span.startTime,
          endTime: span.endTime,
          status: span.status,
          attributes: span.attributes,
          events: span.events,
          links: span.links,
        },
      ]);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});


