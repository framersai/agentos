import { ILogger } from './ILogger';
export type LoggerFactory = (name: string, bindings?: Record<string, any>) => ILogger;
export declare function setLoggerFactory(factory: LoggerFactory): void;
export declare function resetLoggerFactory(): void;
export declare function createLogger(name: string, bindings?: Record<string, any>): ILogger;
//# sourceMappingURL=loggerFactory.d.ts.map