/**
 * @file backends/index.ts
 * @description Sub-barrel for MemoryRouter recall-side backends. The
 * top-level `@framers/agentos/memory-router` barrel re-exports these
 * symbols so consumers can write
 * `import { EntityRetrievalRanker } from '@framers/agentos/memory-router'`.
 *
 * Reference recall-stage components ship in agentos core so the
 * memory-router strategy IDs work out of the box.
 */

export { EntityRetrievalRanker } from './EntityRetrievalRanker.js';
export type {
  RankedCandidate,
  RankedCandidateWithBoost,
  EntityRetrievalRankerOptions,
} from './EntityRetrievalRanker.js';

import { EntityRetrievalRanker } from './EntityRetrievalRanker.js';
import type { EntityRetrievalRankerOptions } from './EntityRetrievalRanker.js';

export function createEntityRetrievalRanker(
  opts: EntityRetrievalRankerOptions,
): EntityRetrievalRanker {
  return new EntityRetrievalRanker(opts);
}
