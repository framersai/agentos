/**
 * Barrel exports for cognitive mechanisms module.
 * @module agentos/memory/mechanisms
 */

// --- Types ---
export type {
  CognitiveMechanismsConfig,
  ResolvedMechanismsConfig,
  MetacognitiveSignal,
  MechanismMetadata,
  DriftEvent,
  ReconsolidationConfig,
  RetrievalInducedForgettingConfig,
  InvoluntaryRecallConfig,
  MetacognitiveFOKConfig,
  TemporalGistConfig,
  SchemaEncodingConfig,
  SourceConfidenceDecayConfig,
  EmotionRegulationConfig,
  ResolvedReconsolidationConfig,
  ResolvedRIFConfig,
  ResolvedInvoluntaryRecallConfig,
  ResolvedMetacognitiveFOKConfig,
  ResolvedTemporalGistConfig,
  ResolvedSchemaEncodingConfig,
  ResolvedSourceConfidenceDecayConfig,
  ResolvedEmotionRegulationConfig,
} from './types.js';

// --- Defaults ---
export { DEFAULT_MECHANISMS_CONFIG, resolveConfig } from './defaults.js';

// --- Engine ---
export { CognitiveMechanismsEngine } from './CognitiveMechanismsEngine.js';

// --- Retrieval mechanisms ---
export { applyReconsolidation } from './retrieval/Reconsolidation.js';
export { applyRetrievalInducedForgetting } from './retrieval/RetrievalInducedForgetting.js';
export { selectInvoluntaryMemory } from './retrieval/InvoluntaryRecall.js';
export { detectFeelingOfKnowing } from './retrieval/MetacognitiveFOK.js';

// --- Consolidation mechanisms ---
export { applyTemporalGist } from './consolidation/TemporalGist.js';
export { applySchemaEncoding } from './consolidation/SchemaEncoding.js';
export type { SchemaEncodingResult } from './consolidation/SchemaEncoding.js';
export { applySourceConfidenceDecay } from './consolidation/SourceConfidenceDecay.js';
export { applyEmotionRegulation } from './consolidation/EmotionRegulation.js';
