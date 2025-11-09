import { ILogger } from './ILogger';
import { PinoLogger } from './PinoLogger';

export type LoggerFactory = (name: string, bindings?: Record<string, any>) => ILogger;

let rootLogger = new PinoLogger({ name: 'agentos' });
let currentFactory: LoggerFactory = (name, bindings) =>
  rootLogger.child({ component: name, ...(bindings || {}) });

export function setLoggerFactory(factory: LoggerFactory): void {
  currentFactory = factory;
}

export function resetLoggerFactory(): void {
  rootLogger = new PinoLogger({ name: 'agentos' });
  currentFactory = (name, bindings) => rootLogger.child({ component: name, ...(bindings || {}) });
}

export function createLogger(name: string, bindings?: Record<string, any>): ILogger {
  return currentFactory(name, bindings);
}

