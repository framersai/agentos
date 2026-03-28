/**
 * @file types.ts
 * @description Types for the self-expanding mission orchestrator.
 *
 * Covers: autonomy modes, provider assignment strategies, Tree of Thought
 * planning primitives, dynamic graph expansion (GraphPatch), guardrail
 * thresholds, and mission-specific event types.
 */

import type { GraphNode, GraphEdge, CompiledExecutionGraph } from '../ir/types.js';
import type {
  GraphEvent,
  MissionEvalScores,
  MissionGraphPatch,
  MissionExpansionTrigger,
} from '../events/GraphEvent.js';

// ---------------------------------------------------------------------------
// Autonomy
// ---------------------------------------------------------------------------

/** Controls how much human approval is required during mission execution. */
export type AutonomyMode = 'autonomous' | 'guided' | 'guardrailed';

/** Configurable thresholds for guardrailed autonomy mode. */
export interface GuardrailThresholds {
  /** Maximum total spend in USD before pausing. */
  maxTotalCost: number;
  /** Maximum concurrent agent count. */
  maxAgentCount: number;
  /** Maximum emergent tool forge operations. */
  maxToolForges: number;
  /** Maximum graph expansion operations. */
  maxExpansions: number;
  /** Maximum sub-mission nesting depth. */
  maxDepth: number;
  /** Maximum cost per single expansion operation. */
  costPerExpansionCap: number;
}

/** Sensible defaults — hit any of these and execution pauses. */
export const DEFAULT_THRESHOLDS: Readonly<GuardrailThresholds> = {
  maxTotalCost: 10.0,
  maxAgentCount: 10,
  maxToolForges: 5,
  maxExpansions: 8,
  maxDepth: 3,
  costPerExpansionCap: 2.0,
};

// ---------------------------------------------------------------------------
// Provider Assignment
// ---------------------------------------------------------------------------

/** Strategy name for provider-to-node assignment. */
export type ProviderStrategyName =
  | 'best'
  | 'cheapest'
  | 'balanced'
  | 'explicit'
  | 'mixed';

/** Explicit provider+model override for a specific node or role. */
export interface ExplicitAssignment {
  provider: string;
  model?: string;
}

/** Full provider strategy configuration. */
export interface ProviderStrategyConfig {
  strategy: ProviderStrategyName;
  /** Map of nodeId/role → explicit provider assignment. `_default` applies to unmatched nodes. */
  assignments?: Record<string, ExplicitAssignment>;
  /** Fallback strategy for unmatched nodes in `mixed` mode. */
  fallback?: ProviderStrategyName;
}

/** Result of assigning a provider+model to a single node. */
export interface NodeProviderAssignment {
  nodeId: string;
  provider: string;
  model: string;
  /** Complexity score (0-1) used for balanced assignment. */
  complexity: number;
  /** Human-readable reason for this assignment. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Tree of Thought Planning
// ---------------------------------------------------------------------------

/** Evaluation scores for a candidate branch (all 0-1). */
export type EvalScores = MissionEvalScores;

/** A single candidate decomposition from Phase 1. */
export interface CandidateBranch {
  branchId: string;
  strategy: string;
  summary: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  providerAssignments: NodeProviderAssignment[];
  estimatedCost: number;
  estimatedLatencyMs: number;
  scores: EvalScores;
}

/** Configuration for the MissionPlanner. */
export interface PlannerConfig {
  /** Number of Tree of Thought branches to explore. */
  branchCount: number;
  autonomy: AutonomyMode;
  providerStrategy: ProviderStrategyConfig;
  thresholds: GuardrailThresholds;
  costCap: number;
  maxAgents: number;
  maxToolForges: number;
  maxExpansions: number;
  maxDepth: number;
  /** Re-evaluate graph every N completed nodes. */
  reevalInterval: number;

  /**
   * LLM caller used by agent nodes during execution.
   * Falls back to `plannerLlmCaller` if not provided separately.
   */
  llmCaller: (system: string, user: string) => Promise<string>;

  /**
   * LLM caller used specifically for the Tree of Thought planning phases
   * (decomposition, evaluation, refinement, expansion).
   *
   * Use a stronger model here (e.g., Opus 4.6) for better plan quality,
   * while execution agents can use a different model (e.g., GPT-5.4).
   *
   * Defaults to `llmCaller` if not provided.
   */
  plannerLlmCaller?: (system: string, user: string) => Promise<string>;

  /** Human-readable label for the planner model (for logging/events). */
  plannerModel?: string;
  /** Human-readable label for the default execution model (for logging/events). */
  executionModel?: string;
}

/** Result of the full planning pipeline. */
export interface PlanResult {
  selectedBranch: CandidateBranch;
  allBranches: CandidateBranch[];
  refinements: string[];
  compiledGraph: CompiledExecutionGraph;
}

// ---------------------------------------------------------------------------
// Graph Expansion
// ---------------------------------------------------------------------------

/** Atomic modification to a running graph. Applied between node executions. */
export type GraphPatch = MissionGraphPatch;

/** What triggered the expansion. */
export type ExpansionTrigger = MissionExpansionTrigger;

/** Record of an applied expansion for audit trail. */
export interface ExpansionRecord {
  patch: GraphPatch;
  trigger: ExpansionTrigger;
  approvedBy: 'auto' | 'user';
  timestamp: number;
  checkpointIdBefore: string;
}

// ---------------------------------------------------------------------------
// Mission Events
// ---------------------------------------------------------------------------

/** All events emitted during mission execution. */
export type MissionEvent = GraphEvent;

// ---------------------------------------------------------------------------
// Extended Mission Config
// ---------------------------------------------------------------------------

/** Configuration produced by the extended MissionBuilder chain methods. */
export interface ExtendedMissionConfig {
  goal: string;
  inputSchema?: unknown;
  returnsSchema?: unknown;
  autonomy: AutonomyMode;
  providerStrategy: ProviderStrategyConfig;
  thresholds: GuardrailThresholds;
  costCap: number;
  maxAgents: number;
  branchCount: number;
}
