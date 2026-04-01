/**
 * @file PersonaValidation.ts
 * @description Provides rich validation utilities for `IPersonaDefinition` objects prior to
 *              activation or deployment. Ensures structural integrity, semantic consistency,
 *              and cross-persona conflict detection (e.g., activation keyword collisions).
 *
 * Design Goals:
 *  - Catch hard errors early (missing required fields, invalid IDs, unknown tool references).
 *  - Surface softer warnings (overly long system prompt, voice config without audio modality).
 *  - Offer proactive suggestions that improve quality (e.g., recommend cost strategy if omitted).
 *  - Remain side-effect free and pure: callers can run in CI, authoring tools, or runtime gates.
 */
import { IPersonaDefinition } from './IPersonaDefinition';
/** Classification of validation issue severity. */
export type PersonaValidationIssueSeverity = 'error' | 'warning' | 'suggestion';
/**
 * Structured validation issue capturing severity, machine-readable code, human message,
 * and optional field context.
 */
export interface PersonaValidationIssue {
    severity: PersonaValidationIssueSeverity;
    code: string;
    message: string;
    personaId?: string;
    field?: string;
}
/** Result for a single persona definition. */
export interface PersonaValidationResult {
    personaId: string;
    issues: PersonaValidationIssue[];
    summary: {
        errorCount: number;
        warningCount: number;
        suggestionCount: number;
    };
}
/** Aggregate report across multiple personas. */
export interface PersonaValidationAggregateReport {
    results: PersonaValidationResult[];
    totals: {
        errors: number;
        warnings: number;
        suggestions: number;
    };
    activationKeywordConflicts: Array<{
        keyword: string;
        personaIds: string[];
    }>;
}
/** Options for persona validation. */
export interface PersonaValidationOptions {
    /** Known registered tool IDs for verifying persona.toolIds references. */
    knownToolIds?: Set<string>;
    /** Reserved persona identifiers disallowed for user-defined personas. */
    reservedPersonaIds?: Set<string>;
    /** Maximum advisable length of the base system prompt before warning (characters). */
    maxSystemPromptLength?: number;
    /** Maximum advisable token length of the base system prompt before warning (uses tokenEstimator if provided). */
    maxSystemPromptTokens?: number;
    /** Optional token estimator allowing model-specific token length validation. */
    tokenEstimator?: (text: string) => Promise<number> | number;
}
/**
 * Configuration for strict validation enforcement.
 * When enabled, personas with blocking issues are marked invalid and optionally excluded from activation.
 */
export interface PersonaValidationStrictConfig {
    /** Master toggle: if false, all strict enforcement is disabled. */
    enabled: boolean;
    /**
     * Enforcement mode:
     * - 'activation_block': Load all personas but prevent session activation of invalid ones.
     * - 'load_block': Exclude invalid personas from registry entirely (stricter, more disruptive).
     */
    mode?: 'activation_block' | 'load_block';
    /** Specific validation codes that should block (overrides severity if set). If empty, errors block by default. */
    blockOnCodes?: string[];
    /** Escalate these warning codes to error severity for blocking purposes. */
    treatWarningsAsErrors?: string[];
    /** Persona IDs that bypass strict enforcement (escape hatch for WIP personas). */
    allowlistPersonaIds?: string[];
    /**
     * Shadow mode: perform strict classification and log what would be blocked without enforcing.
     * Useful for observing impact before activating strict mode.
     */
    shadowMode?: boolean;
}
/** Loaded persona record enriched with validation metadata for strict mode. */
export interface LoadedPersonaRecord {
    definition: IPersonaDefinition;
    validation: PersonaValidationResult;
    /** Persona status after applying strict mode rules. */
    status: 'valid' | 'invalid' | 'degraded';
    /** Validation codes causing blocking (if status='invalid'). */
    blockedReasons?: string[];
}
/**
 * Validate a single persona definition and return structured issues.
 * @param persona Persona definition to validate.
 * @param opts Validation options.
 */
export declare function validatePersona(persona: IPersonaDefinition, opts?: PersonaValidationOptions): Promise<PersonaValidationResult>;
/** Validate a list of personas and compute aggregate statistics & cross-persona conflicts. */
export declare function validatePersonas(personas: IPersonaDefinition[], opts?: PersonaValidationOptions): Promise<PersonaValidationAggregateReport>;
/** Convenience guard: return true if persona passes with zero errors. */
export declare function personaIsValid(result: PersonaValidationResult): boolean;
/** Convenience guard: return true if all personas have zero errors. */
export declare function allPersonasValid(report: PersonaValidationAggregateReport): boolean;
/** Human-friendly summarization string for logging / CLI contexts. */
export declare function formatAggregateReport(report: PersonaValidationAggregateReport): string;
/**
 * Classify persona validation result as valid/invalid/degraded based on strict mode config.
 * @param result Validation result for a single persona.
 * @param strictConfig Strict mode configuration.
 * @returns Classification: status and blocked reasons if invalid.
 */
export declare function classifyPersonaStrict(result: PersonaValidationResult, strictConfig: PersonaValidationStrictConfig): {
    status: 'valid' | 'invalid' | 'degraded';
    blockedReasons: string[];
};
/**
 * Apply strict mode classification to all validation results and produce enriched persona records.
 * @param personas Array of persona definitions.
 * @param results Corresponding validation results.
 * @param strictConfig Strict mode config.
 * @returns Array of LoadedPersonaRecord with status classification.
 */
export declare function applyStrictMode(personas: IPersonaDefinition[], results: PersonaValidationResult[], strictConfig: PersonaValidationStrictConfig): LoadedPersonaRecord[];
declare const _default: {
    validatePersona: typeof validatePersona;
    validatePersonas: typeof validatePersonas;
    personaIsValid: typeof personaIsValid;
    allPersonasValid: typeof allPersonasValid;
    formatAggregateReport: typeof formatAggregateReport;
    classifyPersonaStrict: typeof classifyPersonaStrict;
    applyStrictMode: typeof applyStrictMode;
};
export default _default;
//# sourceMappingURL=PersonaValidation.d.ts.map