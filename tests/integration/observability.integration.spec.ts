import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context, metrics, trace } from '@opentelemetry/api';
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import { AgentOSOrchestrator } from '../../src/api/AgentOSOrchestrator';
import { configureAgentOSObservability } from '../../src/core/observability/otel';
import { ConversationContext } from '../../src/core/conversation/ConversationContext';
import { GMIOutputChunkType } from '../../src/cognitive_substrate/IGMI';

class FakeStreamingManager {
  private seq = 0;
  public readonly chunks: any[] = [];
  private readonly closeResolvers = new Map<string, () => void>();

  async createStream(): Promise<string> {
    this.seq += 1;
    return `stream_${this.seq}`;
  }

  async pushChunk(_streamId: string, chunk: any): Promise<void> {
    this.chunks.push(chunk);
  }

  async closeStream(streamId: string, _reason?: string): Promise<void> {
    const resolve = this.closeResolvers.get(streamId);
    if (resolve) resolve();
  }

  waitClosed(streamId: string): Promise<void> {
    return new Promise((resolve) => {
      this.closeResolvers.set(streamId, resolve);
    });
  }
}

describe('AgentOS OpenTelemetry integration', () => {
  let exporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);

    metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
    meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  beforeEach(() => {
    exporter.reset();
    metricExporter.reset();
    configureAgentOSObservability({ enabled: false });
  });

  it('emits spans and trace metadata when enabled', async () => {
    configureAgentOSObservability({
      tracing: { enabled: true, includeTraceInResponses: true, tracerName: 'test-agentos' },
      logging: { includeTraceIds: true },
    });

    const streamingManager = new FakeStreamingManager();

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'persona_test',
      getGMIId: () => 'gmi_test',
      processTurnStream: async function* () {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'hello',
          interactionId: 'turn_1',
          timestamp: new Date(),
          isFinal: false,
        };
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: null,
          interactionId: 'turn_1',
          timestamp: new Date(),
          isFinal: true,
        };
        return { isFinal: true, responseText: 'hello' };
      },
    };

    const fakeGmiManager = {
      getOrCreateGMIForSession: async () => ({
        gmi: fakeGmi,
        conversationContext: new ConversationContext('conv_test'),
      }),
    };

    const orchestrator = new AgentOSOrchestrator();
    await orchestrator.initialize(
      { maxToolCallIterations: 1, enableConversationalPersistence: false },
      {
        gmiManager: fakeGmiManager as any,
        toolOrchestrator: {} as any,
        conversationManager: { saveConversation: async () => {} } as any,
        streamingManager: streamingManager as any,
        modelProviderManager: {} as any,
      } as any,
    );

    const streamId = await orchestrator.orchestrateTurn({
      userId: 'user_1',
      sessionId: 'session_1',
      conversationId: 'conversation_1',
      textInput: 'hello',
      selectedPersonaId: 'persona_test',
    });

    await streamingManager.waitClosed(streamId);
    await new Promise((r) => setTimeout(r, 0)); // allow span finalizers to run

    const spans = exporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);
    expect(spanNames).toContain('agentos.turn');
    expect(spanNames).toContain('agentos.gmi.get_or_create');
    expect(spanNames).toContain('agentos.gmi.process_turn_stream');

    const turnSpan = spans.find((s) => s.name === 'agentos.turn');
    expect(turnSpan?.attributes['agentos.stream_id']).toBe(streamId);
    expect(turnSpan?.attributes['agentos.user_id']).toBe('user_1');
    expect(turnSpan?.attributes['agentos.session_id']).toBe('session_1');
    expect(turnSpan?.attributes['agentos.conversation_id']).toBe('conversation_1');

    const metaChunk = streamingManager.chunks.find((c) => c.type === 'metadata_update');
    expect(metaChunk?.metadata?.trace?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(metaChunk?.metadata?.trace?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(metaChunk?.metadata?.trace?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('does not emit spans when disabled', async () => {
    configureAgentOSObservability({ enabled: false });

    const streamingManager = new FakeStreamingManager();

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'persona_test',
      getGMIId: () => 'gmi_test',
      processTurnStream: async function* () {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'hello',
          interactionId: 'turn_1',
          timestamp: new Date(),
          isFinal: true,
        };
        return { isFinal: true, responseText: 'hello' };
      },
    };

    const fakeGmiManager = {
      getOrCreateGMIForSession: async () => ({
        gmi: fakeGmi,
        conversationContext: new ConversationContext('conv_test'),
      }),
    };

    const orchestrator = new AgentOSOrchestrator();
    await orchestrator.initialize(
      { maxToolCallIterations: 1, enableConversationalPersistence: false },
      {
        gmiManager: fakeGmiManager as any,
        toolOrchestrator: {} as any,
        conversationManager: { saveConversation: async () => {} } as any,
        streamingManager: streamingManager as any,
        modelProviderManager: {} as any,
      } as any,
    );

    const streamId = await orchestrator.orchestrateTurn({
      userId: 'user_1',
      sessionId: 'session_1',
      conversationId: 'conversation_1',
      textInput: 'hello',
      selectedPersonaId: 'persona_test',
    });

    await streamingManager.waitClosed(streamId);
    await new Promise((r) => setTimeout(r, 0));

    expect(exporter.getFinishedSpans().length).toBe(0);

    const metaChunk = streamingManager.chunks.find((c) => c.type === 'metadata_update');
    expect(metaChunk?.metadata?.trace).toBeUndefined();
  });

  it('records metrics when enabled', async () => {
    configureAgentOSObservability({
      metrics: { enabled: true, meterName: 'test-agentos-metrics' },
      tracing: { enabled: false },
      logging: { includeTraceIds: false },
    });

    const streamingManager = new FakeStreamingManager();

    const fakeGmi = {
      getCurrentPrimaryPersonaId: () => 'persona_test',
      getGMIId: () => 'gmi_test',
      processTurnStream: async function* () {
        yield {
          type: GMIOutputChunkType.TEXT_DELTA,
          content: 'hello',
          interactionId: 'turn_1',
          timestamp: new Date(),
          isFinal: false,
        };
        yield {
          type: GMIOutputChunkType.FINAL_RESPONSE_MARKER,
          content: null,
          interactionId: 'turn_1',
          timestamp: new Date(),
          isFinal: true,
        };
        return {
          isFinal: true,
          responseText: 'hello',
          usage: { totalTokens: 10, promptTokens: 4, completionTokens: 6, totalCostUSD: 0.001 },
        };
      },
    };

    const fakeGmiManager = {
      getOrCreateGMIForSession: async () => ({
        gmi: fakeGmi,
        conversationContext: new ConversationContext('conv_test'),
      }),
    };

    const orchestrator = new AgentOSOrchestrator();
    await orchestrator.initialize(
      { maxToolCallIterations: 1, enableConversationalPersistence: false },
      {
        gmiManager: fakeGmiManager as any,
        toolOrchestrator: {} as any,
        conversationManager: { saveConversation: async () => {} } as any,
        streamingManager: streamingManager as any,
        modelProviderManager: {} as any,
      } as any,
    );

    const streamId = await orchestrator.orchestrateTurn({
      userId: 'user_1',
      sessionId: 'session_1',
      conversationId: 'conversation_1',
      textInput: 'hello',
      selectedPersonaId: 'persona_test',
    });

    await streamingManager.waitClosed(streamId);
    await new Promise((r) => setTimeout(r, 0));
    await meterProvider.forceFlush();

    const resourceMetrics = metricExporter.getMetrics();
    const allMetrics = resourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
    const metricNames = allMetrics.map((m) => m.descriptor.name);

    expect(metricNames).toContain('agentos.turns');
    expect(metricNames).toContain('agentos.turn.duration_ms');
    expect(metricNames).toContain('agentos.turn.tokens.total');
    expect(metricNames).toContain('agentos.turn.cost.usd');

    const turns = allMetrics.find((m) => m.descriptor.name === 'agentos.turns');
    expect(turns?.dataPointType).toBe(DataPointType.SUM);
    expect((turns as any)?.dataPoints?.[0]?.value).toBeGreaterThan(0);
  });
});
