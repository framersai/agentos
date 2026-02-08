import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogRecord, Logger as OtelLogger, LoggerProvider } from '@opentelemetry/api-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

import { configureAgentOSObservability } from '../../src/core/observability/otel';
import { PinoLogger } from '../../src/logging/PinoLogger';

class InMemoryLogger implements OtelLogger {
  public readonly records: LogRecord[] = [];
  emit(logRecord: LogRecord): void {
    this.records.push(logRecord);
  }
}

class InMemoryLoggerProvider implements LoggerProvider {
  public readonly logger = new InMemoryLogger();
  getLogger(_name: string): OtelLogger {
    return this.logger;
  }
}

describe('AgentOS OTEL logs export (integration)', () => {
  let provider: InMemoryLoggerProvider;
  let previousProvider: LoggerProvider;

  beforeEach(() => {
    previousProvider = logs.getLoggerProvider();
    provider = new InMemoryLoggerProvider();
    logs.setGlobalLoggerProvider(provider);
    configureAgentOSObservability({ enabled: false });
  });

  afterEach(() => {
    logs.setGlobalLoggerProvider(previousProvider);
    configureAgentOSObservability({ enabled: false });
  });

  it('emits LogRecords when enabled via config', () => {
    configureAgentOSObservability({
      tracing: { enabled: false },
      metrics: { enabled: false },
      logging: { includeTraceIds: false, exportToOtel: true, otelLoggerName: 'test-agentos-logger' },
    });

    const logger = new PinoLogger({ level: 'silent', name: 'agentos-test' });
    logger.info('hello', { foo: 'bar' });

    expect(provider.logger.records.length).toBe(1);
    const record = provider.logger.records[0]!;
    expect(record.severityNumber).toBe(SeverityNumber.INFO);
    expect(record.severityText).toBe('INFO');
    expect(record.body).toBe('hello');
    expect((record.attributes as any)?.foo).toBe('bar');
  });

  it('does not emit LogRecords when disabled', () => {
    configureAgentOSObservability({
      tracing: { enabled: false },
      metrics: { enabled: false },
      logging: { includeTraceIds: false, exportToOtel: false },
    });

    const logger = new PinoLogger({ level: 'silent', name: 'agentos-test' });
    logger.warn('nope', { foo: 'bar' });

    expect(provider.logger.records.length).toBe(0);
  });
});

