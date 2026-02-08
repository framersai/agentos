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

describe('AgentOS OTEL logs export (env opt-in)', () => {
  let provider: InMemoryLoggerProvider;
  let previousProvider: LoggerProvider;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      AGENTOS_OTEL_LOGS_ENABLED: process.env.AGENTOS_OTEL_LOGS_ENABLED,
      AGENTOS_OTEL_LOGGER_NAME: process.env.AGENTOS_OTEL_LOGGER_NAME,
    };

    previousProvider = logs.getLoggerProvider();
    provider = new InMemoryLoggerProvider();
    logs.setGlobalLoggerProvider(provider);
  });

  afterEach(() => {
    logs.setGlobalLoggerProvider(previousProvider);
    process.env.AGENTOS_OTEL_LOGS_ENABLED = originalEnv.AGENTOS_OTEL_LOGS_ENABLED;
    process.env.AGENTOS_OTEL_LOGGER_NAME = originalEnv.AGENTOS_OTEL_LOGGER_NAME;
    configureAgentOSObservability({ enabled: false });
  });

  it('emits LogRecords when enabled via env', () => {
    process.env.AGENTOS_OTEL_LOGS_ENABLED = 'true';
    process.env.AGENTOS_OTEL_LOGGER_NAME = 'test-agentos-logger';
    configureAgentOSObservability(undefined);

    const logger = new PinoLogger({ level: 'silent', name: 'agentos-test' });
    logger.error('boom', { foo: 'bar' });

    expect(provider.logger.records.length).toBe(1);
    const record = provider.logger.records[0]!;
    expect(record.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record.body).toBe('boom');
    expect((record.attributes as any)?.foo).toBe('bar');
  });
});

