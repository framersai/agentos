import pino, { Logger, LoggerOptions } from 'pino';
import { ILogger } from './ILogger';
import { context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
  getActiveTraceMetadata,
  getAgentOSOtelLoggerName,
  shouldExportAgentOSLogsToOtel,
  shouldIncludeTraceIdsInAgentOSLogs,
} from '../core/observability/otel';

function maybeAttachTraceMeta(meta?: Record<string, any>): Record<string, any> {
  if (!shouldIncludeTraceIdsInAgentOSLogs()) return meta ?? {};
  const traceMeta = getActiveTraceMetadata();
  if (!traceMeta) return meta ?? {};
  return { ...(meta ?? {}), trace_id: traceMeta.traceId, span_id: traceMeta.spanId };
}

function sanitizeAttributes(attributes?: Record<string, any>): Record<string, any> | undefined {
  if (!attributes) return undefined;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const allPrimitive = value.every(
        (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      );
      if (allPrimitive) out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function severityForLevel(level: 'debug' | 'info' | 'warn' | 'error'): {
  severityNumber: SeverityNumber;
  severityText: string;
} {
  if (level === 'debug') return { severityNumber: SeverityNumber.DEBUG, severityText: 'DEBUG' };
  if (level === 'info') return { severityNumber: SeverityNumber.INFO, severityText: 'INFO' };
  if (level === 'warn') return { severityNumber: SeverityNumber.WARN, severityText: 'WARN' };
  return { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' };
}

function pickError(meta?: Record<string, any>): Error | null {
  if (!meta) return null;
  const err = meta.err instanceof Error ? (meta.err as Error) : null;
  if (err) return err;
  const error = meta.error instanceof Error ? (meta.error as Error) : null;
  if (error) return error;
  return null;
}

function maybeEmitOtelLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, any>,
  bindings?: Record<string, any>,
): void {
  if (!shouldExportAgentOSLogsToOtel()) return;

  const { severityNumber, severityText } = severityForLevel(level);
  const err = pickError(meta);

  const attributes: Record<string, any> = {
    ...(bindings ?? {}),
    ...(meta ?? {}),
  };

  if (err) {
    attributes['exception.type'] = err.name;
    attributes['exception.message'] = err.message;
    attributes['exception.stacktrace'] = err.stack;
  }

  try {
    const loggerName = getAgentOSOtelLoggerName();
    logs.getLogger(loggerName).emit({
      timestamp: Date.now(),
      severityNumber,
      severityText,
      body: message,
      attributes: sanitizeAttributes(attributes),
      context: context.active(),
    });
  } catch {
    // never throw from logging paths
  }
}

export class PinoLogger implements ILogger {
  private readonly base: Logger;

  constructor(options?: LoggerOptions, existing?: Logger) {
    this.base = existing ?? pino(options);
  }

  info(message: string, meta?: Record<string, any>): void {
    const metaWithTrace = maybeAttachTraceMeta(meta);
    this.base.info(metaWithTrace, message);
    maybeEmitOtelLog('info', message, metaWithTrace, this.base.bindings());
  }

  warn(message: string, meta?: Record<string, any>): void {
    const metaWithTrace = maybeAttachTraceMeta(meta);
    this.base.warn(metaWithTrace, message);
    maybeEmitOtelLog('warn', message, metaWithTrace, this.base.bindings());
  }

  error(message: string, meta?: Record<string, any>): void {
    const metaWithTrace = maybeAttachTraceMeta(meta);
    this.base.error(metaWithTrace, message);
    maybeEmitOtelLog('error', message, metaWithTrace, this.base.bindings());
  }

  debug(message: string, meta?: Record<string, any>): void {
    const metaWithTrace = maybeAttachTraceMeta(meta);
    this.base.debug(metaWithTrace, message);
    maybeEmitOtelLog('debug', message, metaWithTrace, this.base.bindings());
  }

  child(bindings: Record<string, any>): ILogger {
    return new PinoLogger(undefined, this.base.child(bindings));
  }
}
