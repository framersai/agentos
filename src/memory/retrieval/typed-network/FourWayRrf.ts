/**
 * @file FourWayRrf.ts
 * @description Four-way Reciprocal Rank Fusion over the typed-network
 * retrieval signals: semantic similarity, BM25 lexical match, graph
 * spreading activation, and temporal interval overlap. Per Hindsight
 * §2.4.3, the fusion uses standard RRF with `k=60`:
 *
 *   score(f) = Σ over rankings R of [1 / (k + rank_R(f))]
 *
 * Output is a single ranked list combining all four signals. Facts
 * present in only some rankings are still scored — RRF naturally
 * tolerates missing rankings because absent IDs contribute zero.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/FourWayRrf
 */

/**
 * Inputs to the fusion. Each list is an ordered array of fact IDs
 * from a separate retrieval signal.
 */
export interface FourWayRrfInput {
  /** Cosine-similarity ranking over fact embeddings. */
  semantic: string[];
  /** BM25 ranking over fact text. */
  bm25: string[];
  /** Spreading-activation ranking over the typed-network graph. */
  graphActivation: string[];
  /** Temporal-interval-overlap ranking against the query timestamp. */
  temporalOverlap: string[];
}

/**
 * Fusion options.
 */
export interface FourWayRrfOptions {
  /** RRF constant. Default 60 per the standard literature. */
  k?: number;
  /**
   * Optional per-signal weight multiplier. Defaults to {1, 1, 1, 1}
   * (uniform RRF). Use to emphasize one signal over others — e.g.
   * downweighting graph activation when the typed network is sparse.
   */
  weights?: Partial<Record<keyof FourWayRrfInput, number>>;
}

/**
 * Fuse four retrieval rankings via Reciprocal Rank Fusion. Returns
 * the merged list ordered by descending fused score.
 *
 * @param input - Four ranked lists (semantic, BM25, graph, temporal).
 * @param options - RRF k constant + optional per-signal weights.
 */
export function fourWayRrf(
  input: FourWayRrfInput,
  options: FourWayRrfOptions = {},
): string[] {
  const k = options.k ?? 60;
  const w = {
    semantic: options.weights?.semantic ?? 1,
    bm25: options.weights?.bm25 ?? 1,
    graphActivation: options.weights?.graphActivation ?? 1,
    temporalOverlap: options.weights?.temporalOverlap ?? 1,
  };

  const scores = new Map<string, number>();

  const accumulate = (
    ranking: string[],
    weight: number,
  ): void => {
    ranking.forEach((id, idx) => {
      const rank = idx + 1;
      const contribution = (1.0 / (k + rank)) * weight;
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    });
  };

  accumulate(input.semantic, w.semantic);
  accumulate(input.bm25, w.bm25);
  accumulate(input.graphActivation, w.graphActivation);
  accumulate(input.temporalOverlap, w.temporalOverlap);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
