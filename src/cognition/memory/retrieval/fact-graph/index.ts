/**
 * @file index.ts
 * @description Barrel for the Step 9 fact-graph module.
 */

export { FactStore } from './FactStore.js';
export { FactExtractor } from './FactExtractor.js';
export type { FactExtractorOptions, FactExtractorSession } from './FactExtractor.js';
export type { Fact, FactStoreEntry } from './types.js';
export {
  canonicalizeSubject,
  hashSubject,
  hashPredicate,
  isValidPredicate,
  PREDICATE_SCHEMA,
} from './canonicalization.js';
