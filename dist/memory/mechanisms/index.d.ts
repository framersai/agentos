/**
 * Barrel exports for cognitive mechanisms module.
 * @module agentos/memory/mechanisms
 */
export type { CognitiveMechanismsConfig, ResolvedMechanismsConfig, MetacognitiveSignal, MechanismMetadata, DriftEvent, ReconsolidationConfig, RetrievalInducedForgettingConfig, InvoluntaryRecallConfig, MetacognitiveFOKConfig, TemporalGistConfig, SchemaEncodingConfig, SourceConfidenceDecayConfig, EmotionRegulationConfig, ResolvedReconsolidationConfig, ResolvedRIFConfig, ResolvedInvoluntaryRecallConfig, ResolvedMetacognitiveFOKConfig, ResolvedTemporalGistConfig, ResolvedSchemaEncodingConfig, ResolvedSourceConfidenceDecayConfig, ResolvedEmotionRegulationConfig, } from './types.js';
export { DEFAULT_MECHANISMS_CONFIG, resolveConfig } from './defaults.js';
export { CognitiveMechanismsEngine } from './CognitiveMechanismsEngine.js';
export { applyReconsolidation } from './retrieval/Reconsolidation.js';
export { applyRetrievalInducedForgetting } from './retrieval/RetrievalInducedForgetting.js';
export { selectInvoluntaryMemory } from './retrieval/InvoluntaryRecall.js';
export { detectFeelingOfKnowing } from './retrieval/MetacognitiveFOK.js';
export { applyTemporalGist } from './consolidation/TemporalGist.js';
export { applySchemaEncoding } from './consolidation/SchemaEncoding.js';
export type { SchemaEncodingResult } from './consolidation/SchemaEncoding.js';
export { applySourceConfidenceDecay } from './consolidation/SourceConfidenceDecay.js';
export { applyEmotionRegulation } from './consolidation/EmotionRegulation.js';
//# sourceMappingURL=index.d.ts.map