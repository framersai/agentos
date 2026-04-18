/**
 * @fileoverview Shared Zod building blocks for LLM output schemas.
 *
 * Call sites compose domain-specific schemas from these primitives
 * rather than duplicating enum definitions and field validators.
 * The primitives file is intentionally small — it provides reusable
 * atoms, not complete schemas for every use case.
 *
 * @example
 * ```ts
 * import { MemoryTypeEnum, ConfidenceScore, EntityArray } from '../../core/validation';
 *
 * const MySchema = z.object({
 *   type: MemoryTypeEnum,
 *   confidence: ConfidenceScore,
 *   entities: EntityArray,
 *   myCustomField: z.string(),
 * });
 * ```
 *
 * @module agentos/core/validation/schema-primitives
 */
import { z } from 'zod';
/**
 * Tulving's LTM taxonomy extended with relational memory.
 * - episodic: autobiographical events and experiences
 * - semantic: general knowledge and facts
 * - procedural: how-to knowledge and behavioral patterns
 * - prospective: future intentions and triggered reminders
 * - relational: trust signals, boundary events, emotional bonds
 */
export declare const MemoryTypeEnum: z.ZodEnum<{
    semantic: "semantic";
    episodic: "episodic";
    procedural: "procedural";
    prospective: "prospective";
    relational: "relational";
}>;
/**
 * Memory visibility/ownership scope.
 * - user: about the user (persists across conversations)
 * - thread: conversation-specific (ephemeral)
 * - persona: about the agent itself
 * - organization: shared across agents
 */
export declare const MemoryScopeEnum: z.ZodEnum<{
    user: "user";
    organization: "organization";
    thread: "thread";
    persona: "persona";
}>;
/** Confidence or strength score, clamped to [0, 1]. */
export declare const ConfidenceScore: z.ZodNumber;
/** Array of entity name strings, defaults to empty. */
export declare const EntityArray: z.ZodDefault<z.ZodArray<z.ZodString>>;
/** Array of tag strings, defaults to empty. */
export declare const TagArray: z.ZodDefault<z.ZodArray<z.ZodString>>;
/** Importance score, clamped to [0, 1], defaults to 0.5. */
export declare const ImportanceScore: z.ZodDefault<z.ZodNumber>;
/**
 * Schema for a single observation note extracted by MemoryObserver.
 * The Observer LLM produces these as JSONL (one per line).
 */
export declare const ObservationNoteOutput: z.ZodObject<{
    type: z.ZodEnum<{
        preference: "preference";
        factual: "factual";
        emotional: "emotional";
        commitment: "commitment";
        creative: "creative";
        correction: "correction";
    }>;
    content: z.ZodString;
    importance: z.ZodDefault<z.ZodNumber>;
    entities: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Schema for a single reflection trace produced by MemoryReflector.
 * The Reflector consolidates observation notes into typed long-term traces.
 */
export declare const ReflectionTraceOutput: z.ZodObject<{
    reasoning: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        semantic: "semantic";
        episodic: "episodic";
        procedural: "procedural";
        prospective: "prospective";
        relational: "relational";
    }>;
    scope: z.ZodEnum<{
        user: "user";
        organization: "organization";
        thread: "thread";
        persona: "persona";
    }>;
    scopeId: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
    entities: z.ZodDefault<z.ZodArray<z.ZodString>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    confidence: z.ZodNumber;
    sourceType: z.ZodDefault<z.ZodEnum<{
        observation: "observation";
        reflection: "reflection";
    }>>;
    supersedes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    consumedNotes: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Schema for a compressed observation from ObservationCompressor.
 * Compresses N raw notes into a dense summary.
 */
export declare const CompressedObservationOutput: z.ZodObject<{
    summary: z.ZodString;
    importance: z.ZodDefault<z.ZodNumber>;
    entities: z.ZodDefault<z.ZodArray<z.ZodString>>;
    noteIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
/**
 * Schema for content feature detection (LLM strategy).
 * Used by ContentFeatureDetector when `featureDetectionStrategy === 'llm'`.
 */
export declare const ContentFeaturesOutput: z.ZodObject<{
    hasNovelty: z.ZodDefault<z.ZodBoolean>;
    hasProcedure: z.ZodDefault<z.ZodBoolean>;
    hasEmotion: z.ZodDefault<z.ZodBoolean>;
    hasSocialContent: z.ZodDefault<z.ZodBoolean>;
    hasCooperation: z.ZodDefault<z.ZodBoolean>;
    hasEthicalContent: z.ZodDefault<z.ZodBoolean>;
    hasContradiction: z.ZodDefault<z.ZodBoolean>;
    topicRelevance: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
//# sourceMappingURL=schema-primitives.d.ts.map