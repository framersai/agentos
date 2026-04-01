/**
 * @file graphCompiler.ts
 * Compiles agency() strategy configurations into CompiledExecutionGraph IR.
 *
 * This bridge enables the high-level agency() API to leverage the full
 * GraphRuntime DAG engine, gaining:
 *  - Checkpointing / mid-run persistence
 *  - Structured state passing (scratch/artifacts)
 *  - Conditional edge routing
 *  - Guardrail nodes
 *  - Parallel node execution
 *  - Serializable IR
 *
 * Each strategy maps to a different graph topology:
 *  - sequential: A -> B -> C -> END
 *  - parallel: START -> [A, B, C] -> synthesize -> END
 *  - debate: round-based chains with a final synthesizer
 *  - review-loop: producer -> reviewer -> conditional back-edge
 *  - hierarchical: manager GMI node with delegation tool calls
 *
 * @see {@link compileAgencyToGraph} -- the main entry point.
 * @see {@link GraphRuntime} -- the engine that executes the compiled graph.
 */
import { START, END } from '../../../orchestration/ir/types.js';
import { isAgent } from './shared.js';
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Auto-incrementing counter for generating unique edge IDs within a compile pass. */
let edgeCounter = 0;
/**
 * Creates a unique edge ID for a compile pass.
 * Resets are not necessary because IDs only need to be unique within a single graph.
 *
 * @returns A string ID like `"edge_0"`, `"edge_1"`, etc.
 */
function nextEdgeId() {
    return `edge_${edgeCounter++}`;
}
/**
 * Resets the edge counter at the start of each compile pass.
 * Ensures deterministic edge IDs across calls (useful for tests).
 */
function resetEdgeCounter() {
    edgeCounter = 0;
}
/**
 * Extracts the `instructions` string from an agent-or-config value.
 * Falls back to a generic label when no instructions are available.
 *
 * @param agentOrConfig - Either a pre-built Agent or a raw BaseAgentConfig.
 * @param name - The agent's roster name; used in the fallback label.
 * @returns An instruction string suitable for a GMI node's system prompt.
 */
function extractInstructions(agentOrConfig, name) {
    if (!isAgent(agentOrConfig)) {
        return agentOrConfig.instructions ?? `Agent "${name}"`;
    }
    return `Agent "${name}"`;
}
/**
 * Builds a GMI-type GraphNode representing a single agent in the compiled graph.
 *
 * Each agent becomes a "gmi" node whose instructions tell the LLM to:
 *  1. Act as the named agent
 *  2. Read relevant context from scratch (populated by previous nodes)
 *  3. Write its output to scratch for downstream consumption
 *
 * @param nodeId - Unique node identifier within the graph.
 * @param agentName - Human-readable agent name from the roster.
 * @param instructions - System instructions for the GMI node.
 * @param scratchReadKeys - Scratch keys to inject as context (e.g. previous output).
 * @param scratchWriteKey - Scratch key where this node writes its output.
 * @returns A fully configured GraphNode.
 */
function makeAgentNode(nodeId, agentName, instructions, scratchReadKeys, scratchWriteKey) {
    // Build context injection instructions so the LLM knows where to find
    // predecessor outputs in the scratch partition.
    const contextLines = scratchReadKeys.length > 0
        ? `\n\nRead the following from scratch for context: ${scratchReadKeys.join(', ')}.`
        : '';
    return {
        id: nodeId,
        type: 'gmi',
        executorConfig: {
            type: 'gmi',
            instructions: `You are agent "${agentName}". ${instructions}${contextLines}\n\nWrite your output to scratch key "${scratchWriteKey}".`,
        },
        executionMode: 'single_turn',
        // Agent nodes are pure from the graph's perspective -- side effects
        // happen inside the LLM call, which the graph treats as a black box.
        effectClass: 'pure',
        checkpoint: 'after',
    };
}
/**
 * Builds a GMI-type GraphNode for synthesis (combining multiple agent outputs).
 *
 * @param nodeId - Unique node identifier.
 * @param agentOutputKeys - Scratch keys holding the individual agent outputs.
 * @param agencyInstructions - Optional agency-level instructions to append.
 * @returns A GraphNode configured for synthesis.
 */
function makeSynthesizerNode(nodeId, agentOutputKeys, agencyInstructions) {
    const extraInstructions = agencyInstructions
        ? `\n\n${agencyInstructions}`
        : '';
    return {
        id: nodeId,
        type: 'gmi',
        executorConfig: {
            type: 'gmi',
            instructions: `You are a synthesis agent. Multiple agents have produced outputs stored in scratch keys: ${agentOutputKeys.join(', ')}. ` +
                `Read all of them and synthesize a single coherent response. ` +
                `Write the final answer to scratch key "finalOutput".${extraInstructions}`,
        },
        executionMode: 'single_turn',
        effectClass: 'pure',
        checkpoint: 'after',
    };
}
/**
 * Creates a static edge between two nodes.
 *
 * @param source - Source node ID (or START sentinel).
 * @param target - Target node ID (or END sentinel).
 * @returns A static GraphEdge.
 */
function staticEdge(source, target) {
    return {
        id: nextEdgeId(),
        source,
        target,
        type: 'static',
    };
}
/**
 * Creates a conditional edge with an expression-based condition.
 *
 * @param source - Source node ID.
 * @param target - Target node ID.
 * @param expr - Condition expression evaluated against GraphState.
 * @returns A conditional GraphEdge.
 */
function conditionalEdge(source, target, expr) {
    return {
        id: nextEdgeId(),
        source,
        target,
        type: 'conditional',
        condition: { type: 'expression', expr },
    };
}
// ---------------------------------------------------------------------------
// Strategy compilers
// ---------------------------------------------------------------------------
/**
 * Compiles a sequential strategy into a linear chain of GMI nodes.
 *
 * Topology: START -> agent_0 -> agent_1 -> ... -> agent_N -> END
 *
 * Each agent reads the previous agent's output from scratch and writes
 * its own output. The final agent's output becomes the graph's artifact.
 *
 * @param agents - Named roster of agent configs or pre-built Agent instances.
 * @param config - Agency-level configuration.
 * @param prompt - The user's input prompt.
 * @returns The compiled graph components (nodes, edges, reducers).
 */
function compileSequentialGraph(agents, config, prompt) {
    const entries = Object.entries(agents);
    const nodes = [];
    const edges = [];
    for (let i = 0; i < entries.length; i++) {
        const [name, agentOrConfig] = entries[i];
        const nodeId = `agent_${name}`;
        const instructions = extractInstructions(agentOrConfig, name);
        // Each agent reads from the previous agent's output scratch key.
        // The first agent reads from the prompt (injected as scratch.prompt).
        const readKeys = i === 0
            ? ['prompt']
            : [`output_${entries[i - 1][0]}`];
        const writeKey = `output_${name}`;
        nodes.push(makeAgentNode(nodeId, name, instructions, readKeys, writeKey));
        // Wire edges: START -> first node, or previous node -> this node.
        if (i === 0) {
            edges.push(staticEdge(START, nodeId));
        }
        else {
            edges.push(staticEdge(`agent_${entries[i - 1][0]}`, nodeId));
        }
    }
    // Last node -> END
    if (entries.length > 0) {
        edges.push(staticEdge(`agent_${entries[entries.length - 1][0]}`, END));
    }
    // Use 'last' reducer for output keys so each agent overwrites cleanly.
    const reducers = {};
    for (const [name] of entries) {
        reducers[`scratch.output_${name}`] = 'last';
    }
    return { nodes, edges, reducers };
}
/**
 * Compiles a parallel strategy into a fan-out/fan-in graph.
 *
 * Topology: START -> [agent_0, agent_1, ...] -> synthesizer -> END
 *
 * All agent nodes connect from START (running in parallel via GraphRuntime).
 * A synthesizer node connects from all agents to produce a merged result.
 *
 * @param agents - Named roster of agent configs or pre-built Agent instances.
 * @param config - Agency-level configuration.
 * @param prompt - The user's input prompt.
 * @returns The compiled graph components.
 */
function compileParallelGraph(agents, config, prompt) {
    const entries = Object.entries(agents);
    const nodes = [];
    const edges = [];
    const outputKeys = [];
    // Fan-out: each agent node connects directly from START.
    for (const [name, agentOrConfig] of entries) {
        const nodeId = `agent_${name}`;
        const instructions = extractInstructions(agentOrConfig, name);
        const writeKey = `output_${name}`;
        outputKeys.push(writeKey);
        nodes.push(makeAgentNode(nodeId, name, instructions, ['prompt'], writeKey));
        edges.push(staticEdge(START, nodeId));
    }
    // Fan-in: synthesizer reads all agent outputs and produces finalOutput.
    const synthId = 'synthesizer';
    nodes.push(makeSynthesizerNode(synthId, outputKeys, config.instructions));
    // All agents feed into the synthesizer.
    for (const [name] of entries) {
        edges.push(staticEdge(`agent_${name}`, synthId));
    }
    edges.push(staticEdge(synthId, END));
    // Reducers: each output key uses 'last', outputs collection uses 'concat'
    // so parallel branches can write independently without conflict.
    const reducers = {};
    for (const [name] of entries) {
        reducers[`scratch.output_${name}`] = 'last';
    }
    reducers['scratch.agentOutputs'] = 'concat';
    return { nodes, edges, reducers };
}
/**
 * Compiles a debate strategy into a round-based graph.
 *
 * Topology: For R rounds and N agents:
 *   START -> agent_0_r0 -> agent_1_r0 -> ... -> agent_0_r1 -> ... -> synthesizer -> END
 *
 * Each round, agents see all prior arguments. The debate history
 * accumulates in scratch.debateHistory via a 'concat' reducer.
 *
 * @param agents - Named roster of agent configs or pre-built Agent instances.
 * @param config - Agency-level configuration.
 * @param prompt - The user's input prompt.
 * @returns The compiled graph components.
 */
function compileDebateGraph(agents, config, prompt) {
    const entries = Object.entries(agents);
    const maxRounds = config.maxRounds ?? 3;
    const nodes = [];
    const edges = [];
    let previousNodeId = null;
    // Create nodes for each agent in each round, chained sequentially.
    // Within each round, every agent sees the full debate history.
    for (let round = 0; round < maxRounds; round++) {
        for (let i = 0; i < entries.length; i++) {
            const [name, agentOrConfig] = entries[i];
            const nodeId = `agent_${name}_r${round}`;
            const instructions = extractInstructions(agentOrConfig, name);
            const node = {
                id: nodeId,
                type: 'gmi',
                executorConfig: {
                    type: 'gmi',
                    instructions: `You are agent "${name}" in round ${round + 1}/${maxRounds} of a debate. ` +
                        `${instructions}\n\n` +
                        `Read scratch.debateHistory for all prior arguments. ` +
                        `Present your perspective, then write your argument to scratch.debateHistory (it will be appended via concat reducer). ` +
                        `Also write your argument to scratch.latestArgument.`,
                },
                executionMode: 'single_turn',
                effectClass: 'pure',
                checkpoint: 'none',
            };
            nodes.push(node);
            // Wire edge from previous node or START.
            if (previousNodeId === null) {
                edges.push(staticEdge(START, nodeId));
            }
            else {
                edges.push(staticEdge(previousNodeId, nodeId));
            }
            previousNodeId = nodeId;
        }
    }
    // Synthesizer reads the full debate history and produces a final answer.
    const synthId = 'synthesizer';
    nodes.push(makeSynthesizerNode(synthId, ['debateHistory'], config.instructions));
    if (previousNodeId) {
        edges.push(staticEdge(previousNodeId, synthId));
    }
    edges.push(staticEdge(synthId, END));
    // Debate history accumulates via concat; latest argument is last-write-wins.
    const reducers = {
        'scratch.debateHistory': 'concat',
        'scratch.latestArgument': 'last',
    };
    return { nodes, edges, reducers };
}
/**
 * Compiles a review-loop strategy with a conditional back-edge.
 *
 * Topology:
 *   START -> producer -> reviewer -> (conditional)
 *     approved=true  -> END
 *     approved=false -> producer (back to revision, up to maxRounds)
 *
 * A router node after the reviewer checks scratch.reviewApproved.
 * If not approved and rounds remain, execution loops back to the producer.
 * A round counter in scratch prevents infinite loops.
 *
 * @param agents - Named roster; first agent = producer, second = reviewer.
 * @param config - Agency-level configuration.
 * @param prompt - The user's input prompt.
 * @returns The compiled graph components.
 */
function compileReviewLoopGraph(agents, config, prompt) {
    const entries = Object.entries(agents);
    const maxRounds = config.maxRounds ?? 3;
    const [producerName, producerConfig] = entries[0];
    const [reviewerName, reviewerConfig] = entries[1];
    const producerId = `agent_${producerName}`;
    const reviewerId = `agent_${reviewerName}`;
    const routerId = 'review_router';
    const producerInstructions = extractInstructions(producerConfig, producerName);
    const reviewerInstructions = extractInstructions(reviewerConfig, reviewerName);
    const nodes = [
        // Producer: reads prompt + any reviewer feedback from scratch.
        {
            id: producerId,
            type: 'gmi',
            executorConfig: {
                type: 'gmi',
                instructions: `You are the producer agent "${producerName}". ${producerInstructions}\n\n` +
                    `Read scratch.prompt for the task. If scratch.reviewFeedback exists, incorporate that feedback to revise your work. ` +
                    `Write your draft to scratch.draft.`,
            },
            executionMode: 'single_turn',
            effectClass: 'pure',
            checkpoint: 'after',
        },
        // Reviewer: reads the draft and decides approval.
        {
            id: reviewerId,
            type: 'gmi',
            executorConfig: {
                type: 'gmi',
                instructions: `You are the reviewer agent "${reviewerName}". ${reviewerInstructions}\n\n` +
                    `Read scratch.draft for the current work. ` +
                    `Evaluate it and respond with JSON: { "approved": true/false, "feedback": "..." }. ` +
                    `Write the approval boolean to scratch.reviewApproved and your feedback to scratch.reviewFeedback. ` +
                    `Also increment scratch.reviewRound by 1.`,
            },
            executionMode: 'single_turn',
            effectClass: 'pure',
            checkpoint: 'after',
        },
        // Router: checks approval status and round count.
        // Routes to END if approved or rounds exhausted, back to producer otherwise.
        {
            id: routerId,
            type: 'router',
            executorConfig: {
                type: 'router',
                condition: {
                    type: 'function',
                    fn: (state) => {
                        const scratch = state.scratch;
                        const approved = scratch.reviewApproved === true;
                        const round = scratch.reviewRound ?? 0;
                        // Terminate if approved or max rounds exhausted.
                        if (approved || round >= maxRounds) {
                            return END;
                        }
                        // Loop back to producer for revision.
                        return producerId;
                    },
                    description: `Route to END if approved or ${maxRounds} rounds exhausted, otherwise back to producer`,
                },
            },
            executionMode: 'single_turn',
            effectClass: 'pure',
            checkpoint: 'none',
        },
    ];
    const edges = [
        staticEdge(START, producerId),
        staticEdge(producerId, reviewerId),
        staticEdge(reviewerId, routerId),
        // Conditional edges from the router.
        conditionalEdge(routerId, END, `state.scratch.reviewApproved === true || (state.scratch.reviewRound ?? 0) >= ${maxRounds}`),
        conditionalEdge(routerId, producerId, `state.scratch.reviewApproved !== true && (state.scratch.reviewRound ?? 0) < ${maxRounds}`),
    ];
    const reducers = {
        'scratch.draft': 'last',
        'scratch.reviewApproved': 'last',
        'scratch.reviewFeedback': 'last',
        'scratch.reviewRound': 'sum',
    };
    return { nodes, edges, reducers };
}
/**
 * Compiles a hierarchical strategy where a manager node delegates via tool calls.
 *
 * Topology: START -> manager -> END
 *
 * The manager is a GMI node with instructions that describe the team roster.
 * Sub-agent delegation happens via the manager's tool-calling capability --
 * each sub-agent is described in the manager's instructions as a delegate.
 * Actual tool wiring happens at runtime via the NodeExecutor's providerCall.
 *
 * @param agents - Named roster of agent configs or pre-built Agent instances.
 * @param config - Agency-level configuration.
 * @param prompt - The user's input prompt.
 * @returns The compiled graph components.
 */
function compileHierarchicalGraph(agents, config, prompt) {
    const entries = Object.entries(agents);
    // Build the team roster for the manager's system prompt.
    const teamRoster = entries
        .map(([name, agentOrConfig]) => {
        const desc = extractInstructions(agentOrConfig, name);
        return `- delegate_to_${name}: ${desc}`;
    })
        .join('\n');
    const managerInstructions = `You are a manager agent. Your task is to accomplish the user's goal by delegating subtasks to your team members.\n\n` +
        `Available team members (use tool calls to delegate):\n${teamRoster}\n\n` +
        `Synthesize their outputs into a final answer. ` +
        `Write the final answer to scratch.finalOutput.` +
        (config.instructions ? `\n\n${config.instructions}` : '');
    const managerId = 'manager';
    const nodes = [
        {
            id: managerId,
            type: 'gmi',
            executorConfig: {
                type: 'gmi',
                instructions: managerInstructions,
                // Higher iteration budget since the manager needs to make
                // multiple tool calls for delegation.
                maxInternalIterations: config.maxSteps ?? 10,
            },
            executionMode: 'react_bounded',
            effectClass: 'pure',
            checkpoint: 'after',
        },
    ];
    const edges = [
        staticEdge(START, managerId),
        staticEdge(managerId, END),
    ];
    const reducers = {
        'scratch.finalOutput': 'last',
    };
    return { nodes, edges, reducers };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Compiles an agency configuration into a CompiledExecutionGraph
 * that can be executed by GraphRuntime.
 *
 * Each sub-agent becomes a GMI node in the graph. The strategy
 * determines how nodes are connected:
 * - sequential: A -> B -> C -> END
 * - parallel: START -> [A, B, C] -> synthesize -> END
 * - debate: round-based sequential chain -> synthesize -> END
 * - review-loop: produce -> review -> (conditional) produce/END
 * - hierarchical: manager GMI node -> END (delegation via tool calls)
 *
 * The compiled graph carries:
 * - Proper state reducers for scratch field merging
 * - Checkpoint policy for mid-run persistence
 * - Schema declarations for input/scratch/artifacts
 *
 * @param config - The full AgencyOptions with agents, strategy, and settings.
 * @param prompt - The user's input prompt to inject into the graph's initial state.
 * @returns A CompiledExecutionGraph ready for GraphRuntime.invoke() or .stream().
 *
 * @example
 * ```ts
 * const graph = compileAgencyToGraph(agencyConfig, 'Summarise AI research.');
 * const runtime = new GraphRuntime({ checkpointStore, nodeExecutor });
 * const result = await runtime.invoke(graph, { prompt: 'Summarise AI research.' });
 * ```
 */
export function compileAgencyToGraph(config, prompt) {
    resetEdgeCounter();
    const strategy = config.strategy ?? 'sequential';
    const agents = config.agents;
    let compiled;
    switch (strategy) {
        case 'sequential':
            compiled = compileSequentialGraph(agents, config, prompt);
            break;
        case 'parallel':
            compiled = compileParallelGraph(agents, config, prompt);
            break;
        case 'debate':
            compiled = compileDebateGraph(agents, config, prompt);
            break;
        case 'review-loop':
            compiled = compileReviewLoopGraph(agents, config, prompt);
            break;
        case 'hierarchical':
            compiled = compileHierarchicalGraph(agents, config, prompt);
            break;
        case 'graph':
            // The 'graph' strategy already uses DAG semantics in its own compiler.
            // Delegate to the sequential compiler as a baseline; the agentGraphBuilder
            // provides the full DAG experience for 'graph' strategy users.
            compiled = compileSequentialGraph(agents, config, prompt);
            break;
        default:
            throw new Error(`Cannot compile strategy "${strategy}" to graph IR`);
    }
    return {
        id: `agency-${strategy}-${crypto.randomUUID().slice(0, 8)}`,
        name: `Agency (${strategy})`,
        nodes: compiled.nodes,
        edges: compiled.edges,
        stateSchema: {
            input: { type: 'object', properties: { prompt: { type: 'string' } } },
            scratch: { type: 'object' },
            artifacts: { type: 'object' },
        },
        reducers: compiled.reducers,
        // Persist after each node so interrupted runs can be resumed.
        checkpointPolicy: 'explicit',
        memoryConsistency: 'live',
    };
}
/**
 * Maps the final GraphState from a GraphRuntime run back to the shape
 * expected by the agency API's GenerateTextResult.
 *
 * Extracts the final text output from artifacts/scratch and constructs
 * the agentCalls array from the graph's diagnostic node timings.
 *
 * @param finalOutput - The artifacts payload returned by GraphRuntime.invoke().
 * @param config - The original agency configuration (used for metadata).
 * @returns An object compatible with the agency execute() return shape.
 */
export function mapGraphResultToAgencyResult(finalOutput, config) {
    const output = finalOutput;
    // Extract text from various possible locations in the output.
    const text = output?.finalOutput ??
        output?.draft ??
        output?.text ??
        '';
    return {
        text,
        agentCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
}
/**
 * Maps a GraphEvent from the runtime's stream into an AgencyStreamPart.
 *
 * Translates the lower-level graph events (node_start, node_end, text_delta)
 * into the agency-level event vocabulary (agent-start, agent-end, text).
 *
 * @param event - A GraphEvent from GraphRuntime.stream().
 * @param config - The original agency configuration (used for metadata).
 * @returns An AgencyStreamPart, or null if the event has no agency-level equivalent.
 */
export function mapGraphEventToAgencyEvent(event, config) {
    switch (event.type) {
        case 'node_start':
            return {
                type: 'agent-start',
                agent: event.nodeId,
                input: '',
            };
        case 'node_end':
            return {
                type: 'agent-end',
                agent: event.nodeId,
                output: event.output ?? '',
                durationMs: event.durationMs ?? 0,
            };
        case 'text_delta':
            return {
                type: 'text',
                text: event.content,
                agent: event.nodeId,
            };
        case 'run_end':
            return {
                type: 'agent-end',
                agent: '__agency__',
                output: '',
                durationMs: event.totalDurationMs ?? 0,
            };
        default:
            // Many graph events (checkpoint_saved, edge_transition) have no
            // agency-level equivalent -- silently ignore them.
            return null;
    }
}
//# sourceMappingURL=graphCompiler.js.map