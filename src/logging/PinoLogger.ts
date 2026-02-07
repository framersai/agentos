import pino, { Logger, LoggerOptions } from 'pino';
import { ILogger } from './ILogger';
import { getActiveTraceMetadata, shouldIncludeTraceIdsInAgentOSLogs } from '../core/observability/otel';

function maybeAttachTraceMeta(meta?: Record<string, any>): Record<string, any> {
  if (!shouldIncludeTraceIdsInAgentOSLogs()) return meta ?? {};
  const traceMeta = getActiveTraceMetadata();
  if (!traceMeta) return meta ?? {};
  return { ...(meta ?? {}), trace_id: traceMeta.traceId, span_id: traceMeta.spanId };
}

export class PinoLogger implements ILogger {
  private readonly base: Logger;

  constructor(options?: LoggerOptions, existing?: Logger) {
    this.base = existing ?? pino(options);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.base.info(maybeAttachTraceMeta(meta), message);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.base.warn(maybeAttachTraceMeta(meta), message);
  }

  error(message: string, meta?: Record<string, any>): void {
    this.base.error(maybeAttachTraceMeta(meta), message);
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.base.debug(maybeAttachTraceMeta(meta), message);
  }

  child(bindings: Record<string, any>): ILogger {
    return new PinoLogger(undefined, this.base.child(bindings));
  }
}
