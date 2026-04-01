/**
 * @fileoverview Slot-based cognitive working memory (Baddeley's model).
 *
 * Wraps the existing IWorkingMemory interface and adds:
 * - Capacity-limited slots (7±2, personality-modulated)
 * - Activation levels per slot (0-1)
 * - Attention weights and rehearsal
 * - Overflow eviction → episodic encoding callback
 *
 * @module agentos/memory/working/CognitiveWorkingMemory
 */
import type { IWorkingMemory } from '../../../cognitive_substrate/memory/IWorkingMemory.js';
import type { WorkingMemorySlot } from '../types.js';
import type { HexacoTraits } from '../config.js';
export interface CognitiveWorkingMemoryConfig {
    /** Base capacity (Miller's number). @default 7 */
    baseCapacity: number;
    /** HEXACO traits for personality-modulated capacity. */
    traits: HexacoTraits;
    /** Callback when a slot is evicted (should encode into episodic LTM). */
    onEvict?: (slotId: string, traceId: string) => Promise<void>;
    /** Activation decay rate per turn (0-1). @default 0.1 */
    activationDecayRate: number;
    /** Minimum activation before a slot is eligible for eviction. @default 0.15 */
    minActivation: number;
}
/**
 * Cognitive working memory with Baddeley-inspired slot management.
 *
 * Also implements IWorkingMemory for backward compatibility —
 * `get/set/delete/clear/has/size/getAll` delegate to the backing store,
 * while slot management is layered on top.
 */
export declare class CognitiveWorkingMemory implements IWorkingMemory {
    readonly id: string;
    private backing;
    private config;
    private capacity;
    private slots;
    private nextSlotIndex;
    constructor(backing: IWorkingMemory, config?: Partial<CognitiveWorkingMemoryConfig>);
    initialize(gmiInstanceId: string, config?: Record<string, any>): Promise<void>;
    set<T = any>(key: string, value: T): Promise<void>;
    get<T = any>(key: string): Promise<T | undefined>;
    delete(key: string): Promise<void>;
    getAll(): Promise<Record<string, any>>;
    clear(): Promise<void>;
    size(): Promise<number>;
    has(key: string): Promise<boolean>;
    close(): Promise<void>;
    /** Current number of occupied slots. */
    getSlotCount(): number;
    /** Maximum slot capacity (personality-modulated). */
    getCapacity(): number;
    /** Get all active slots. */
    getSlots(): WorkingMemorySlot[];
    /** Get a specific slot by ID. */
    getSlot(slotId: string): WorkingMemorySlot | undefined;
    /**
     * Focus attention on a trace, adding it to working memory.
     * If at capacity, the lowest-activation slot is evicted first.
     *
     * @returns The slot ID assigned to this trace.
     */
    focus(traceId: string, initialActivation?: number): Promise<string>;
    /**
     * Rehearse a slot (maintenance rehearsal), bumping its activation.
     */
    rehearse(slotId: string): void;
    /**
     * Apply per-turn activation decay to all slots.
     * Slots that drop below minActivation become eviction candidates.
     */
    decayActivations(): Promise<string[]>;
    /**
     * Get working memory utilisation (0-1).
     */
    getUtilization(): number;
    /**
     * Serialise current slots as a formatted string for prompt injection.
     */
    formatForPrompt(): string;
    private evictLowestActivation;
    private evictSlot;
    private rebalanceAttention;
}
//# sourceMappingURL=CognitiveWorkingMemory.d.ts.map