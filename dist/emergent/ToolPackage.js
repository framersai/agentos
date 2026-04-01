/**
 * @fileoverview Portable export/import helpers for emergent tools.
 * @module @framers/agentos/emergent/ToolPackage
 */
import YAML from 'yaml';
export const EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION = 'agentos.emergent-tool.v1';
const EMPTY_USAGE_STATS = {
    totalUses: 0,
    successCount: 0,
    failureCount: 0,
    avgExecutionTimeMs: 0,
    confidenceScore: 0,
    lastUsedAt: null,
};
function randomSuffix() {
    return Math.random().toString(36).slice(2, 8);
}
function buildPortableImplementation(tool) {
    if (tool.implementation.mode === 'compose') {
        return {
            implementation: {
                mode: 'compose',
                steps: tool.implementation.steps.map((step) => ({
                    ...step,
                    inputMapping: { ...step.inputMapping },
                })),
            },
            portability: {
                portable: true,
                warnings: [],
            },
        };
    }
    const sandboxImplementation = tool.implementation;
    const hasSource = typeof sandboxImplementation.code === 'string' && sandboxImplementation.code.trim().length > 0;
    return {
        implementation: {
            mode: 'sandbox',
            allowlist: [...sandboxImplementation.allowlist],
            sourcePersisted: hasSource,
            redactedAtRest: !hasSource,
            ...(hasSource ? { code: sandboxImplementation.code } : {}),
        },
        portability: {
            portable: hasSource,
            warnings: hasSource
                ? []
                : [
                    'Sandbox source is redacted at rest. This package is reviewable but not portable for import/runtime rehydration.',
                ],
        },
    };
}
export function buildEmergentToolPackage(tool, options = {}) {
    const { implementation, portability } = buildPortableImplementation(tool);
    return {
        schemaVersion: EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION,
        packageType: 'emergent-tool',
        exportedAt: options.exportedAt ?? new Date().toISOString(),
        portability,
        tool: {
            originalToolId: tool.id,
            originalTier: tool.tier,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            implementation,
            createdBy: tool.createdBy,
            createdAt: tool.createdAt,
            source: tool.source,
            judgeVerdicts: options.includeJudgeVerdicts === false
                ? []
                : [...tool.judgeVerdicts],
            usageStats: options.includeUsageStats === false
                ? { ...EMPTY_USAGE_STATS }
                : { ...tool.usageStats },
        },
    };
}
export function serializeEmergentToolPackage(manifest, format = 'yaml') {
    if (format === 'json') {
        return JSON.stringify(manifest, null, 2);
    }
    return YAML.stringify(manifest);
}
export function parseEmergentToolPackage(raw) {
    const trimmed = raw.trim();
    const parsed = (trimmed.startsWith('{') || trimmed.startsWith('[')
        ? JSON.parse(trimmed)
        : YAML.parse(trimmed));
    if (!parsed ||
        parsed.schemaVersion !== EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION ||
        parsed.packageType !== 'emergent-tool') {
        throw new Error(`Unsupported emergent tool package. Expected schemaVersion "${EMERGENT_TOOL_PACKAGE_SCHEMA_VERSION}".`);
    }
    return parsed;
}
export function materializeEmergentToolFromPackage(manifest, options) {
    const implementation = manifest.tool.implementation;
    let resolvedImplementation;
    if (implementation.mode === 'compose') {
        resolvedImplementation = {
            mode: 'compose',
            steps: implementation.steps.map((step) => ({
                ...step,
                inputMapping: { ...step.inputMapping },
            })),
        };
    }
    else {
        if (!implementation.code || !implementation.code.trim()) {
            throw new Error('Sandbox source is missing from the exported package. This tool cannot be imported into another agent runtime.');
        }
        resolvedImplementation = {
            mode: 'sandbox',
            code: implementation.code,
            allowlist: [...implementation.allowlist],
        };
    }
    const createdAt = options.createdAt ?? new Date().toISOString();
    const importedName = options.toolName ?? manifest.tool.name;
    const usageStats = options.preserveUsageStats
        ? { ...manifest.tool.usageStats }
        : { ...EMPTY_USAGE_STATS };
    const judgeVerdicts = options.preserveJudgeVerdicts === false
        ? []
        : [...manifest.tool.judgeVerdicts];
    return {
        id: options.toolId ?? `emergent_import_${Date.now()}_${randomSuffix()}`,
        name: importedName,
        description: manifest.tool.description,
        inputSchema: manifest.tool.inputSchema,
        outputSchema: manifest.tool.outputSchema,
        implementation: resolvedImplementation,
        tier: options.tier ?? 'agent',
        createdBy: options.createdBy,
        createdAt,
        judgeVerdicts,
        usageStats,
        source: `imported from emergent package ${manifest.tool.originalToolId} ` +
            `(original tier: ${manifest.tool.originalTier})`,
    };
}
//# sourceMappingURL=ToolPackage.js.map