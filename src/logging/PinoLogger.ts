import pino, { Logger, LoggerOptions } from 'pino';
import { ILogger } from './ILogger';

export class PinoLogger implements ILogger {
  private readonly base: Logger;

  constructor(options?: LoggerOptions, existing?: Logger) {
    this.base = existing ?? pino(options);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.base.info(meta ?? {}, message);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.base.warn(meta ?? {}, message);
  }

  error(message: string, meta?: Record<string, any>): void {
    this.base.error(meta ?? {}, message);
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.base.debug(meta ?? {}, message);
  }

  child(bindings: Record<string, any>): ILogger {
    return new PinoLogger(undefined, this.base.child(bindings));
  }
}

