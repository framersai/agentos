/**
 * Shared export-only helpers for lightweight agents and agencies.
 *
 * Kept separate from `agentExport.ts` so the lightweight `agent()` entrypoint
 * can expose config export methods without pulling in agency import/runtime
 * code and optional channel adapters.
 */
/**
 * Extracts the stored configuration from an Agent instance.
 *
 * The agent's config is captured at creation time by the `agent()` and
 * `agency()` factories and attached as a non-enumerable `__config` property.
 */
function extractConfig(agentInstance) {
    const config = agentInstance.__config;
    if (config && typeof config === 'object') {
        return config;
    }
    return {};
}
/**
 * Extracts agency-specific fields from an Agent instance that was created
 * by the `agency()` factory.
 */
function extractAgencyFields(agentInstance) {
    const raw = agentInstance.__agencyConfig;
    if (raw && typeof raw === 'object') {
        return raw;
    }
    return undefined;
}
/**
 * Exports an agent's configuration as a portable object.
 */
export function exportAgentConfig(agentInstance, metadata) {
    const config = extractConfig(agentInstance);
    const agencyFields = extractAgencyFields(agentInstance);
    const isAgency = !!agencyFields?.agents;
    const exportConfig = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        type: isAgency ? 'agency' : 'agent',
        config,
    };
    if (isAgency && agencyFields) {
        exportConfig.agents = agencyFields.agents;
        exportConfig.strategy = agencyFields.strategy;
        exportConfig.adaptive = agencyFields.adaptive;
        exportConfig.maxRounds = agencyFields.maxRounds;
    }
    if (metadata) {
        exportConfig.metadata = metadata;
    }
    return exportConfig;
}
/**
 * Exports an agent's configuration as pretty-printed JSON.
 */
export function exportAgentConfigJSON(agentInstance, metadata) {
    return JSON.stringify(exportAgentConfig(agentInstance, metadata), null, 2);
}
//# sourceMappingURL=agentExportCore.js.map