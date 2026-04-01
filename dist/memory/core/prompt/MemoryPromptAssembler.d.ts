/**
 * @fileoverview Token-budgeted memory prompt assembly.
 *
 * Carves a token budget from the PromptEngine's RAG context allocation
 * and distributes it across memory sections:
 * - Working memory scratchpad
 * - Semantic recall results
 * - Recent episodic memories
 * - Prospective alerts (Batch 2)
 * - Graph associations (Batch 2)
 * - Observation notes (Batch 2)
 *
 * @module agentos/memory/prompt/MemoryPromptAssembler
 */
import type { MemoryBudgetAllocation, AssembledMemoryContext, ScoredMemoryTrace } from '../types.js';
import type { HexacoTraits } from '../config.js';
export interface MemoryAssemblerInput {
    /** Token budget for all memory context. */
    totalTokenBudget: number;
    /** Budget allocation percentages. */
    allocation?: Partial<MemoryBudgetAllocation>;
    /** HEXACO traits for formatting style selection. */
    traits: HexacoTraits;
    /** Working memory formatted string. */
    workingMemoryText?: string;
    /** Scored semantic/episodic traces from retrieval. */
    retrievedTraces?: ScoredMemoryTrace[];
    /** Prospective memory alerts (Batch 2). */
    prospectiveAlerts?: string[];
    /** Graph association context (Batch 2). */
    graphContext?: string[];
    /** Observation notes (Batch 2). */
    observationNotes?: string[];
    /** Persistent markdown memory (MEMORY.md contents). */
    persistentMemoryText?: string;
    /** Optional cognitive mechanisms engine for involuntary recall. */
    mechanismsEngine?: import('../../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;
    /** All available traces for involuntary recall pool. */
    allTraces?: import('../types.js').MemoryTrace[];
}
/**
 * Assemble memory context into a single formatted string within
 * the given token budget, with overflow redistribution.
 */
export declare function assembleMemoryContext(input: MemoryAssemblerInput): AssembledMemoryContext;
//# sourceMappingURL=MemoryPromptAssembler.d.ts.map