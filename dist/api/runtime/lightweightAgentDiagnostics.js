import { BASE_AGENT_CONFIG_CAPABILITY_CONTRACT, CAPABILITY_KEYS, } from './capabilityContract.js';
function isMeaningfullyConfigured(value) {
    if (value == null)
        return false;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return value.trim().length > 0;
    if (Array.isArray(value))
        return value.some((entry) => isMeaningfullyConfigured(entry));
    if (value instanceof Map || value instanceof Set)
        return value.size > 0;
    if (typeof value === 'object') {
        const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
        if (entries.length === 0)
            return false;
        return entries.some(([key, entryValue]) => key !== 'enabled' && isMeaningfullyConfigured(entryValue))
            || (entries.length === 1 && entries[0]?.[0] === 'enabled' && entries[0][1] === true);
    }
    return true;
}
export function getDeferredLightweightAgentCapabilities(config) {
    return CAPABILITY_KEYS.filter((key) => BASE_AGENT_CONFIG_CAPABILITY_CONTRACT[key].agent === 'accepted_but_deferred'
        && isMeaningfullyConfigured(config[key]));
}
export function warnOnDeferredLightweightAgentCapabilities(config, warn = console.warn) {
    const deferredCapabilities = getDeferredLightweightAgentCapabilities(config);
    if (deferredCapabilities.length === 0) {
        return deferredCapabilities;
    }
    warn(`[AgentOS] agent() accepted config that requires the full AgentOS runtime or agency(): ${deferredCapabilities.join(', ')}. `
        + 'The lightweight helper preserves these fields for compatibility but does not actively enforce them.');
    return deferredCapabilities;
}
//# sourceMappingURL=lightweightAgentDiagnostics.js.map