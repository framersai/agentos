/**
 * @fileoverview Synchronous interop helpers for the CommonJS `natural` package
 * from AgentOS's ESM runtime.
 * @module agentos/nlp/naturalInterop
 */
import { createRequire } from 'node:module';
let cachedNaturalModule;
function normalizeNaturalModule(moduleValue) {
    const candidate = moduleValue?.default
        ?? moduleValue?.['module.exports']
        ?? moduleValue;
    return candidate && typeof candidate === 'object' ? candidate : null;
}
/**
 * Load the `natural` module synchronously from Node ESM.
 *
 * Returns `null` when the package is unavailable in the current runtime so
 * callers can degrade gracefully.
 */
export function getNaturalModule() {
    if (cachedNaturalModule !== undefined) {
        return cachedNaturalModule;
    }
    try {
        const require = createRequire(import.meta.url);
        cachedNaturalModule = normalizeNaturalModule(require('natural'));
    }
    catch {
        cachedNaturalModule = null;
    }
    return cachedNaturalModule;
}
//# sourceMappingURL=naturalInterop.js.map