/**
 * @fileoverview Configuration types and defaults for the self-improving
 * agent system: personality mutation, skill management, workflow composition,
 * and self-evaluation.
 *
 * All sub-systems are opt-in and bounded by configurable limits to prevent
 * runaway self-modification. The {@link DEFAULT_SELF_IMPROVEMENT_CONFIG}
 * constant provides sensible defaults with self-improvement disabled.
 *
 * @module @framers/agentos/emergent/SelfImprovementConfig
 */
// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================
/**
 * Sensible defaults for self-improvement configuration.
 *
 * Self-improvement is **disabled** by default (`enabled: false`). When opted
 * in, all skills are available, workflows are bounded to 10 steps, and
 * personality mutations decay at 5% per consolidation cycle.
 */
export const DEFAULT_SELF_IMPROVEMENT_CONFIG = {
    enabled: false,
    personality: {
        maxDeltaPerSession: 0.15,
        persistWithDecay: true,
        decayRate: 0.05,
    },
    skills: {
        allowlist: ['*'],
        requireApprovalForNewCategories: true,
    },
    workflows: {
        maxSteps: 10,
        allowedTools: ['*'],
    },
    selfEval: {
        autoAdjust: true,
        adjustableParams: ['temperature', 'verbosity', 'personality'],
        maxEvaluationsPerSession: 10,
    },
};
//# sourceMappingURL=SelfImprovementConfig.js.map