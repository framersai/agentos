/**
 * @fileoverview load_capability_extension meta-tool.
 * @module @framers/agentos/discovery/LoadCapabilityExtensionTool
 *
 * Activates a curated extension pack at runtime so its tools become available
 * on the next tool-selection iteration without requiring a process restart or
 * config mutation.
 */
const INPUT_SCHEMA = {
    type: 'object',
    properties: {
        extensionId: {
            type: 'string',
            description: 'Registry extension name to load at runtime (for example "omdb", "clearbit", or "web-scraper").',
        },
    },
    required: ['extensionId'],
};
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        extensionId: { type: 'string' },
        registeredTools: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['extensionId', 'registeredTools'],
};
/**
 * Create the load_capability_extension meta-tool.
 *
 * This tool is intentionally narrow: it only exposes the existing
 * `ToolOrchestrator.loadExtensionAtRuntime()` hook as an agent-callable
 * capability so the discovery loop can actually activate loadable extensions.
 */
export function createLoadCapabilityExtensionTool(toolOrchestrator) {
    return {
        id: 'agentos-load-capability-extension',
        name: 'load_capability_extension',
        displayName: 'Load Capability Extension',
        description: 'Load a curated extension pack into the current runtime when you have identified an extension ID that is not yet active. ' +
            'Use after discover_capabilities returns a loadable extension or when you already know the registry extension name.',
        inputSchema: INPUT_SCHEMA,
        outputSchema: OUTPUT_SCHEMA,
        category: 'meta',
        hasSideEffects: true,
        async execute(args, _context) {
            const extensionId = args.extensionId.trim();
            if (!extensionId) {
                return {
                    success: false,
                    error: 'extensionId is required.',
                };
            }
            if (typeof toolOrchestrator.loadExtensionAtRuntime !== 'function') {
                return {
                    success: false,
                    error: 'Runtime extension loading is not supported by this tool orchestrator.',
                };
            }
            const registeredTools = await toolOrchestrator.loadExtensionAtRuntime(extensionId);
            if (registeredTools.length === 0) {
                return {
                    success: false,
                    error: `Extension "${extensionId}" could not be loaded or did not register any tools.`,
                };
            }
            return {
                success: true,
                output: {
                    extensionId,
                    registeredTools,
                },
            };
        },
    };
}
//# sourceMappingURL=LoadCapabilityExtensionTool.js.map