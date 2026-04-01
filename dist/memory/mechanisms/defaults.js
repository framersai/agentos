/**
 * @fileoverview Default configuration constants and resolver for cognitive mechanisms.
 *
 * All mechanisms default to enabled with empirically-grounded constants.
 * The `resolveConfig()` function deep-merges partial user overrides with defaults.
 *
 * @module agentos/memory/mechanisms/defaults
 */
/** Full default config with all mechanisms enabled and sensible constants. */
export const DEFAULT_MECHANISMS_CONFIG = {
    reconsolidation: {
        enabled: true,
        driftRate: 0.05,
        maxDriftPerTrace: 0.4,
        immuneAboveImportance: 9,
    },
    retrievalInducedForgetting: {
        enabled: true,
        similarityThreshold: 0.7,
        suppressionFactor: 0.12,
        maxSuppressionsPerQuery: 5,
    },
    involuntaryRecall: {
        enabled: true,
        probability: 0.08,
        minAgeDays: 14,
        minStrength: 0.15,
    },
    metacognitiveFOK: {
        enabled: true,
        partialActivationThreshold: 0.3,
        surfaceTipOfTongue: true,
    },
    temporalGist: {
        enabled: true,
        ageThresholdDays: 60,
        minRetrievalCount: 2,
        preserveEntities: true,
        preserveEmotionalContext: true,
    },
    schemaEncoding: {
        enabled: true,
        clusterSimilarityThreshold: 0.75,
        noveltyBoost: 1.3,
        congruencyDiscount: 0.85,
    },
    sourceConfidenceDecay: {
        enabled: true,
        decayMultipliers: {
            user_statement: 1.0,
            tool_result: 1.0,
            observation: 0.95,
            external: 0.90,
            agent_inference: 0.80,
            reflection: 0.75,
        },
    },
    emotionRegulation: {
        enabled: true,
        reappraisalRate: 0.15,
        suppressionThreshold: 0.8,
        maxRegulationPerCycle: 10,
    },
};
/**
 * Deep-merge partial user config with defaults.
 *
 * Each mechanism's partial fields are spread over the default,
 * preserving any user overrides while filling in missing values.
 */
export function resolveConfig(partial) {
    const d = DEFAULT_MECHANISMS_CONFIG;
    return {
        reconsolidation: { ...d.reconsolidation, ...partial.reconsolidation },
        retrievalInducedForgetting: { ...d.retrievalInducedForgetting, ...partial.retrievalInducedForgetting },
        involuntaryRecall: { ...d.involuntaryRecall, ...partial.involuntaryRecall },
        metacognitiveFOK: { ...d.metacognitiveFOK, ...partial.metacognitiveFOK },
        temporalGist: { ...d.temporalGist, ...partial.temporalGist },
        schemaEncoding: { ...d.schemaEncoding, ...partial.schemaEncoding },
        sourceConfidenceDecay: {
            ...d.sourceConfidenceDecay,
            ...partial.sourceConfidenceDecay,
            decayMultipliers: {
                ...d.sourceConfidenceDecay.decayMultipliers,
                ...partial.sourceConfidenceDecay?.decayMultipliers,
            },
        },
        emotionRegulation: { ...d.emotionRegulation, ...partial.emotionRegulation },
    };
}
//# sourceMappingURL=defaults.js.map