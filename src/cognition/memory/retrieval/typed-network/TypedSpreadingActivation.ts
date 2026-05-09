/**
 * @file TypedSpreadingActivation.ts
 * @description Spreading activation across the typed-network graph
 * per Hindsight Equation 12 (§2.4.1):
 *
 *   A(fj, t+1) = max[(fi,fj,w,ℓ)∈E] [A(fi,t) · w · δ · μ(ℓ)]
 *
 * Where:
 * - `δ ∈ (0, 1)` — decay factor per hop
 * - `μ(ℓ)` — link-type multiplier (one of: temporal, semantic,
 *   entity, causal)
 * - `A(fi,t)` — activation of node fi at hop t
 * - `w` — edge weight
 *
 * The implementation is a bounded BFS with the max-aggregator over
 * incoming edges (per the `max[...]` in Eq. 12) and an early-exit
 * when no node's activation exceeds the threshold. Default depth=3
 * matches the existing untyped {@link SpreadingActivation} primitive
 * in agentos.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/TypedSpreadingActivation
 */

import type { TypedNetworkStore } from './TypedNetworkStore.js';
import type { EdgeKind } from './types.js';

/**
 * Per-edge-kind activation multipliers `μ(ℓ)` from Hindsight §2.4.1.
 * - **entity**: 1.0 (the strongest link, bidirectional shared-entity)
 * - **causal**: 1.0 (LLM-extracted reasoning chain — high signal)
 * - **temporal**: 0.7 (loose proximity in time)
 * - **semantic**: 0.6 (cosine ≥ θs threshold; treat as supporting,
 *   not primary, since the embedding path also runs separately at
 *   the four-way RRF fusion)
 *
 * These default values are tunable per-deployment; pass an override
 * map via {@link TypedSpreadingActivationOptions.edgeMultipliers}.
 */
export const DEFAULT_EDGE_MULTIPLIERS: Record<EdgeKind, number> = {
  entity: 1.0,
  causal: 1.0,
  temporal: 0.7,
  semantic: 0.6,
};

/**
 * Construction options for spreading activation.
 */
export interface TypedSpreadingActivationOptions {
  /** Per-hop decay factor δ ∈ (0, 1). Default 0.5. */
  decay: number;
  /** Override the default {@link DEFAULT_EDGE_MULTIPLIERS}. */
  edgeMultipliers?: Record<EdgeKind, number>;
}

/**
 * Per-call options.
 */
export interface SpreadOptions {
  /** Maximum hops from a seed node. Default cap on graph traversal. */
  maxDepth: number;
  /** Activation cutoff. Nodes below this threshold are not propagated. */
  activationThreshold?: number;
}

/**
 * Spreading-activation primitive over a typed network. Constructed
 * once per pipeline; safe to share across queries (all per-call state
 * lives in the local activation map).
 */
export class TypedSpreadingActivation {
  private readonly decay: number;
  private readonly μ: Record<EdgeKind, number>;

  constructor(options: TypedSpreadingActivationOptions) {
    this.decay = options.decay;
    this.μ = options.edgeMultipliers ?? DEFAULT_EDGE_MULTIPLIERS;
  }

  /**
   * Run spreading activation from a set of seed fact IDs. Returns a
   * map from fact ID to activation level, including the seeds (at
   * activation 1.0) and every reachable fact above the threshold.
   *
   * Uses Eq. 12's max-aggregation: each step computes the candidate
   * activation `current · weight · δ · μ(kind)` for every outgoing
   * edge, then keeps the max across paths into a node.
   *
   * @param store - The typed network to traverse.
   * @param seedIds - Initial seed fact IDs (activated at 1.0).
   * @param options - maxDepth + activationThreshold.
   */
  spread(
    store: TypedNetworkStore,
    seedIds: string[],
    options: SpreadOptions,
  ): Map<string, number> {
    const threshold = options.activationThreshold ?? 0.05;
    const activations = new Map<string, number>();
    for (const id of seedIds) activations.set(id, 1.0);

    let frontier = new Set<string>(seedIds);
    for (let depth = 0; depth < options.maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      let updated = false;

      for (const factId of frontier) {
        const currentAct = activations.get(factId);
        if (currentAct === undefined) continue;

        for (const edge of store.getEdges(factId)) {
          const candidate =
            currentAct * edge.weight * this.decay * this.μ[edge.kind];
          if (candidate < threshold) continue;
          // Eq. 12: max-aggregate over incoming edges.
          const existing = activations.get(edge.toFactId) ?? 0;
          if (candidate > existing) {
            activations.set(edge.toFactId, candidate);
            nextFrontier.add(edge.toFactId);
            updated = true;
          }
        }
      }

      if (!updated) break;
      frontier = nextFrontier;
    }

    return activations;
  }
}
