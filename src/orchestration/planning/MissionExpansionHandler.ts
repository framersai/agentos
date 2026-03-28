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
  GraphEdge,
  GraphNode,
  NodeLlmConfig,
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
    executorConfig: (raw.executorConfig as GraphNode['executorConfig']) ?? {
      type: 'gmi',
      instructions: String(raw.instructions ?? raw.role ?? `Execute ${id}`),
    },
    executionMode: (raw.executionMode as GraphNode['executionMode']) ?? 'single_turn',
    effectClass: (raw.effectClass as GraphNode['effectClass']) ?? 'read',
    checkpoint,
    complexity: clampComplexity(raw.complexity as number | undefined),
    ...(isRecord(raw.llm) ? { llm: raw.llm as NodeLlmConfig } : {}),
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
      ? { guardrailPolicy: raw.guardrailPolicy as GraphEdge['guardrailPolicy'] }
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

  const newNode = normalizeNode({
    id: nodeId,
    type: spec.type ?? 'gmi',
    executorConfig:
      isRecord(spec.executorConfig)
        ? spec.executorConfig
        : {
            type: 'gmi',
            instructions,
          },
    executionMode: spec.executionMode ?? 'single_turn',
    effectClass: spec.effectClass ?? 'read',
    checkpoint: spec.checkpoint ?? 'after',
    complexity: spec.complexity,
  });

  const outEdges = graph.edges.filter((edge) => edge.source === requesterNodeId);
  const staticOutEdges = outEdges.filter((edge) => edge.type === 'static');
  const addEdges: GraphEdge[] = [];
  const rewireEdges: MissionGraphPatch['rewireEdges'] = [];

  addEdges.push({
    id: `expansion_edge_${requesterNodeId}_${nodeId}`,
    source: requesterNodeId,
    target: nodeId,
    type: 'static',
  });

  if (staticOutEdges.length > 0) {
    for (const edge of staticOutEdges) {
      rewireEdges.push({
        from: requesterNodeId,
        to: edge.target,
        newTarget: nodeId,
      });
      addEdges.push({
        id: `expansion_edge_${nodeId}_${edge.target}`,
        source: nodeId,
        target: edge.target,
        type: 'static',
      });
    }
  } else {
    addEdges.push({
      id: `expansion_edge_${nodeId}_end`,
      source: nodeId,
      target: END,
      type: 'static',
    });
  }

  return {
    addNodes: [newNode],
    addEdges,
    removeNodes: [],
    rewireEdges,
    reason,
    estimatedCostDelta:
      typeof spec.estimatedCostDelta === 'number' && Number.isFinite(spec.estimatedCostDelta)
        ? spec.estimatedCostDelta
        : 0.5,
    estimatedLatencyDelta:
      typeof spec.estimatedLatencyDelta === 'number' && Number.isFinite(spec.estimatedLatencyDelta)
        ? spec.estimatedLatencyDelta
        : 30_000,
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
    const nodeId = typeof spec.nodeId === 'string' ? spec.nodeId.trim() : '';
    if (!nodeId) return null;
    return {
      addNodes: [],
      addEdges: [],
      removeNodes: [nodeId],
      rewireEdges: [],
      reason,
      estimatedCostDelta: 0,
      estimatedLatencyDelta: 0,
    };
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
  let currentDepth = 0;

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
        patchToolForgeDelta: 0,
        patchDepthDelta: 0,
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

      const nextGraph = expander.applyPatch(context.graph, assignedPatch);
      currentEstimatedCost += assignedPatch.estimatedCostDelta;
      currentExpansions += 1;

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
