/**
 * @file index.ts
 * @description Barrel exports for the Hindsight 4-network typed
 * observer module. The new agentos primitive for typed graph
 * traversal at retrieval time. Imported by the bench wiring and by
 * any consumer building a Hindsight-style memory pipeline.
 *
 * @module @framers/agentos/memory/retrieval/typed-network
 */

export {
  BANK_IDS,
  EDGE_KINDS,
  isBankId,
  type BankId,
  type EdgeKind,
  type TypedFact,
  type TypedEdge,
  type FactTemporal,
  type Participant,
} from './types.js';

export { TypedNetworkStore } from './TypedNetworkStore.js';

export { rankByTemporalOverlap } from './TemporalIntervalOverlap.js';

export {
  TypedNetworkObserver,
  type ITypedExtractionLLM,
  type TypedNetworkObserverOptions,
} from './TypedNetworkObserver.js';

export {
  TYPED_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from './prompts/extraction-prompt.js';

export {
  TypedExtractionSchema,
  TypedExtractionFactSchema,
  type TypedExtractionOutput,
  type TypedExtractionFact,
} from './prompts/extraction-schema.js';

export {
  TypedSpreadingActivation,
  DEFAULT_EDGE_MULTIPLIERS,
  type TypedSpreadingActivationOptions,
  type SpreadOptions,
} from './TypedSpreadingActivation.js';

export {
  fourWayRrf,
  type FourWayRrfInput,
  type FourWayRrfOptions,
} from './FourWayRrf.js';
