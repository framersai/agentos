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

describe('AgentOS OTEL e2e (env opt-in)', () => {
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
    process.env.AGENTOS_OBSERVABILITY_ENABLED = 'true';
    process.env.AGENTOS_TRACE_IDS_IN_RESPONSES = 'true';
    process.env.AGENTOS_METRICS_ENABLED = 'true';
    configureAgentOSObservability(undefined);
  });

  it('enables spans + trace metadata from env', async () => {
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
    await meterProvider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toContain('agentos.turn');

    const metaChunk = streamingManager.chunks.find((c) => c.type === 'metadata_update');
    expect(metaChunk?.metadata?.trace?.traceId).toMatch(/^[0-9a-f]{32}$/);

    const resourceMetrics = metricExporter.getMetrics();
    const metricNames = resourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)),
    );
    expect(metricNames).toContain('agentos.turns');
  });
});
