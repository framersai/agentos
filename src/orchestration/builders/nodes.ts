import type { GraphNode, GraphCondition, NodeExecutionMode, EffectClass, MemoryPolicy, DiscoveryPolicy, PersonaPolicy, GuardrailPolicy, RetryPolicy, CompiledExecutionGraph } from '../ir/types.js';
import { lowerZodToJsonSchema } from '../compiler/SchemaLowering.js';

export interface NodePolicies {
  memory?: MemoryPolicy;
  discovery?: DiscoveryPolicy;
  persona?: PersonaPolicy;
  guardrails?: GuardrailPolicy;
  checkpoint?: 'before' | 'after' | 'both' | 'none';
  effectClass?: EffectClass;
}

let nodeCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++nodeCounter}`;
}

export function gmiNode(config: {
  instructions: string;
  executionMode?: NodeExecutionMode;
  maxInternalIterations?: number;
  parallelTools?: boolean;
  temperature?: number;
  maxTokens?: number;
}, policies?: NodePolicies): GraphNode {
  return {
    id: nextId('gmi'),
    type: 'gmi',
    executorConfig: {
      type: 'gmi',
      instructions: config.instructions,
      maxInternalIterations: config.maxInternalIterations,
      parallelTools: config.parallelTools,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    },
    executionMode: config.executionMode ?? 'react_bounded',
    effectClass: policies?.effectClass ?? 'read',
    checkpoint: policies?.checkpoint ?? 'none',
    memoryPolicy: policies?.memory,
    discoveryPolicy: policies?.discovery,
    personaPolicy: policies?.persona,
    guardrailPolicy: policies?.guardrails,
  };
}

export function toolNode(toolName: string, config?: {
  timeout?: number;
  retryPolicy?: RetryPolicy;
  args?: Record<string, unknown>;
}, policies?: NodePolicies): GraphNode {
  return {
    id: nextId('tool'),
    type: 'tool',
    executorConfig: { type: 'tool', toolName, args: config?.args },
    executionMode: 'single_turn',
    effectClass: policies?.effectClass ?? 'external',
    timeout: config?.timeout,
    retryPolicy: config?.retryPolicy,
    checkpoint: policies?.checkpoint ?? 'none',
    memoryPolicy: policies?.memory,
    discoveryPolicy: policies?.discovery,
    personaPolicy: policies?.persona,
    guardrailPolicy: policies?.guardrails,
  };
}

export function humanNode(config: {
  prompt: string;
  timeout?: number;
}, policies?: NodePolicies): GraphNode {
  return {
    id: nextId('human'),
    type: 'human',
    executorConfig: { type: 'human', prompt: config.prompt },
    executionMode: 'single_turn',
    effectClass: 'human',
    timeout: config.timeout,
    checkpoint: policies?.checkpoint ?? 'after',
    memoryPolicy: policies?.memory,
    guardrailPolicy: policies?.guardrails,
  };
}

export function routerNode(routeFn: ((state: any) => string) | string): GraphNode {
  const condition: GraphCondition = typeof routeFn === 'string'
    ? { type: 'expression', expr: routeFn }
    : { type: 'function', fn: routeFn };
  return {
    id: nextId('router'),
    type: 'router',
    executorConfig: { type: 'router', condition },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

export function guardrailNode(guardrailIds: string[], config: {
  onViolation: 'block' | 'reroute' | 'warn' | 'sanitize';
  rerouteTarget?: string;
}): GraphNode {
  return {
    id: nextId('guardrail'),
    type: 'guardrail',
    executorConfig: {
      type: 'guardrail',
      guardrailIds,
      onViolation: config.onViolation,
      rerouteTarget: config.rerouteTarget,
    },
    executionMode: 'single_turn',
    effectClass: 'pure',
    checkpoint: 'none',
  };
}

/**
 * Creates an LLM-as-judge evaluation node with structured rubric output.
 * The judge is a gmiNode that enforces single_turn execution and structured JSON output.
 *
 * @param config.rubric - Evaluation criteria description
 * @param config.schema - Zod schema for structured score output
 * @param config.threshold - Optional minimum passing score per dimension
 * @param config.model - Optional model override for the judge LLM
 */
export function judgeNode(config: {
  rubric: string;
  schema: any;
  threshold?: number;
  model?: string;
}, policies?: NodePolicies): GraphNode {
  const instructions = [
    'You are an evaluation judge. Your task is to score content against a rubric.',
    '',
    '## Rubric',
    config.rubric,
    '',
    '## Instructions',
    '1. Read the content in the conversation carefully.',
    '2. Score each dimension in the rubric on a scale of 1-10.',
    '3. Respond with ONLY a JSON object matching the required schema.',
    '4. Do not include any other text, explanation, or commentary.',
    config.threshold
      ? `\n## Pass Threshold\nA score of ${config.threshold} or higher on each dimension is required to pass.`
      : '',
  ].join('\n');

  const base = gmiNode({ instructions, executionMode: 'single_turn' }, policies);

  return {
    ...base,
    id: nextId('judge'),
    outputSchema: lowerZodToJsonSchema(config.schema),
  };
}

export function subgraphNode(compiledGraph: CompiledExecutionGraph, config?: {
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}): GraphNode {
  return {
    id: nextId('subgraph'),
    type: 'subgraph',
    executorConfig: {
      type: 'subgraph',
      graphId: compiledGraph.id,
      inputMapping: config?.inputMapping,
      outputMapping: config?.outputMapping,
    },
    executionMode: 'single_turn',
    effectClass: 'read',
    checkpoint: 'none',
  };
}
