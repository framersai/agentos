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
 * import { MemoryTypeEnum, ConfidenceScore, EntityArray } from '@framers/agentos/core/validation';
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
// ── Memory type enums ────────────────────────────────────────────────────
/**
 * Tulving's LTM taxonomy extended with relational memory.
 * - episodic: autobiographical events and experiences
 * - semantic: general knowledge and facts
 * - procedural: how-to knowledge and behavioral patterns
 * - prospective: future intentions and triggered reminders
 * - relational: trust signals, boundary events, emotional bonds
 */
export const MemoryTypeEnum = z.enum([
    'episodic',
    'semantic',
    'procedural',
    'prospective',
    'relational',
]);
/**
 * Memory visibility/ownership scope.
 * - user: about the user (persists across conversations)
 * - thread: conversation-specific (ephemeral)
 * - persona: about the agent itself
 * - organization: shared across agents
 */
export const MemoryScopeEnum = z.enum([
    'user',
    'thread',
    'persona',
    'organization',
]);
// ── Common field validators ──────────────────────────────────────────────
/** Confidence or strength score, clamped to [0, 1]. */
export const ConfidenceScore = z.number().min(0).max(1);
/** Array of entity name strings, defaults to empty. */
export const EntityArray = z.array(z.string()).default([]);
/** Array of tag strings, defaults to empty. */
export const TagArray = z.array(z.string()).default([]);
/** Importance score, clamped to [0, 1], defaults to 0.5. */
export const ImportanceScore = z.number().min(0).max(1).default(0.5);
// ── Composite schemas for AgentOS memory pipeline ────────────────────────
/**
 * Schema for a single observation note extracted by MemoryObserver.
 * The Observer LLM produces these as JSONL (one per line).
 */
export const ObservationNoteOutput = z.object({
    /** Observation category. */
    type: z.enum(['factual', 'emotional', 'commitment', 'preference', 'creative', 'correction']),
    /** Brief summary of the observation (1-2 sentences max). */
    content: z.string().min(1),
    /** How important this observation is for future recall (0-1). */
    importance: ImportanceScore,
    /** Key entities mentioned in the observation. */
    entities: EntityArray,
});
/**
 * Schema for a single reflection trace produced by MemoryReflector.
 * The Reflector consolidates observation notes into typed long-term traces.
 */
export const ReflectionTraceOutput = z.object({
    /** Chain-of-thought reasoning for why this trace matters (devtools only). */
    reasoning: z.string().optional(),
    /** Memory type classification (Tulving's taxonomy + relational). */
    type: MemoryTypeEnum,
    /** Memory scope for access control. */
    scope: MemoryScopeEnum,
    /** Scope identifier (e.g., user ID, thread ID). */
    scopeId: z.string().default(''),
    /** Consolidated memory content. */
    content: z.string().min(1),
    /** Entities referenced in this memory. */
    entities: EntityArray,
    /** Descriptive tags for retrieval filtering. */
    tags: TagArray,
    /** Confidence in this memory's accuracy (0-1). */
    confidence: ConfidenceScore,
    /** How this trace was produced. */
    sourceType: z.enum(['observation', 'reflection']).default('reflection'),
    /** IDs of existing traces that this trace supersedes (conflict resolution). */
    supersedes: z.array(z.string()).default([]),
    /** IDs of observation notes consumed to produce this trace. */
    consumedNotes: z.array(z.string()).default([]),
});
/**
 * Schema for a compressed observation from ObservationCompressor.
 * Compresses N raw notes into a dense summary.
 */
export const CompressedObservationOutput = z.object({
    /** Dense summary of multiple observation notes. */
    summary: z.string().min(1),
    /** Aggregate importance of the compressed observations. */
    importance: ImportanceScore,
    /** Entities across all compressed notes. */
    entities: EntityArray,
    /** IDs of the raw notes that were compressed. */
    noteIds: z.array(z.string()).default([]),
});
/**
 * Schema for content feature detection (LLM strategy).
 * Used by ContentFeatureDetector when `featureDetectionStrategy === 'llm'`.
 */
export const ContentFeaturesOutput = z.object({
    /** Content contains novel or surprising information. */
    hasNovelty: z.boolean().default(false),
    /** Content contains procedural/how-to knowledge. */
    hasProcedure: z.boolean().default(false),
    /** Content has emotional charge or sentiment. */
    hasEmotion: z.boolean().default(false),
    /** Content involves social interactions or relationships. */
    hasSocialContent: z.boolean().default(false),
    /** Content involves cooperative or collaborative themes. */
    hasCooperation: z.boolean().default(false),
    /** Content involves ethical or moral considerations. */
    hasEthicalContent: z.boolean().default(false),
    /** Content contradicts previously known information. */
    hasContradiction: z.boolean().default(false),
    /** Relevance to current task or conversation (0-1). */
    topicRelevance: z.number().min(0).max(1).default(0.5),
});
//# sourceMappingURL=schema-primitives.js.map