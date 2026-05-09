/**
 * @fileoverview Anderson's spreading activation algorithm.
 *
 * Pure function implementation decoupled from graph backend.
 * Used by both GraphologyMemoryGraph and KnowledgeGraphMemoryGraph.
 *
 * Algorithm:
 * 1. Seed nodes start at activation = 1.0
 * 2. Each hop: neighbor_activation = current · edge_weight · decayPerHop
 * 3. Multi-path summation (capped at 1.0)
 * 4. BFS with maxDepth and activationThreshold cutoffs
 * 5. Hebbian rule: co-retrieved memories strengthen edges (caller's responsibility)
 *
 * @module agentos/memory/graph/SpreadingActivation
 */

import type { SpreadingActivationConfig, ActivatedNode } from './IMemoryGraph.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpreadingActivationInput {
  seedIds: string[];
  /** Get neighbors with edge weights. Can be sync or async. */
  getNeighbors: (nodeId: string) => Array<{ id: string; weight: number }> | Promise<Array<{ id: string; weight: number }>>;
  config?: SpreadingActivationConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<SpreadingActivationConfig> = {
  maxDepth: 3,
  decayPerHop: 0.5,
  activationThreshold: 0.1,
  maxResults: 20,
};

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/**
 * Run spreading activation from seed nodes.
 *
 * Returns activated nodes sorted by activation level (descending),
 * excluding seed nodes themselves.
 */
export async function spreadActivation(input: SpreadingActivationInput): Promise<ActivatedNode[]> {
  const cfg = { ...DEFAULT_CONFIG, ...input.config };
  const { seedIds, getNeighbors } = input;

  // Activation map: nodeId → { activation, depth, activatedBy }
  const activationMap = new Map<string, { activation: number; depth: number; activatedBy: Set<string> }>();

  // Initialize seeds at full activation
  const seedSet = new Set(seedIds);
  for (const seedId of seedIds) {
    activationMap.set(seedId, { activation: 1.0, depth: 0, activatedBy: new Set([seedId]) });
  }

  // BFS wavefront
  let currentWave = [...seedIds];

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    const nextWave: string[] = [];
    const decayFactor = Math.pow(cfg.decayPerHop, depth);

    for (const nodeId of currentWave) {
      const nodeActivation = activationMap.get(nodeId)!.activation;
      const nodeActivatedBy = activationMap.get(nodeId)!.activatedBy;

      const neighbors = await getNeighbors(nodeId);

      for (const neighbor of neighbors) {
        // Compute activation contribution from this path
        const contribution = nodeActivation * neighbor.weight * cfg.decayPerHop;

        if (contribution < cfg.activationThreshold) continue;

        const existing = activationMap.get(neighbor.id);
        if (existing) {
          // Multi-path summation, capped at 1.0
          existing.activation = Math.min(1.0, existing.activation + contribution);
          for (const by of nodeActivatedBy) existing.activatedBy.add(by);
          // Keep the shallowest depth
          if (depth < existing.depth) existing.depth = depth;
        } else {
          activationMap.set(neighbor.id, {
            activation: Math.min(1.0, contribution),
            depth,
            activatedBy: new Set(nodeActivatedBy),
          });
          nextWave.push(neighbor.id);
        }
      }
    }

    currentWave = nextWave;
    if (currentWave.length === 0) break;
  }

  // Collect results (exclude seeds)
  const results: ActivatedNode[] = [];
  for (const [nodeId, data] of activationMap) {
    if (seedSet.has(nodeId)) continue;
    if (data.activation < cfg.activationThreshold) continue;

    results.push({
      memoryId: nodeId,
      activation: data.activation,
      depth: data.depth,
      activatedBy: Array.from(data.activatedBy),
    });
  }

  // Sort by activation descending, cap at maxResults
  results.sort((a, b) => b.activation - a.activation);
  return results.slice(0, cfg.maxResults);
}
