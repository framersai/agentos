/**
 * @fileoverview Turn planner for AgentOS orchestration.
 *
 * The planner sits before GMI execution and determines:
 * - execution policy for tool failures (fail-open vs fail-closed)
 * - tool selection scope (all tools vs discovery-selected tools)
 * - optional per-turn capability discovery payload
 */
import { GMIError, GMIErrorCode } from '@framers/agentos/core/utils/errors';
const TURN_PLANNER_VERSION = 'agentos-turn-planner-v1';
const DEFAULT_TURN_PLANNER_CONFIG = {
    enabled: true,
    defaultToolFailureMode: 'fail_open',
    allowRequestOverrides: true,
    discovery: {
        enabled: true,
        onlyAvailable: true,
        defaultKind: 'any',
        includePromptContext: true,
        defaultToolSelectionMode: 'discovered',
        maxRetries: 1,
        retryBackoffMs: 150,
    },
};
async function sleep(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return;
    await new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeFailureMode(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');
    if (!normalized)
        return null;
    if (normalized === 'fail_open' || normalized === 'open')
        return 'fail_open';
    if (normalized === 'fail_closed' || normalized === 'closed')
        return 'fail_closed';
    return null;
}
function normalizeToolSelectionMode(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');
    if (!normalized)
        return null;
    if (normalized === 'all' || normalized === 'full')
        return 'all';
    if (normalized === 'discovered' || normalized === 'selected' || normalized === 'retrieved') {
        return 'discovered';
    }
    return null;
}
function readFlag(flags, keys) {
    if (!flags)
        return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(flags, key)) {
            return flags[key];
        }
    }
    return undefined;
}
function buildDiscoveryQueryOptions(capability, excludedCapabilityIds) {
    return {
        kind: capability.kind,
        category: capability.category,
        onlyAvailable: capability.onlyAvailable,
        excludedCapabilityIds,
    };
}
function extractDiscoveredToolNames(result) {
    const names = new Set();
    for (const item of result.tier1) {
        if (item.capability.kind === 'tool' && item.capability.name) {
            names.add(item.capability.name);
        }
    }
    for (const item of result.tier2) {
        if (item.capability.kind === 'tool' && item.capability.name) {
            names.add(item.capability.name);
        }
    }
    return Array.from(names.values());
}
export class AgentOSTurnPlanner {
    constructor(config, discoveryEngine, logger) {
        this.discoveryEngine = discoveryEngine;
        this.logger = logger;
        this.plannerId = TURN_PLANNER_VERSION;
        this.config = {
            ...DEFAULT_TURN_PLANNER_CONFIG,
            ...(config ?? {}),
            discovery: {
                ...DEFAULT_TURN_PLANNER_CONFIG.discovery,
                ...(config?.discovery ?? {}),
            },
        };
    }
    isDiscoveryAvailable() {
        return Boolean(this.config.discovery.enabled &&
            this.discoveryEngine &&
            this.discoveryEngine.isInitialized());
    }
    async planTurn(input) {
        const startedAt = Date.now();
        const customFlags = input.options?.customFlags;
        let toolFailureMode = this.config.defaultToolFailureMode;
        let toolSelectionMode = this.config.discovery.defaultToolSelectionMode;
        if (this.config.allowRequestOverrides) {
            const requestedFailureMode = normalizeFailureMode(readFlag(customFlags, [
                'toolFailureMode',
                'tool_failure_mode',
                'failureMode',
                'failMode',
            ]));
            if (requestedFailureMode) {
                toolFailureMode = requestedFailureMode;
            }
            const requestedSelectionMode = normalizeToolSelectionMode(readFlag(customFlags, [
                'toolSelectionMode',
                'tool_selection_mode',
                'capabilityToolSelectionMode',
            ]));
            if (requestedSelectionMode) {
                toolSelectionMode = requestedSelectionMode;
            }
        }
        const capability = {
            enabled: false,
            query: input.userMessage.trim(),
            kind: this.config.discovery.defaultKind,
            category: undefined,
            onlyAvailable: this.config.discovery.onlyAvailable,
            selectedToolNames: [],
        };
        if (this.config.allowRequestOverrides) {
            const requestedKind = String(readFlag(customFlags, ['capabilityDiscoveryKind', 'capability_kind']) ?? '')
                .trim()
                .toLowerCase();
            if (requestedKind === 'tool' ||
                requestedKind === 'skill' ||
                requestedKind === 'extension' ||
                requestedKind === 'channel' ||
                requestedKind === 'voice' ||
                requestedKind === 'productivity' ||
                requestedKind === 'any') {
                capability.kind = requestedKind;
            }
            const requestedCategory = readFlag(customFlags, [
                'capabilityCategory',
                'capability_category',
            ]);
            if (typeof requestedCategory === 'string' && requestedCategory.trim()) {
                capability.category = requestedCategory.trim();
            }
        }
        const discoveryFlagOverride = this.config.allowRequestOverrides
            ? readFlag(customFlags, ['enableCapabilityDiscovery', 'capabilityDiscovery'])
            : undefined;
        const discoveryEnabledForTurn = typeof discoveryFlagOverride === 'boolean'
            ? discoveryFlagOverride
            : this.config.discovery.enabled;
        const discoveryAttempted = Boolean(discoveryEnabledForTurn) &&
            Boolean(capability.query) &&
            this.isDiscoveryAvailable();
        let discoveryAttempts = 0;
        if (discoveryAttempted && this.discoveryEngine) {
            capability.enabled = true;
            const maxRetries = Math.max(0, Number(this.config.discovery.maxRetries ?? 0));
            const backoffMs = Math.max(0, Number(this.config.discovery.retryBackoffMs ?? 0));
            let lastDiscoveryError = null;
            for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
                discoveryAttempts += 1;
                try {
                    const result = await this.discoveryEngine.discover(capability.query, buildDiscoveryQueryOptions(capability, input.excludedCapabilityIds));
                    capability.result = result;
                    capability.selectedToolNames = extractDiscoveredToolNames(result);
                    if (this.config.discovery.includePromptContext) {
                        const renderFn = this.discoveryEngine.renderForPrompt;
                        if (typeof renderFn === 'function') {
                            capability.promptContext = String(renderFn.call(this.discoveryEngine, result) ?? '');
                        }
                    }
                    lastDiscoveryError = null;
                    if (toolSelectionMode === 'discovered' &&
                        capability.selectedToolNames.length === 0) {
                        capability.fallbackReason =
                            'Discovery produced no tool matches; falling back to full toolset.';
                        capability.fallbackApplied = true;
                        toolSelectionMode = 'all';
                    }
                    break;
                }
                catch (error) {
                    lastDiscoveryError = error;
                    if (attempt < maxRetries) {
                        await sleep(backoffMs);
                        continue;
                    }
                }
            }
            if (lastDiscoveryError) {
                const message = lastDiscoveryError?.message || String(lastDiscoveryError);
                capability.fallbackReason = `Discovery failed after ${discoveryAttempts} attempt(s): ${message}`;
                if (toolFailureMode === 'fail_closed') {
                    throw new GMIError(`Turn planning failed in fail-closed mode: ${message}`, GMIErrorCode.PROCESSING_ERROR, { plannerId: this.plannerId, userId: input.userId, organizationId: input.organizationId });
                }
                capability.fallbackApplied = true;
                toolSelectionMode = 'all';
                this.logger?.warn?.('Turn planner discovery failed; continuing with fail-open policy', {
                    plannerId: this.plannerId,
                    userId: input.userId,
                    organizationId: input.organizationId,
                    message,
                    attempts: discoveryAttempts,
                });
            }
        }
        const plan = {
            policy: {
                plannerVersion: TURN_PLANNER_VERSION,
                toolFailureMode,
                toolSelectionMode,
            },
            capability,
            diagnostics: {
                planningLatencyMs: Date.now() - startedAt,
                discoveryAttempted,
                discoveryApplied: Boolean(capability.result),
                discoveryAttempts,
                usedFallback: capability.fallbackApplied === true,
            },
        };
        return plan;
    }
}
//# sourceMappingURL=TurnPlanner.js.map