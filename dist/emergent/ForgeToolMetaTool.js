/**
 * @fileoverview ForgeToolMetaTool — ITool implementation that agents call to
 * create new tools at runtime via the Emergent Capability Engine.
 *
 * @module @framers/agentos/emergent/ForgeToolMetaTool
 *
 * This is the meta-tool that bridges the LLM tool-call interface with the
 * {@link EmergentCapabilityEngine}. When an agent determines that no existing
 * capability matches its need, it calls `forge_tool` with a name, description,
 * schemas, implementation (compose or sandbox), and test cases.
 *
 * Only registered when the agent is configured with `emergent: true`.
 * Adds ~120 tokens to the tool list.
 */
// ============================================================================
// META-TOOL
// ============================================================================
/**
 * Meta-tool enabling agents to create new tools at runtime.
 *
 * Only registered when the agent is configured with `emergent: true`.
 * Adds ~120 tokens to the tool list. Agents provide: name, description,
 * schemas, implementation (compose existing tools or write sandboxed code),
 * and test cases.
 *
 * @example
 * ```ts
 * const metaTool = new ForgeToolMetaTool(engine);
 * // Register with ToolOrchestrator:
 * orchestrator.registerTool(metaTool);
 *
 * // Agent calls via tool-call interface:
 * const result = await metaTool.execute({
 *   name: 'add_numbers',
 *   description: 'Add two numbers together.',
 *   inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
 *   outputSchema: { type: 'object', properties: { sum: { type: 'number' } } },
 *   implementation: {
 *     mode: 'sandbox',
 *     code: 'function execute(input) { return { sum: input.a + input.b }; }',
 *     allowlist: [],
 *   },
 *   testCases: [{ input: { a: 2, b: 3 }, expectedOutput: { sum: 5 } }],
 * }, context);
 * ```
 */
export class ForgeToolMetaTool {
    /**
     * Create a new ForgeToolMetaTool.
     *
     * @param engine - The {@link EmergentCapabilityEngine} that will handle the
     *   actual forge pipeline (build → test → judge → register).
     */
    constructor(engine) {
        /** @inheritdoc */
        this.id = 'com.framers.emergent.forge-tool';
        /** @inheritdoc */
        this.name = 'forge_tool';
        /** @inheritdoc */
        this.displayName = 'Forge Tool';
        /** @inheritdoc */
        this.description = 'Create a new tool when no existing capability matches your need. ' +
            'Provide a name, description, implementation (compose existing tools or ' +
            'write sandboxed code), and test cases.';
        /** @inheritdoc */
        this.category = 'emergent';
        /** @inheritdoc */
        this.hasSideEffects = true;
        /** @inheritdoc */
        this.inputSchema = {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Machine-readable name for the new tool.',
                },
                description: {
                    type: 'string',
                    description: 'Natural language description of what the tool does.',
                },
                inputSchema: {
                    type: 'object',
                    description: 'JSON Schema for the tool input arguments.',
                },
                outputSchema: {
                    type: 'object',
                    description: 'JSON Schema for the tool output (optional).',
                },
                implementation: {
                    description: 'Implementation: compose existing tools or write sandboxed code.',
                    oneOf: [
                        {
                            type: 'object',
                            properties: {
                                mode: { type: 'string', const: 'compose' },
                                steps: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            name: { type: 'string' },
                                            tool: { type: 'string' },
                                            inputMapping: { type: 'object' },
                                        },
                                        required: ['name', 'tool', 'inputMapping'],
                                    },
                                    minItems: 1,
                                },
                            },
                            required: ['mode', 'steps'],
                        },
                        {
                            type: 'object',
                            properties: {
                                mode: { type: 'string', const: 'sandbox' },
                                code: { type: 'string' },
                                allowlist: {
                                    type: 'array',
                                    items: { type: 'string', enum: ['fetch', 'fs.readFile', 'crypto'] },
                                },
                            },
                            required: ['mode', 'code', 'allowlist'],
                        },
                    ],
                },
                testCases: {
                    type: 'array',
                    description: 'One or more test cases for the judge to evaluate.',
                    items: {
                        type: 'object',
                        properties: {
                            input: { type: 'object' },
                            expectedOutput: {},
                        },
                        required: ['input'],
                    },
                    minItems: 1,
                },
            },
            required: ['name', 'description', 'inputSchema', 'implementation', 'testCases'],
        };
        this.engine = engine;
    }
    // --------------------------------------------------------------------------
    // EXECUTE
    // --------------------------------------------------------------------------
    /**
     * Execute the forge pipeline via the engine.
     *
     * Extracts the agent ID and session/correlation ID from the execution context
     * and delegates to {@link EmergentCapabilityEngine.forge}.
     *
     * @param args - The forge tool input arguments (name, description, schemas,
     *   implementation, test cases).
     * @param context - The tool execution context providing agent and session IDs.
     * @returns A {@link ToolExecutionResult} wrapping the {@link ForgeResult}.
     */
    async execute(args, context) {
        // Validate required fields before delegating to the engine.
        // The LLM may omit or mistype fields; catching this early produces
        // a clear error instead of a cryptic downstream failure.
        if (!args.name || typeof args.name !== 'string') {
            return { success: false, error: 'name is required and must be a string' };
        }
        if (!args.description || typeof args.description !== 'string') {
            return { success: false, error: 'description is required and must be a string' };
        }
        const result = await this.engine.forge(args, {
            // Use nullish coalescing (??), not logical OR (||), so that an empty
            // string '' correctly falls through to 'unknown'. The old || operator
            // treated any falsy value the same, which is correct for empty strings
            // but ?? is more intentional about the distinction.
            agentId: context.gmiId ?? 'unknown',
            sessionId: context.correlationId ?? 'unknown',
        });
        return {
            success: result.success,
            output: result,
            error: result.error,
        };
    }
}
//# sourceMappingURL=ForgeToolMetaTool.js.map