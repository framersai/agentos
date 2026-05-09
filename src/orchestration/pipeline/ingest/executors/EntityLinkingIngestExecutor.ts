/**
 * @file EntityLinkingIngestExecutor.ts
 * @description Mem0-v3-style ingest executor for the IngestRouter
 * `fact-graph` strategy. Extracts entities from content (proper nouns,
 * quoted text, compound noun phrases) and surfaces them on the result
 * for downstream entity-overlap indexing at recall time.
 *
 * Unlike Mem0 v2 (which kept a separate Neo4j/Memgraph graph store),
 * v3 uses parallel entity columns + multi-signal hybrid search. This
 * executor captures the v3 pattern: regex-based extraction at ingest,
 * no LLM cost, entities flow alongside chunks for retrieval-time
 * re-ranking via {@link EntityRetrievalRanker}.
 *
 * Reference: docs.mem0.ai/migration/oss-v2-to-v3.
 *
 * @module @framers/agentos/ingest-router/executors/EntityLinkingIngestExecutor
 */

import { EntityExtractor } from './EntityExtractor.js';
import type { IngestPayload } from './SummarizedIngestExecutor.js';
import type { EntityLinkingOptions } from './entity-types.js';

/**
 * Outcome shape for the entity-linking executor.
 */
export interface EntityLinkingOutcome {
  writtenTraces: number;
  summary: string;
  embedTexts: string[];
  /** Distinct entities found across all chunks, deduplicated. */
  entities: string[];
  /** Entities found per chunk, in chunk order. */
  entitiesPerChunk: string[][];
  tokensIn: number;
  tokensOut: number;
}

/**
 * Reference executor for the IngestRouter `fact-graph` strategy.
 * Wires entity extraction at ingest; the bench (or any consumer)
 * indexes the entities alongside chunks for entity-overlap re-ranking.
 */
export class EntityLinkingIngestExecutor {
  /** Strategy ID expected by IngestRouter's FunctionIngestDispatcher registry. */
  readonly strategyId = 'fact-graph' as const;

  private readonly extractor: EntityExtractor;

  constructor(opts: EntityLinkingOptions = {}) {
    this.extractor = new EntityExtractor(opts);
  }

  async ingest(
    content: string,
    payload: IngestPayload,
  ): Promise<EntityLinkingOutcome> {
    const chunks = payload.chunks ?? [content];
    const entitiesPerChunk = chunks.map((chunk) =>
      this.extractor.extract(chunk).entities.map((e) => e.text),
    );
    const allEntities = Array.from(new Set(entitiesPerChunk.flat()));

    return {
      writtenTraces: chunks.length,
      summary: '',
      embedTexts: chunks,
      entities: allEntities,
      entitiesPerChunk,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
