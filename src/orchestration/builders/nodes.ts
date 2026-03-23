import type { GraphNode, GraphCondition, NodeExecutionMode, EffectClass, MemoryPolicy, DiscoveryPolicy, PersonaPolicy, GuardrailPolicy, RetryPolicy, CompiledExecutionGraph } from '../ir/types.js';

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
