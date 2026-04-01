import { Logger, LoggerOptions } from 'pino';
import { ILogger } from './ILogger';
export declare class PinoLogger implements ILogger {
    private readonly base;
    constructor(options?: LoggerOptions, existing?: Logger);
    info(message: string, meta?: Record<string, any>): void;
    warn(message: string, meta?: Record<string, any>): void;
    error(message: string, meta?: Record<string, any>): void;
    debug(message: string, meta?: Record<string, any>): void;
    child(bindings: Record<string, any>): ILogger;
}
//# sourceMappingURL=PinoLogger.d.ts.map