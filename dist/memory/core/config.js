/**
 * @fileoverview Configuration types for the Cognitive Memory System.
 * @module agentos/memory/config
 */
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const DEFAULT_ENCODING_CONFIG = {
    baseStrength: 0.5,
    flashbulbThreshold: 0.8,
    flashbulbStrengthMultiplier: 2.0,
    flashbulbStabilityMultiplier: 5.0,
    baseStabilityMs: 3600000,
};
export const DEFAULT_DECAY_CONFIG = {
    pruningThreshold: 0.05,
    recencyHalfLifeMs: 86400000,
    interferenceThreshold: 0.7,
};
export const DEFAULT_BUDGET_ALLOCATION = {
    workingMemory: 0.15,
    semanticRecall: 0.40,
    recentEpisodic: 0.25,
    prospectiveAlerts: 0.05,
    graphAssociations: 0.05,
    observationNotes: 0.05,
    persistentMemory: 0.05,
};
//# sourceMappingURL=config.js.map