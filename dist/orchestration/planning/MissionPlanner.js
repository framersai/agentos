/**
 * @file MissionPlanner.ts
 * @description Tree of Thought mission planner.
 *
 * Three-phase planning pipeline:
 *   Phase 1 — Divergent Exploration: generate N candidate graphs (Yao et al. 2023)
 *   Phase 2 — Evaluation and Selection: score and pick the best (Xie et al. 2023)
 *   Phase 3 — Refinement / Reflexion: fix gaps before execution (Shinn et al. 2023)
 *
 * Each phase uses a separate prompt template loaded from `prompts/`.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { START, END } from '../ir/types.js';
import { ProviderAssignmentEngine } from './ProviderAssignmentEngine.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Load a prompt template from the prompts/ directory. */
function loadPrompt(name) {
    return readFileSync(resolve(__dirname, 'prompts', `${name}.md`), 'utf-8');
}
/** Replace {{PLACEHOLDER}} tokens in a template string. */
function fillPrompt(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
}
/** Extract first JSON object from LLM output that may be wrapped in prose. */
function extractJson(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
        throw new Error(`No JSON found in LLM response: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
}
const STRATEGIES = ['linear', 'parallel', 'hierarchical'];
/**
 * Tree of Thought mission planner.
 *
 * Generates N candidate execution graphs, evaluates them on four dimensions,
 * selects the best (or synthesizes a hybrid), and refines it before
 * compiling to `CompiledExecutionGraph`.
 */
export class MissionPlanner {
    constructor(config) {
        this.config = config;
        this.planLlm = config.plannerLlmCaller ?? config.llmCaller;
        this.decompositionPrompt = loadPrompt('decomposition');
        this.evaluationPrompt = loadPrompt('evaluation');
        this.refinementPrompt = loadPrompt('refinement');
    }
    /**
     * Run the full planning pipeline: explore → evaluate → refine.
     *
     * @param goal - Natural language mission goal.
     * @param context - Available tools and providers.
     * @param onEvent - Optional callback for streaming planning progress events.
     */
    async plan(goal, context, onEvent) {
        onEvent?.({ type: 'mission:planning_start', goal });
        // Phase 1: Divergent exploration — generate N branches
        const branches = await this.generateBranches(goal, context, onEvent);
        // Phase 2: Evaluate and select
        const { selectedBranch, allBranches } = await this.evaluateBranches(branches, context, onEvent);
        // Phase 3: Refine
        const { refinedBranch, refinements } = await this.refineBranch(selectedBranch, context, onEvent);
        const providerAssignedBranch = this.assignProviders(refinedBranch, context);
        // Compile to IR
        const compiledGraph = this.compileToIR(providerAssignedBranch);
        onEvent?.({
            type: 'mission:graph_compiled',
            nodeCount: compiledGraph.nodes.length,
            edgeCount: compiledGraph.edges.length,
            estimatedCost: providerAssignedBranch.estimatedCost,
        });
        return {
            selectedBranch: providerAssignedBranch,
            allBranches,
            refinements,
            compiledGraph,
        };
    }
    // ---------------------------------------------------------------------------
    // Phase 1: Divergent Exploration
    // ---------------------------------------------------------------------------
    async generateBranches(goal, context, onEvent) {
        const toolList = context.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') ||
            'No tools available';
        const providerList = context.providers.join(', ') || 'No providers available';
        const count = Math.min(this.config.branchCount, STRATEGIES.length);
        const branchPromises = STRATEGIES.slice(0, count).map(async (strategy, i) => {
            const prompt = fillPrompt(this.decompositionPrompt, {
                STRATEGY: strategy,
                TOOL_LIST: toolList,
                PROVIDER_LIST: providerList,
                GOAL: goal,
            });
            try {
                const response = await this.planLlm('You are a mission planner for AgentOS. Respond with JSON only.', prompt);
                const parsed = extractJson(response);
                const branchId = `branch_${i}`;
                const branch = {
                    branchId,
                    strategy: parsed.strategy || strategy,
                    summary: parsed.summary || `${strategy} approach`,
                    nodes: this.normalizeNodes(parsed.nodes),
                    edges: this.normalizeEdges(parsed.edges),
                    providerAssignments: [],
                    estimatedCost: parsed.estimatedCost || 0,
                    estimatedLatencyMs: parsed.estimatedLatencyMs || 0,
                    scores: { feasibility: 0, costEfficiency: 0, latency: 0, robustness: 0, overall: 0 },
                };
                onEvent?.({
                    type: 'mission:branch_generated',
                    branchId,
                    summary: branch.summary,
                    scores: branch.scores,
                });
                return branch;
            }
            catch {
                // Branch generation failed — return null, filtered below
                return null;
            }
        });
        const results = await Promise.allSettled(branchPromises);
        const branches = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                branches.push(result.value);
            }
        }
        if (branches.length === 0) {
            throw new Error('All branch generation attempts failed');
        }
        return branches;
    }
    // ---------------------------------------------------------------------------
    // Phase 2: Evaluation
    // ---------------------------------------------------------------------------
    async evaluateBranches(branches, context, onEvent) {
        const toolList = context.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') || 'None';
        const candidatesJson = JSON.stringify(branches.map((b) => ({
            branchId: b.branchId,
            strategy: b.strategy,
            summary: b.summary,
            nodeCount: b.nodes.length,
            nodes: b.nodes.map((n) => ({ id: n.id, type: n.type })),
            edges: b.edges.map((e) => ({ source: e.source, target: e.target })),
            estimatedCost: b.estimatedCost,
            estimatedLatencyMs: b.estimatedLatencyMs,
        })), null, 2);
        const prompt = fillPrompt(this.evaluationPrompt, {
            CANDIDATES_JSON: candidatesJson,
            TOOL_LIST: toolList,
            AVAILABLE_PROVIDERS: context.providers.join(', '),
        });
        const response = await this.planLlm('You are evaluating mission execution candidates. Respond with JSON only.', prompt);
        const parsed = extractJson(response);
        // Apply scores to branches
        for (const evaluation of parsed.evaluations) {
            const branch = branches.find((b) => b.branchId === evaluation.branchId);
            if (branch)
                branch.scores = evaluation.scores;
        }
        const selectedId = parsed.recommendation.selectedBranchId;
        const selectedBranch = branches.find((b) => b.branchId === selectedId) ?? branches[0];
        onEvent?.({
            type: 'mission:branch_selected',
            branchId: selectedBranch.branchId,
            reason: parsed.recommendation.reason,
        });
        return { selectedBranch, allBranches: branches };
    }
    // ---------------------------------------------------------------------------
    // Phase 3: Refinement (Reflexion)
    // ---------------------------------------------------------------------------
    async refineBranch(branch, context, onEvent) {
        const toolList = context.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') || 'None';
        const graphJson = JSON.stringify({ nodes: branch.nodes, edges: branch.edges, estimatedCost: branch.estimatedCost }, null, 2);
        const prompt = fillPrompt(this.refinementPrompt, {
            SELECTED_GRAPH_JSON: graphJson,
            TOOL_LIST: toolList,
        });
        const response = await this.planLlm('You are reviewing a mission execution graph. Respond with JSON only.', prompt);
        const parsed = extractJson(response);
        const refinements = parsed.refinements.map((r) => r.description);
        const refinedBranch = {
            ...branch,
            nodes: [...branch.nodes],
            edges: [...branch.edges],
            estimatedCost: parsed.finalEstimatedCost ?? branch.estimatedCost,
            estimatedLatencyMs: parsed.finalEstimatedLatencyMs ?? branch.estimatedLatencyMs,
        };
        // Apply structural refinements
        for (const refinement of parsed.refinements) {
            if (refinement.type === 'add_node' && refinement.patch) {
                const node = refinement.patch;
                if (node.id)
                    refinedBranch.nodes.push(this.normalizeNode(node));
            }
            if (refinement.type === 'remove_node' && refinement.nodeId) {
                refinedBranch.nodes = refinedBranch.nodes.filter((n) => n.id !== refinement.nodeId);
                refinedBranch.edges = refinedBranch.edges.filter((e) => e.source !== refinement.nodeId && e.target !== refinement.nodeId);
            }
            if (refinement.type === 'add_edge' && refinement.patch) {
                const edge = refinement.patch;
                if (edge.source && edge.target) {
                    refinedBranch.edges.push(this.normalizeEdge(edge, refinedBranch.edges.length));
                }
            }
        }
        if (refinements.length > 0) {
            onEvent?.({ type: 'mission:refinement_applied', changes: refinements });
        }
        return { refinedBranch, refinements };
    }
    // ---------------------------------------------------------------------------
    // Compile to IR
    // ---------------------------------------------------------------------------
    assignProviders(branch, context) {
        const gmiNodes = branch.nodes.filter((node) => node.type === 'gmi');
        if (gmiNodes.length === 0) {
            return { ...branch, providerAssignments: [] };
        }
        const engine = new ProviderAssignmentEngine(context.providers);
        const assignments = engine.assign(gmiNodes.map((node) => ({
            ...node,
            complexity: node.complexity ?? this.estimateComplexity(node),
        })), this.config.providerStrategy);
        const availability = engine.checkAvailability(assignments);
        if (!availability.available) {
            throw new Error(`Mission provider assignment requires unavailable providers: ${availability.missing.join(', ')}`);
        }
        return {
            ...branch,
            providerAssignments: assignments,
            nodes: branch.nodes.map((node) => this.applyProviderAssignment(node, assignments)),
        };
    }
    compileToIR(branch) {
        return {
            id: `mission-${Date.now()}`,
            name: branch.summary,
            nodes: branch.nodes,
            edges: branch.edges,
            stateSchema: { input: {}, scratch: {}, artifacts: {} },
            reducers: {},
            checkpointPolicy: 'every_node',
            memoryConsistency: 'live',
        };
    }
    // ---------------------------------------------------------------------------
    // Normalization helpers
    // ---------------------------------------------------------------------------
    normalizeNodes(nodes) {
        return nodes.map((n) => this.normalizeNode(n));
    }
    normalizeNode(raw) {
        const checkpoint = raw.checkpoint === true
            ? 'after'
            : raw.checkpoint === false
                ? 'none'
                : raw.checkpoint ?? 'after';
        return {
            id: String(raw.id ?? `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
            type: String(raw.type ?? 'gmi'),
            executorConfig: raw.executorConfig ?? {
                type: 'gmi',
                instructions: String(raw.instructions ?? raw.role ?? 'Execute task'),
            },
            executionMode: raw.executionMode ?? 'single_turn',
            effectClass: raw.effectClass ?? 'read',
            checkpoint,
            complexity: typeof raw.complexity === 'number' && Number.isFinite(raw.complexity)
                ? Math.max(0, Math.min(1, raw.complexity))
                : undefined,
        };
    }
    normalizeEdges(edges) {
        return edges.map((e, i) => this.normalizeEdge(e, i));
    }
    normalizeEdge(raw, index) {
        return {
            id: String(raw.id ?? `edge_${index}`),
            source: String(raw.source ?? START),
            target: String(raw.target ?? END),
            type: String(raw.type ?? 'static'),
        };
    }
    applyProviderAssignment(node, assignments) {
        const assignment = assignments.find((item) => item.nodeId === node.id);
        if (!assignment)
            return node;
        return {
            ...node,
            complexity: assignment.complexity,
            llm: {
                providerId: assignment.provider,
                model: assignment.model,
                reason: assignment.reason,
            },
        };
    }
    estimateComplexity(node) {
        if (typeof node.complexity === 'number' && Number.isFinite(node.complexity)) {
            return Math.max(0, Math.min(1, node.complexity));
        }
        if (node.type !== 'gmi')
            return 0.1;
        if (node.executionMode === 'planner_controlled')
            return 0.85;
        if (node.executionMode === 'react_bounded')
            return 0.75;
        const instructions = node.executorConfig.type === 'gmi'
            ? node.executorConfig.instructions.toLowerCase()
            : node.id.toLowerCase();
        if (/\b(research|analy[sz]e|compare|evaluate|reason|judge|plan)\b/.test(instructions)) {
            return 0.75;
        }
        if (/\b(summary|summari[sz]e|draft|write|deliver|merge|final)\b/.test(instructions)) {
            return 0.35;
        }
        if (instructions.length > 180) {
            return 0.65;
        }
        if (instructions.length > 80) {
            return 0.5;
        }
        return 0.4;
    }
}
//# sourceMappingURL=MissionPlanner.js.map