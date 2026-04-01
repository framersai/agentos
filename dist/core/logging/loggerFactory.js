import { PinoLogger } from './PinoLogger.js';
let rootLogger = new PinoLogger({ name: 'agentos' });
let currentFactory = (name, bindings) => rootLogger.child({ component: name, ...(bindings || {}) });
export function setLoggerFactory(factory) {
    currentFactory = factory;
}
export function resetLoggerFactory() {
    rootLogger = new PinoLogger({ name: 'agentos' });
    currentFactory = (name, bindings) => rootLogger.child({ component: name, ...(bindings || {}) });
}
export function createLogger(name, bindings) {
    return currentFactory(name, bindings);
}
//# sourceMappingURL=loggerFactory.js.map