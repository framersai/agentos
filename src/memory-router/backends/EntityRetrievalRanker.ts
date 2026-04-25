/**
 * @file EntityRetrievalRanker.ts
 * @description Mem0-v3-style recall-stage re-ranker. Adds an
 * entity-overlap signal to the existing semantic-similarity score:
 *
 *   combinedScore = (1 - entityWeight) * semanticScore
 *                 + entityWeight * (overlap / queryEntityCount)
 *
 * Returns candidates sorted descending by combinedScore. The original
 * fields (id, text, semanticScore, entities) are preserved alongside
 * the new combinedScore + entityOverlap.
 *
 * The query's entities are extracted via {@link EntityExtractor} so
 * this ranker is end-to-end self-contained: pass a query string and
 * candidate list, get a re-ranked list back.
 *
 * Reference: docs.mem0.ai/migration/oss-v2-to-v3.
 *
 * @module @framers/agentos/memory-router/backends/EntityRetrievalRanker
 */

import { EntityExtractor } from '../../ingest-router/executors/EntityExtractor.js';

/**
 * One candidate to be ranked. The bench (or any consumer) passes a
 * list of these from its hybrid retrieval pool.
 */
export interface RankedCandidate {
  id: string;
  text: string;
  /** Pre-computed semantic similarity (cosine, BM25, or a blend). */
  semanticScore: number;
  /** Entities extracted at ingest, indexed alongside the chunk. */
  entities: string[];
}

/**
 * Re-ranked candidate with the combined score + per-candidate
 * entity-overlap count for diagnostics.
 */
export interface RankedCandidateWithBoost extends RankedCandidate {
  combinedScore: number;
  entityOverlap: number;
}

export interface EntityRetrievalRankerOptions {
  /**
   * Weight on the entity-overlap signal in the combined score.
   * 0 = pure semantic. 1 = pure entity overlap. Mem0-v3 default ~0.5.
   */
  entityWeight: number;
}

export class EntityRetrievalRanker {
  private readonly entityWeight: number;
  private readonly extractor = new EntityExtractor();

  constructor(opts: EntityRetrievalRankerOptions) {
    this.entityWeight = opts.entityWeight;
  }

  rank(query: string, candidates: RankedCandidate[]): RankedCandidateWithBoost[] {
    const queryEntities = new Set(this.extractor.extract(query).entities.map((e) => e.text));
    const queryEntityCount = queryEntities.size;

    const scored = candidates.map<RankedCandidateWithBoost>((c) => {
      const overlap = c.entities.filter((e) => queryEntities.has(e)).length;
      const overlapRatio = queryEntityCount > 0 ? overlap / queryEntityCount : 0;
      const combinedScore =
        (1 - this.entityWeight) * c.semanticScore + this.entityWeight * overlapRatio;
      return { ...c, combinedScore, entityOverlap: overlap };
    });

    return scored.sort((a, b) => b.combinedScore - a.combinedScore);
  }
}
