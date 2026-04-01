/**
 * @fileoverview CreateWorkflowTool — ITool implementation that enables agents
 * to compose multi-step tool workflows at runtime and execute them as a unit.
 *
 * @module @framers/agentos/emergent/CreateWorkflowTool
 *
 * Agents call `create_workflow` to define, run, and list workflows. A workflow
 * is a named sequence of tool invocations with reference resolution:
 * - `$input`     — the workflow's input argument
 * - `$prev`      — the output of the immediately preceding step
 * - `$steps[N]`  — the output of the Nth step (zero-indexed)
 *
 * Constraints:
 * - Maximum step count is enforced via `config.maxSteps`.
 * - Only tools from `config.allowedTools` may be used in steps.
 * - Recursive workflow creation is blocked (`create_workflow` cannot appear in steps).
 * - Each step execution has a 30-second timeout enforced via `Promise.race`.
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
/**
 * A single step in a workflow definition.
 */
export interface WorkflowStep {
    /** The tool name to invoke for this step. */
    tool: string;
    /** Arguments to pass to the tool (may contain $input, $prev, $steps[N] references). */
    args: Record<string, unknown>;
}
/**
 * A stored workflow definition with execution metadata.
 */
export interface Workflow {
    /** Unique workflow ID. */
    id: string;
    /** Human-readable workflow name. */
    name: string;
    /** Natural language description. */
    description: string;
    /** Ordered list of steps to execute. */
    steps: WorkflowStep[];
    /** ISO-8601 timestamp of creation. */
    createdAt: string;
    /** Number of times this workflow has been run. */
    runCount: number;
}
/**
 * Input arguments accepted by the `create_workflow` tool.
 * Discriminated on the `action` field.
 */
export interface CreateWorkflowInput extends Record<string, any> {
    /** The action to perform: create, run, or list. */
    action: 'create' | 'run' | 'list';
    /** Workflow name (required for create). */
    name?: string;
    /** Workflow description (required for create). */
    description?: string;
    /** Workflow steps (required for create). */
    steps?: WorkflowStep[];
    /** Workflow ID (required for run). */
    workflowId?: string;
    /** Input data passed into the workflow when running. */
    input?: unknown;
}
/**
 * Dependencies injected into the {@link CreateWorkflowTool} constructor.
 */
export interface CreateWorkflowDeps {
    /** Configuration controlling step limits and tool allowlists. */
    config: {
        /** Maximum number of steps allowed in a single workflow. */
        maxSteps: number;
        /** List of tool names that are permitted in workflow steps. */
        allowedTools: string[];
    };
    /** Execute a tool by name with the given arguments. */
    executeTool: (name: string, args: unknown, context?: ToolExecutionContext) => Promise<unknown>;
    /** Return the list of all currently available tool names. */
    listTools: () => string[];
}
/**
 * ITool implementation enabling agents to compose, execute, and list
 * multi-step tool workflows at runtime.
 *
 * @example
 * ```ts
 * const tool = new CreateWorkflowTool({
 *   config: { maxSteps: 10, allowedTools: ['web_search', 'summarize'] },
 *   executeTool: (name, args) => orchestrator.execute(name, args),
 *   listTools: () => orchestrator.listToolNames(),
 * });
 *
 * // Create a workflow
 * const createResult = await tool.execute({
 *   action: 'create',
 *   name: 'search-and-summarize',
 *   description: 'Search the web and summarize results.',
 *   steps: [
 *     { tool: 'web_search', args: { query: '$input' } },
 *     { tool: 'summarize', args: { text: '$prev' } },
 *   ],
 * }, context);
 * ```
 */
export declare class CreateWorkflowTool implements ITool<CreateWorkflowInput> {
    /** @inheritdoc */
    readonly id = "com.framers.emergent.create-workflow";
    /** @inheritdoc */
    readonly name = "create_workflow";
    /** @inheritdoc */
    readonly displayName = "Create Workflow";
    /** @inheritdoc */
    readonly description: string;
    /** @inheritdoc */
    readonly category = "emergent";
    /** @inheritdoc */
    readonly hasSideEffects = true;
    /** @inheritdoc */
    readonly inputSchema: JSONSchemaObject;
    /** Session-scoped workflow storage. */
    private readonly workflowsBySession;
    /** Monotonic counter for generating workflow IDs. */
    private nextId;
    /** Injected dependencies. */
    private readonly deps;
    /**
     * Create a new CreateWorkflowTool.
     *
     * @param deps - Injected dependencies including config, tool executor,
     *   and tool lister.
     */
    constructor(deps: CreateWorkflowDeps);
    /**
     * Execute the requested workflow action.
     *
     * @param args - Action type and associated parameters.
     * @param _context - Tool execution context (unused but required by ITool).
     * @returns A {@link ToolExecutionResult} wrapping the action outcome.
     */
    execute(args: CreateWorkflowInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
    /**
     * Create and store a new workflow definition.
     *
     * Validates:
     * - Required fields (name, description, steps) are present
     * - Step count does not exceed maxSteps
     * - No step references `create_workflow` (prevent recursion)
     * - All step tools exist in the available tool list
     */
    private handleCreate;
    /**
     * Run a stored workflow, executing steps sequentially with reference resolution.
     *
     * Reference resolution:
     * - `$input`    — the workflow's input argument
     * - `$prev`     — the output of the immediately preceding step
     * - `$steps[N]` — the output of the Nth step (zero-indexed)
     *
     * Each step has a 30-second timeout enforced via Promise.race.
     */
    private handleRun;
    /**
     * List all stored workflows.
     */
    private handleList;
    private getSessionWorkflows;
    /**
     * Resolve `$input`, `$prev`, and `$steps[N]` references in step arguments.
     *
     * Uses JSON.stringify → string replacement → JSON.parse cycle for simple
     * reference resolution. References appearing as standalone string values
     * are replaced with the actual object; references embedded in larger strings
     * are serialized inline.
     *
     * @param args - The step arguments potentially containing references.
     * @param input - The workflow input value.
     * @param prev - The output of the previous step.
     * @param stepResults - Array of all completed step outputs.
     * @returns Resolved arguments with references replaced by actual values.
     */
    private resolveReferences;
    private executeStepWithTimeout;
}
//# sourceMappingURL=CreateWorkflowTool.d.ts.map