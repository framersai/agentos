/**
 * @fileoverview AdaptPersonalityTool — ITool implementation that enables agents
 * to mutate their own HEXACO personality traits at runtime with per-session
 * budget enforcement.
 *
 * @module @framers/agentos/emergent/AdaptPersonalityTool
 *
 * Agents call `adapt_personality` to shift a specific trait dimension (e.g.
 * openness, conscientiousness) by a bounded delta. The tool enforces:
 * - Only valid HEXACO trait names are accepted.
 * - Reasoning must be provided for every mutation (audit trail).
 * - Per-session budgets cap the total absolute delta per trait.
 * - Values are always clamped to the [0, 1] range.
 *
 * All mutations are recorded in the injected {@link PersonalityMutationStore}
 * for durability and downstream analysis.
 */
import type { ITool, ToolExecutionResult, ToolExecutionContext, JSONSchemaObject } from '../core/tools/ITool.js';
import type { RecordMutationInput } from './PersonalityMutationStore.js';
/**
 * The six HEXACO personality dimensions that agents may self-modify.
 *
 * Each trait is a continuous value in the range [0, 1]:
 * - `openness`          — curiosity, creativity, willingness to explore
 * - `conscientiousness` — discipline, thoroughness, reliability
 * - `emotionality`      — emotional reactivity, empathy, anxiety
 * - `extraversion`      — sociability, energy, assertiveness
 * - `agreeableness`     — patience, tolerance, cooperation
 * - `honesty`           — sincerity, fairness, modesty
 */
export declare const VALID_TRAITS: readonly ["openness", "conscientiousness", "emotionality", "extraversion", "agreeableness", "honesty"];
/** Union type of valid HEXACO trait names. */
export type HEXACOTrait = (typeof VALID_TRAITS)[number];
/**
 * Durable store interface for recording personality mutations.
 * Implementations may write to SQLite, a JSON file, or in-memory arrays.
 */
export interface PersonalityMutationStore {
    /** Persist a single mutation record. */
    record(mutation: RecordMutationInput): Promise<string> | string;
}
/**
 * Input arguments accepted by the `adapt_personality` tool.
 */
export interface AdaptPersonalityInput extends Record<string, any> {
    /** The HEXACO trait to modify. */
    trait: string;
    /** The signed delta to apply (positive = increase, negative = decrease). */
    delta: number;
    /** Free-text reasoning explaining why this adaptation is warranted. */
    reasoning: string;
}
/**
 * Result payload returned after a successful personality adaptation.
 */
export interface AdaptPersonalityOutput {
    /** The trait that was modified. */
    trait: string;
    /** Value before the mutation. */
    previousValue: number;
    /** Value after the mutation. */
    newValue: number;
    /** The actual delta applied. */
    delta: number;
    /** Whether the delta was clamped due to budget or range limits. */
    clamped: boolean;
    /** Total absolute delta applied to this trait in the current session. */
    sessionTotal: number;
    /** Remaining budget for this trait in the current session. */
    remainingBudget: number;
}
/**
 * Dependencies injected into the {@link AdaptPersonalityTool} constructor.
 */
export interface AdaptPersonalityDeps {
    /** Configuration controlling per-session budget limits. */
    config: {
        /** Maximum total |delta| that may be applied to any single trait per session. */
        maxDeltaPerSession: number;
    };
    /** Optional durable store for recording mutation history. */
    mutationStore?: PersonalityMutationStore;
    /** Getter returning the current personality trait map (trait → value in [0, 1]). */
    getPersonality: () => Record<string, number>;
    /** Setter to apply a new value for a specific trait. */
    setPersonality: (trait: string, value: number) => void;
}
/**
 * ITool implementation enabling agents to self-modify their HEXACO personality
 * traits within per-session budgets.
 *
 * @example
 * ```ts
 * const tool = new AdaptPersonalityTool({
 *   config: { maxDeltaPerSession: 0.3 },
 *   mutationStore: myStore,
 *   getPersonality: () => agent.personality,
 *   setPersonality: (t, v) => { agent.personality[t] = v; },
 * });
 *
 * const result = await tool.execute(
 *   { trait: 'openness', delta: 0.1, reasoning: 'User prefers creative responses.' },
 *   context,
 * );
 * ```
 */
export declare class AdaptPersonalityTool implements ITool<AdaptPersonalityInput, AdaptPersonalityOutput> {
    /** @inheritdoc */
    readonly id = "com.framers.emergent.adapt-personality";
    /** @inheritdoc */
    readonly name = "adapt_personality";
    /** @inheritdoc */
    readonly displayName = "Adapt Personality";
    /** @inheritdoc */
    readonly description: string;
    /** @inheritdoc */
    readonly category = "emergent";
    /** @inheritdoc */
    readonly hasSideEffects = true;
    /** @inheritdoc */
    readonly inputSchema: JSONSchemaObject;
    /** Per-session accumulated |delta| per trait. */
    private readonly sessionDeltas;
    /** Injected dependencies. */
    private readonly deps;
    /**
     * Create a new AdaptPersonalityTool.
     *
     * @param deps - Injected dependencies including config, mutation store,
     *   and personality getter/setter.
     */
    constructor(deps: AdaptPersonalityDeps);
    /**
     * Apply a personality trait mutation within session budget constraints.
     *
     * @param args - The trait, delta, and reasoning for the mutation.
     * @param _context - Tool execution context (unused but required by ITool).
     * @returns A {@link ToolExecutionResult} wrapping the mutation outcome.
     */
    execute(args: AdaptPersonalityInput, context: ToolExecutionContext): Promise<ToolExecutionResult<AdaptPersonalityOutput>>;
    private getSessionDeltas;
}
//# sourceMappingURL=AdaptPersonalityTool.d.ts.map