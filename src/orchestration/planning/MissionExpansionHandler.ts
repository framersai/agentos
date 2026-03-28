/**
 * @file MissionExpansionHandler.ts
 * @description Mission-specific graph expansion adapter for GraphRuntime.
 *
 * Converts tool-originated expansion requests into GraphPatch proposals, applies
 * autonomy/guardrail gating, and emits mission events when a patch is approved.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CompiledExecutionGraph,
  GraphCondition,
  GraphEdge,
  GraphNode,
  NodeLlmConfig,
  VoiceNodeConfig,
} from '../ir/types.js';
import { END, START } from '../ir/types.js';
import type { GraphEvent, MissionGraphPatch } from '../events/GraphEvent.js';
import type { GraphExpansionHandler, GraphExpansionRequest } from '../runtime/GraphRuntime.js';
import { GraphExpander } from './GraphExpander.js';
import type {
  AutonomyMode,
  GuardrailThresholds,
  ProviderStrategyConfig,
} from './types.js';
import { ProviderAssignmentEngine } from './ProviderAssignmentEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrompt(name: string): string {
  return readFileSync(resolve(__dirname, 'prompts', `${name}.md`), 'utf-8');
}

function fillPrompt(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in LLM response: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'agent';
}

function clampComplexity(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function estimateComplexity(node: GraphNode): number {
  if (typeof node.complexity === 'number' && Number.isFinite(node.complexity)) {
    return Math.max(0, Math.min(1, node.complexity));
  }

  if (node.type !== 'gmi') return 0.1;
  if (node.executionMode === 'planner_controlled') return 0.85;
  if (node.executionMode === 'react_bounded') return 0.75;

  const instructions =
    node.executorConfig.type === 'gmi'
      ? node.executorConfig.instructions.toLowerCase()
      : node.id.toLowerCase();

  if (/\b(research|analy[sz]e|compare|evaluate|reason|judge|plan)\b/.test(instructions)) {
    return 0.75;
  }
  if (/\b(summary|summari[sz]e|draft|write|deliver|merge|final|verify|fact)\b/.test(instructions)) {
    return 0.45;
  }
  if (instructions.length > 180) return 0.65;
  if (instructions.length > 80) return 0.5;
  return 0.35;
}

function buildExecutorConfig(
  raw: Record<string, unknown>,
  fallbackId: string,
): GraphNode['executorConfig'] {
  if (isRecord(raw.executorConfig)) {
    return raw.executorConfig as GraphNode['executorConfig'];
  }

  const type = String(raw.type ?? 'gmi') as GraphNode['type'];

  switch (type) {
    case 'tool':
      return {
        type: 'tool',
        toolName: String(raw.toolName ?? raw.name ?? fallbackId),
        ...(isRecord(raw.args) ? { args: raw.args } : {}),
      };
    case 'extension':
      return {
        type: 'extension',
        extensionId: String(raw.extensionId ?? 'extension'),
        method: String(raw.method ?? 'run'),
      };
    case 'human':
      return {
        type: 'human',
        prompt: String(raw.prompt ?? raw.instructions ?? raw.role ?? `Review ${fallbackId}`),
      };
    case 'guardrail':
      return {
        type: 'guardrail',
        guardrailIds: Array.isArray(raw.guardrailIds)
          ? raw.guardrailIds.filter((value): value is string => typeof value === 'string')
          : [],
        onViolation:
          raw.onViolation === 'reroute'
          || raw.onViolation === 'warn'
          || raw.onViolation === 'sanitize'
            ? raw.onViolation
            : 'block',
        ...(typeof raw.rerouteTarget === 'string' ? { rerouteTarget: raw.rerouteTarget } : {}),
      };
    case 'router':
      return {
        type: 'router',
        condition: ((raw.condition as unknown as Record<string, unknown>)?.type
          ? raw.condition as unknown as GraphCondition
          : { type: 'expression' as const, expr: `'${END}'` }),
      };
    case 'subgraph':
      return {
        type: 'subgraph',
        graphId: String(raw.graphId ?? fallbackId),
        ...(isRecord(raw.inputMapping) ? { inputMapping: raw.inputMapping as Record<string, string> } : {}),
        ...(isRecord(raw.outputMapping) ? { outputMapping: raw.outputMapping as Record<string, string> } : {}),
      };
    case 'voice':
      return {
        type: 'voice',
        voiceConfig: isRecord(raw.voiceConfig)
          ? raw.voiceConfig as unknown as VoiceNodeConfig
          : { mode: 'conversation' as const },
      };
    case 'gmi':
    default:
      return {
        type: 'gmi',
        instructions: String(raw.instructions ?? raw.role ?? `Execute ${fallbackId}`),
        ...(typeof raw.maxInternalIterations === 'number'
          ? { maxInternalIterations: raw.maxInternalIterations }
          : {}),
        ...(typeof raw.parallelTools === 'boolean' ? { parallelTools: raw.parallelTools } : {}),
        ...(typeof raw.temperature === 'number' ? { temperature: raw.temperature } : {}),
        ...(typeof raw.maxTokens === 'number' ? { maxTokens: raw.maxTokens } : {}),
      };
  }
}

function normalizeNode(raw: Record<string, unknown>): GraphNode {
  const checkpoint =
    raw.checkpoint === true
      ? 'after'
      : raw.checkpoint === false
        ? 'none'
        : (raw.checkpoint as GraphNode['checkpoint'] | undefined) ?? 'after';
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    type: String(raw.type ?? 'gmi') as GraphNode['type'],
    executorConfig: buildExecutorConfig(raw, id),
    executionMode: (raw.executionMode as GraphNode['executionMode']) ?? 'single_turn',
    effectClass: (raw.effectClass as GraphNode['effectClass']) ?? 'read',
    checkpoint,
    complexity: clampComplexity(raw.complexity as number | undefined),
    ...(isRecord(raw.llm) ? { llm: raw.llm as unknown as NodeLlmConfig } : {}),
    ...(typeof raw.timeout === 'number' ? { timeout: raw.timeout } : {}),
    ...(isRecord(raw.retryPolicy) ? { retryPolicy: raw.retryPolicy as unknown as GraphNode['retryPolicy'] } : {}),
    ...(isRecord(raw.inputSchema) ? { inputSchema: raw.inputSchema } : {}),
    ...(isRecord(raw.outputSchema) ? { outputSchema: raw.outputSchema } : {}),
    ...(isRecord(raw.memoryPolicy)
      ? { memoryPolicy: raw.memoryPolicy as unknown as GraphNode['memoryPolicy'] }
      : {}),
    ...(isRecord(raw.discoveryPolicy)
      ? { discoveryPolicy: raw.discoveryPolicy as unknown as GraphNode['discoveryPolicy'] }
      : {}),
    ...(isRecord(raw.personaPolicy)
      ? { personaPolicy: raw.personaPolicy as unknown as GraphNode['personaPolicy'] }
      : {}),
    ...(isRecord(raw.guardrailPolicy)
      ? { guardrailPolicy: raw.guardrailPolicy as unknown as GraphNode['guardrailPolicy'] }
      : {}),
  };
}

function normalizeEdge(raw: Record<string, unknown>, index: number): GraphEdge {
  return {
    id: String(raw.id ?? `edge_${Date.now()}_${index}`),
    source: String(raw.source ?? START),
    target: String(raw.target ?? END),
    type: String(raw.type ?? 'static') as GraphEdge['type'],
    ...(raw.condition ? { condition: raw.condition as GraphEdge['condition'] } : {}),
    ...(typeof raw.discoveryQuery === 'string' ? { discoveryQuery: raw.discoveryQuery } : {}),
    ...(typeof raw.discoveryKind === 'string' ? { discoveryKind: raw.discoveryKind as GraphEdge['discoveryKind'] } : {}),
    ...(typeof raw.discoveryFallback === 'string' ? { discoveryFallback: raw.discoveryFallback } : {}),
    ...(isRecord(raw.personalityCondition)
      ? { personalityCondition: raw.personalityCondition as GraphEdge['personalityCondition'] }
      : {}),
    ...(isRecord(raw.guardrailPolicy)
      ? { guardrailPolicy: raw.guardrailPolicy as unknown as GraphEdge['guardrailPolicy'] }
      : {}),
  };
}

function normalizeGraphPatch(raw: MissionGraphPatch | Record<string, unknown>): MissionGraphPatch {
  const patch = raw as Record<string, unknown>;
  const addNodes = Array.isArray(patch.addNodes)
    ? patch.addNodes.filter(isRecord).map((node) => normalizeNode(node))
    : [];
  const addEdges = Array.isArray(patch.addEdges)
    ? patch.addEdges.filter(isRecord).map((edge, index) => normalizeEdge(edge, index))
    : [];

  return {
    addNodes,
    addEdges,
    removeNodes: Array.isArray(patch.removeNodes)
      ? patch.removeNodes.filter((value): value is string => typeof value === 'string')
      : [],
    rewireEdges: Array.isArray(patch.rewireEdges)
      ? patch.rewireEdges
          .filter(isRecord)
          .map((edge) => ({
            from: String(edge.from ?? ''),
            to: String(edge.to ?? ''),
            newTarget: String(edge.newTarget ?? ''),
          }))
          .filter((edge) => edge.from && edge.to && edge.newTarget)
      : [],
    reason: String(patch.reason ?? 'Mission graph expansion'),
    estimatedCostDelta:
      typeof patch.estimatedCostDelta === 'number' && Number.isFinite(patch.estimatedCostDelta)
        ? patch.estimatedCostDelta
        : 0,
    estimatedLatencyDelta:
      typeof patch.estimatedLatencyDelta === 'number' && Number.isFinite(patch.estimatedLatencyDelta)
        ? patch.estimatedLatencyDelta
        : 0,
  };
}

function describeRole(node: GraphNode): string {
  if (node.executorConfig.type === 'gmi') return node.executorConfig.instructions;
  if (node.executorConfig.type === 'tool') return `tool:${node.executorConfig.toolName}`;
  return node.id;
}

function isToolLikeNode(node: GraphNode): boolean {
  return node.type === 'tool' || node.executorConfig.type === 'tool';
}

function computeGraphDepth(graph: CompiledExecutionGraph): number {
  const depths = new Map<string, number>();
  const queue: Array<{ nodeId: string; depth: number }> = [];

  for (const edge of graph.edges) {
    if (edge.source !== START || edge.target === END) continue;
    queue.push({ nodeId: edge.target, depth: 1 });
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const previousDepth = depths.get(current.nodeId) ?? Number.POSITIVE_INFINITY;
    if (current.depth >= previousDepth) continue;

    depths.set(current.nodeId, current.depth);

    for (const edge of graph.edges) {
      if (edge.source !== current.nodeId || edge.target === END) continue;
      queue.push({ nodeId: edge.target, depth: current.depth + 1 });
    }
  }

  return Math.max(0, ...depths.values());
}

function resolveSourceNodeId(spec: Record<string, unknown>, requesterNodeId: string): string {
  for (const key of ['afterNodeId', 'sourceNodeId', 'parentNodeId'] as const) {
    const value = spec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return requesterNodeId;
}

function resolveTargetNodeId(spec: Record<string, unknown>): string {
  for (const key of ['nodeId', 'targetNodeId', 'agentId'] as const) {
    const value = spec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function cloneEdge(edge: GraphEdge, overrides: Partial<GraphEdge>, suffix: string): GraphEdge {
  return {
    ...edge,
    ...overrides,
    id: `${edge.id}_${suffix}`,
  };
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const result: GraphEdge[] = [];

  for (const edge of edges) {
    const key = JSON.stringify({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      condition: edge.condition,
      discoveryQuery: edge.discoveryQuery,
      discoveryKind: edge.discoveryKind,
      discoveryFallback: edge.discoveryFallback,
      personalityCondition: edge.personalityCondition,
      guardrailPolicy: edge.guardrailPolicy,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }

  return result;
}

function buildInlineInsertionPatch(
  newNode: GraphNode,
  graph: CompiledExecutionGraph,
  sourceNodeId: string,
  reason: string,
  estimates: { cost: number; latencyMs: number },
): MissionGraphPatch {
  const outEdges = graph.edges.filter((edge) => edge.source === sourceNodeId);
  const staticOutEdges = outEdges.filter((edge) => edge.type === 'static');
  const addEdges: GraphEdge[] = [
    {
      id: `expansion_edge_${sourceNodeId}_${newNode.id}`,
      source: sourceNodeId,
      target: newNode.id,
      type: 'static',
    },
  ];
  const rewireEdges: MissionGraphPatch['rewireEdges'] = [];

  if (staticOutEdges.length > 0) {
    for (const edge of staticOutEdges) {
      rewireEdges.push({
        from: sourceNodeId,
        to: edge.target,
        newTarget: newNode.id,
      });
      addEdges.push(cloneEdge(edge, { source: newNode.id }, `after_${newNode.id}`));
    }
  } else {
    addEdges.push({
      id: `expansion_edge_${newNode.id}_end`,
      source: newNode.id,
      target: END,
      type: 'static',
    });
  }

  return {
    addNodes: [newNode],
    addEdges: dedupeEdges(addEdges),
    removeNodes: [],
    rewireEdges,
    reason,
    estimatedCostDelta: estimates.cost,
    estimatedLatencyDelta: estimates.latencyMs,
  };
}

function buildSpawnAgentPatch(
  spec: Record<string, unknown>,
  graph: CompiledExecutionGraph,
  requesterNodeId: string,
  reason: string,
): MissionGraphPatch | null {
  const role = String(spec.role ?? spec.nodeId ?? spec.name ?? 'support_agent');
  const instructions = String(spec.instructions ?? `Handle ${role}`);
  const nodeId =
    typeof spec.nodeId === 'string' && spec.nodeId.trim()
      ? spec.nodeId.trim()
      : slugify(role);
  const sourceNodeId = resolveSourceNodeId(spec, requesterNodeId);

  const newNode = normalizeNode({
    id: nodeId,
    type: spec.type ?? 'gmi',
    executorConfig: isRecord(spec.executorConfig)
      ? spec.executorConfig
      : buildExecutorConfig({
          ...spec,
          type: spec.type ?? 'gmi',
          instructions,
        }, nodeId),
    executionMode: spec.executionMode ?? 'single_turn',
    effectClass: spec.effectClass ?? 'read',
    checkpoint: spec.checkpoint ?? 'after',
    complexity: spec.complexity,
    ...(isRecord(spec.llm) ? { llm: spec.llm } : {}),
  });

  return buildInlineInsertionPatch(newNode, graph, sourceNodeId, reason, {
    cost:
      typeof spec.estimatedCostDelta === 'number' && Number.isFinite(spec.estimatedCostDelta)
        ? spec.estimatedCostDelta
        : 0.5,
    latencyMs:
      typeof spec.estimatedLatencyDelta === 'number' && Number.isFinite(spec.estimatedLatencyDelta)
        ? spec.estimatedLatencyDelta
        : 30_000,
  });
}

function buildRemoveAgentPatch(
  spec: Record<string, unknown>,
  graph: CompiledExecutionGraph,
  reason: string,
): MissionGraphPatch | null {
  const nodeId = resolveTargetNodeId(spec);
  if (!nodeId) return null;

  const incomingStatic = graph.edges.filter((edge) => edge.target === nodeId && edge.type === 'static');
  const outgoingStatic = graph.edges.filter((edge) => edge.source === nodeId && edge.type === 'static');
  const nextTargets = outgoingStatic.length > 0
    ? outgoingStatic.map((edge) => edge.target)
    : [END];
  const addEdges: GraphEdge[] = [];

  for (const edge of incomingStatic) {
    for (const nextTarget of nextTargets) {
      if (edge.source === nextTarget) continue;
      addEdges.push(
        cloneEdge(
          edge,
          { target: nextTarget },
          `remove_${nodeId}_${nextTarget.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        ),
      );
    }
  }

  return {
    addNodes: [],
    addEdges: dedupeEdges(addEdges),
    removeNodes: [nodeId],
    rewireEdges: [],
    reason,
    estimatedCostDelta: 0,
    estimatedLatencyDelta: 0,
  };
}

function buildReassignedNode(existing: GraphNode, spec: Record<string, unknown>): GraphNode {
  const nextType = (typeof spec.type === 'string' && spec.type.trim()
    ? spec.type.trim()
    : existing.type) as GraphNode['type'];

  let executorConfig = existing.executorConfig;
  if (isRecord(spec.executorConfig)) {
    executorConfig = spec.executorConfig as GraphNode['executorConfig'];
  } else {
    const nextRole = typeof spec.role === 'string' ? spec.role : undefined;
    const nextInstructions = typeof spec.instructions === 'string' ? spec.instructions : nextRole;
    if (nextType === 'gmi' && nextInstructions) {
      executorConfig = {
        type: 'gmi',
        ...(existing.executorConfig.type === 'gmi' ? existing.executorConfig : {}),
        instructions: nextInstructions,
      };
    } else if (nextType === 'tool') {
      const existingArgs = existing.executorConfig.type === 'tool' ? existing.executorConfig.args : undefined;
      executorConfig = {
        type: 'tool',
        toolName: String(
          spec.toolName
          ?? (existing.executorConfig.type === 'tool' ? existing.executorConfig.toolName : existing.id),
        ),
        ...(isRecord(spec.args)
          ? { args: spec.args }
          : existingArgs
            ? { args: existingArgs }
            : {}),
      };
    } else if (nextType === 'human' && nextInstructions) {
      executorConfig = { type: 'human', prompt: nextInstructions };
    } else if (nextType !== existing.type) {
      executorConfig = buildExecutorConfig({ ...spec, type: nextType }, existing.id);
    }
  }

  return {
    ...existing,
    type: nextType,
    executorConfig,
    executionMode: (spec.executionMode as GraphNode['executionMode']) ?? existing.executionMode,
    effectClass: (spec.effectClass as GraphNode['effectClass']) ?? existing.effectClass,
    checkpoint:
      spec.checkpoint === true
        ? 'after'
        : spec.checkpoint === false
          ? 'none'
          : (spec.checkpoint as GraphNode['checkpoint'] | undefined) ?? existing.checkpoint,
    complexity:
      clampComplexity(spec.complexity as number | undefined)
      ?? existing.complexity,
    ...(nextType === 'gmi'
      ? isRecord(spec.llm)
        ? { llm: spec.llm as unknown as NodeLlmConfig }
        : existing.llm
          ? { llm: existing.llm }
          : {}
      : {}),
    ...('timeout' in spec && typeof spec.timeout === 'number' ? { timeout: spec.timeout } : {}),
  };
}

function buildReassignRolePatch(
  spec: Record<string, unknown>,
  graph: CompiledExecutionGraph,
  reason: string,
): MissionGraphPatch | null {
  const nodeId = resolveTargetNodeId(spec);
  if (!nodeId) return null;

  const existing = graph.nodes.find((node) => node.id === nodeId);
  if (!existing) return null;

  const replacementNode = buildReassignedNode(existing, spec);
  const incomingEdges = graph.edges.filter((edge) => edge.target === nodeId);
  const outgoingEdges = graph.edges.filter((edge) => edge.source === nodeId);
  const addEdges = dedupeEdges([
    ...incomingEdges.map((edge) => cloneEdge(edge, { target: nodeId }, 'reassign_in')),
    ...outgoingEdges.map((edge) => cloneEdge(edge, { source: nodeId }, 'reassign_out')),
  ]);

  return {
    addNodes: [replacementNode],
    addEdges,
    removeNodes: [nodeId],
    rewireEdges: [],
    reason,
    estimatedCostDelta:
      typeof spec.estimatedCostDelta === 'number' && Number.isFinite(spec.estimatedCostDelta)
        ? spec.estimatedCostDelta
        : 0.1,
    estimatedLatencyDelta:
      typeof spec.estimatedLatencyDelta === 'number' && Number.isFinite(spec.estimatedLatencyDelta)
        ? spec.estimatedLatencyDelta
        : 0,
  };
}

function buildAddToolPatch(
  spec: Record<string, unknown>,
  graph: CompiledExecutionGraph,
  requesterNodeId: string,
  reason: string,
): MissionGraphPatch | null {
  const sourceNodeId = resolveSourceNodeId(spec, requesterNodeId);
  const toolName = typeof spec.toolName === 'string' && spec.toolName.trim()
    ? spec.toolName.trim()
    : typeof spec.name === 'string' && spec.name.trim()
      ? spec.name.trim()
      : '';
  if (!toolName && !isRecord(spec.executorConfig)) return null;

  const nodeId =
    typeof spec.nodeId === 'string' && spec.nodeId.trim()
      ? spec.nodeId.trim()
      : slugify(toolName || 'tool_step');
  const newNode = normalizeNode({
    ...spec,
    id: nodeId,
    type: 'tool',
    executorConfig: isRecord(spec.executorConfig)
      ? spec.executorConfig
      : {
          type: 'tool',
          toolName,
          ...(isRecord(spec.args) ? { args: spec.args } : {}),
        },
    executionMode: spec.executionMode ?? 'single_turn',
    effectClass: spec.effectClass ?? 'read',
    checkpoint: spec.checkpoint ?? 'after',
  });

  return buildInlineInsertionPatch(newNode, graph, sourceNodeId, reason, {
    cost:
      typeof spec.estimatedCostDelta === 'number' && Number.isFinite(spec.estimatedCostDelta)
        ? spec.estimatedCostDelta
        : 0.15,
    latencyMs:
      typeof spec.estimatedLatencyDelta === 'number' && Number.isFinite(spec.estimatedLatencyDelta)
        ? spec.estimatedLatencyDelta
        : 5_000,
  });
}

function buildForkBranchPatch(
  spec: Record<string, unknown>,
  graph: CompiledExecutionGraph,
  requesterNodeId: string,
  reason: string,
): MissionGraphPatch | null {
  const sourceNodeId = resolveSourceNodeId(spec, requesterNodeId);
  const branchNodes = Array.isArray(spec.nodes)
    ? spec.nodes.filter(isRecord).map((node) => normalizeNode(node))
    : [];

  if (branchNodes.length === 0) {
    const role = String(spec.role ?? spec.nodeId ?? spec.name ?? 'branch_worker');
    const branchNodeId =
      typeof spec.nodeId === 'string' && spec.nodeId.trim()
        ? spec.nodeId.trim()
        : slugify(role);
    branchNodes.push(
      normalizeNode({
        ...spec,
        id: branchNodeId,
        type: spec.type ?? 'gmi',
        executorConfig: isRecord(spec.executorConfig)
          ? spec.executorConfig
          : buildExecutorConfig({
              ...spec,
              type: spec.type ?? 'gmi',
              instructions: spec.instructions ?? `Handle ${role}`,
            }, branchNodeId),
        executionMode: spec.executionMode ?? 'single_turn',
        effectClass: spec.effectClass ?? 'read',
        checkpoint: spec.checkpoint ?? 'after',
        complexity: spec.complexity,
      }),
    );
  }

  if (branchNodes.length === 0) return null;

  const explicitJoinTargets = Array.isArray(spec.joinTargets)
    ? spec.joinTargets.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const joinTarget = typeof spec.joinTarget === 'string' && spec.joinTarget.trim()
    ? spec.joinTarget.trim()
    : typeof spec.joinTargetId === 'string' && spec.joinTargetId.trim()
      ? spec.joinTargetId.trim()
      : '';
  const sourceStaticTargets = graph.edges
    .filter((edge) => edge.source === sourceNodeId && edge.type === 'static')
    .map((edge) => edge.target);
  const joinTargets = explicitJoinTargets.length > 0
    ? explicitJoinTargets
    : joinTarget
      ? [joinTarget]
      : sourceStaticTargets.length > 0
        ? sourceStaticTargets
        : [END];

  const addEdges: GraphEdge[] = [
    {
      id: `expansion_edge_${sourceNodeId}_${branchNodes[0]!.id}`,
      source: sourceNodeId,
      target: branchNodes[0]!.id,
      type: 'static',
    },
  ];

  for (let index = 0; index < branchNodes.length - 1; index++) {
    addEdges.push({
      id: `expansion_edge_${branchNodes[index]!.id}_${branchNodes[index + 1]!.id}`,
      source: branchNodes[index]!.id,
      target: branchNodes[index + 1]!.id,
      type: 'static',
    });
  }

  const lastNodeId = branchNodes[branchNodes.length - 1]!.id;
  for (const target of joinTargets) {
    addEdges.push({
      id: `expansion_edge_${lastNodeId}_${target.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      source: lastNodeId,
      target,
      type: 'static',
    });
  }

  return {
    addNodes: branchNodes,
    addEdges: dedupeEdges(addEdges),
    removeNodes: [],
    rewireEdges: [],
    reason,
    estimatedCostDelta:
      typeof spec.estimatedCostDelta === 'number' && Number.isFinite(spec.estimatedCostDelta)
        ? spec.estimatedCostDelta
        : 0.35 * branchNodes.length,
    estimatedLatencyDelta:
      typeof spec.estimatedLatencyDelta === 'number' && Number.isFinite(spec.estimatedLatencyDelta)
        ? spec.estimatedLatencyDelta
        : 20_000 * branchNodes.length,
  };
}

function buildManageGraphPatch(
  request: GraphExpansionRequest,
  graph: CompiledExecutionGraph,
  requesterNodeId: string,
): MissionGraphPatch | null {
  if (!isRecord(request.request)) return null;

  const action = typeof request.request.action === 'string' ? request.request.action : '';
  const spec = isRecord(request.request.spec) ? request.request.spec : {};
  const reason = typeof request.request.reason === 'string' ? request.request.reason : request.reason;

  if (isRecord(spec.patch)) {
    return normalizeGraphPatch(spec.patch);
  }

  if (action === 'spawn_agent') {
    return buildSpawnAgentPatch(spec, graph, requesterNodeId, reason);
  }

  if (action === 'remove_agent') {
    return buildRemoveAgentPatch(spec, graph, reason);
  }

  if (action === 'reassign_role') {
    return buildReassignRolePatch(spec, graph, reason);
  }

  if (action === 'add_tool') {
    return buildAddToolPatch(spec, graph, requesterNodeId, reason);
  }

  if (action === 'fork_branch') {
    return buildForkBranchPatch(spec, graph, requesterNodeId, reason);
  }

  return null;
}

export interface CreateMissionExpansionHandlerOptions {
  autonomy: AutonomyMode;
  thresholds: GuardrailThresholds;
  llmCaller: (system: string, user: string) => Promise<string>;
  costCap: number;
  maxAgents: number;
  availableTools?: Array<{ name: string; description: string }>;
  availableProviders?: string[];
  providerStrategy?: ProviderStrategyConfig;
  defaultLlm?: NodeLlmConfig;
  initialEstimatedCost?: number;
}

export function createMissionExpansionHandler(
  options: CreateMissionExpansionHandlerOptions,
): GraphExpansionHandler {
  const expander = new GraphExpander(options.thresholds);
  const expansionPrompt = loadPrompt('expansion');
  const availableTools = options.availableTools ?? [];
  const availableProviders = options.availableProviders ?? [];
  const providerStrategy = options.providerStrategy ?? { strategy: 'balanced' };

  let currentEstimatedCost = options.initialEstimatedCost ?? 0;
  let currentExpansions = 0;
  let currentToolForges = 0;

  const assignProviders = (patch: MissionGraphPatch): MissionGraphPatch => {
    const nodes = [...patch.addNodes];
    const gmiNodes = nodes.filter((node) => node.type === 'gmi' && !node.llm);

    if (gmiNodes.length > 0 && availableProviders.length > 0) {
      try {
        const assignments = new ProviderAssignmentEngine(availableProviders).assign(
          gmiNodes.map((node) => ({
            ...node,
            complexity: estimateComplexity(node),
          })),
          providerStrategy,
        );

        for (const assignment of assignments) {
          const index = nodes.findIndex((node) => node.id === assignment.nodeId);
          if (index === -1) continue;
          nodes[index] = {
            ...nodes[index]!,
            llm: {
              providerId: assignment.provider,
              model: assignment.model,
              reason: assignment.reason,
            },
          };
        }
      } catch {
        // Fall back to the default execution model below.
      }
    }

    if (options.defaultLlm) {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]!;
        if (node.type !== 'gmi' || node.llm) continue;
        nodes[index] = {
          ...node,
          llm: {
            providerId: options.defaultLlm.providerId,
            model: options.defaultLlm.model,
            reason: 'default mission expansion model',
          },
        };
      }
    }

    return {
      ...patch,
      addNodes: nodes,
    };
  };

  const generatePatch = async (
    request: GraphExpansionRequest,
    graph: CompiledExecutionGraph,
    requesterNodeId: string,
    nodeResults: Record<string, { output: unknown; durationMs: number }>,
  ): Promise<MissionGraphPatch | null> => {
    if (request.patch) {
      return normalizeGraphPatch(request.patch);
    }

    if (request.trigger === 'supervisor_manage') {
      return buildManageGraphPatch(request, graph, requesterNodeId);
    }

    const toolList =
      availableTools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n') || 'No tools available';
    const completedNodesJson = JSON.stringify(
      Object.entries(nodeResults).map(([nodeId, value]) => ({
        nodeId,
        durationMs: value.durationMs,
        output: value.output,
      })),
      null,
      2,
    );
    const graphStateJson = JSON.stringify(
      {
        graph: {
          id: graph.id,
          nodes: graph.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            executionMode: node.executionMode,
          })),
          edges: graph.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            type: edge.type,
          })),
        },
        requesterNodeId,
      },
      null,
      2,
    );

    const prompt = fillPrompt(expansionPrompt, {
      GRAPH_STATE_JSON: graphStateJson,
      COMPLETED_NODES_JSON: completedNodesJson,
      EXPANSION_REQUEST: JSON.stringify(request.request, null, 2),
      TOOL_LIST: toolList,
      COST_SPENT: currentEstimatedCost.toFixed(2),
      COST_CAP: options.costCap.toFixed(2),
      REMAINING_BUDGET: Math.max(0, options.costCap - currentEstimatedCost).toFixed(2),
      AGENT_COUNT: String(graph.nodes.length),
      MAX_AGENTS: String(options.maxAgents),
    });

    const response = await options.llmCaller(
      'You are evaluating a mission graph expansion. Respond with JSON only.',
      prompt,
    );
    const parsed = extractJson<{
      shouldExpand?: boolean;
      reason?: string;
      patch?: MissionGraphPatch | null;
    }>(response);

    if (!parsed.shouldExpand || !parsed.patch) return null;

    const patch = normalizeGraphPatch(parsed.patch);
    return {
      ...patch,
      reason: parsed.reason ?? patch.reason ?? request.reason,
    };
  };

  return {
    handle: async (context) => {
      const patch = await generatePatch(
        context.request,
        context.graph,
        context.nodeId,
        context.nodeResults,
      );

      if (!patch) {
        return null;
      }

      const assignedPatch = assignProviders(patch);
      const currentDepth = computeGraphDepth(context.graph);
      const previewGraph = expander.applyPatch(context.graph, assignedPatch);
      const nextDepth = computeGraphDepth(previewGraph);
      const patchToolForgeDelta = assignedPatch.addNodes.filter(isToolLikeNode).length;
      const patchDepthDelta = Math.max(0, nextDepth - currentDepth);
      const patchAgentDelta =
        assignedPatch.addNodes.length - (assignedPatch.removeNodes?.length ?? 0);
      const state = {
        currentCost: currentEstimatedCost,
        currentAgentCount: context.graph.nodes.length,
        currentExpansions,
        currentToolForges,
        currentDepth,
        patchCostDelta: assignedPatch.estimatedCostDelta,
        patchAgentDelta,
        patchToolForgeDelta,
        patchDepthDelta,
      };

      const events: GraphEvent[] = [
        {
          type: 'mission:expansion_proposed',
          patch: assignedPatch,
          trigger: context.request.trigger,
          reason: assignedPatch.reason,
        },
      ];

      const autoApproved = expander.shouldAutoApprove(options.autonomy, state);
      if (!autoApproved) {
        const exceeded = expander.getExceededThreshold(state);
        if (exceeded) {
          events.push({
            type: 'mission:threshold_reached',
            threshold: exceeded.threshold,
            value: exceeded.value,
            cap: exceeded.cap,
          });
        }
        events.push({
          type: 'mission:approval_required',
          action: 'apply_graph_patch',
          details: {
            trigger: context.request.trigger,
            reason: assignedPatch.reason,
            requesterNodeId: context.nodeId,
          },
        });
        return { events };
      }

      const nextGraph = previewGraph;
      currentEstimatedCost += assignedPatch.estimatedCostDelta;
      currentExpansions += 1;
      currentToolForges += patchToolForgeDelta;

      events.push({ type: 'mission:expansion_approved', by: 'auto' });
      events.push({
        type: 'mission:expansion_applied',
        nodesAdded: assignedPatch.addNodes.length,
        edgesAdded: assignedPatch.addEdges.length,
      });

      for (const node of assignedPatch.addNodes) {
        const llm = node.llm ?? options.defaultLlm;
        events.push({
          type: 'mission:agent_spawned',
          agentId: node.id,
          role: describeRole(node),
          provider: llm?.providerId ?? 'unknown',
          model: llm?.model ?? 'unknown',
        });
      }

      for (const rewire of assignedPatch.rewireEdges ?? []) {
        const sourceEdge = context.graph.edges.find(
          (edge) => edge.source === rewire.from && edge.target === rewire.to,
        );
        events.push({
          type: 'edge_transition',
          sourceId: rewire.from,
          targetId: rewire.newTarget,
          edgeType: sourceEdge?.type ?? 'default',
        });
      }

      for (const edge of assignedPatch.addEdges) {
        if (edge.source === START || edge.target === END) continue;
        events.push({
          type: 'edge_transition',
          sourceId: edge.source,
          targetId: edge.target,
          edgeType: edge.type === 'conditional' ? 'conditional' : 'default',
        });
      }

      return {
        graph: nextGraph,
        events,
      };
    },
  };
}
