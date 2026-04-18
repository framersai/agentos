/**
 * @fileoverview Prompt builders for PerspectiveObserver LLM calls.
 *
 * Pure functions that produce the system and user prompts for per-witness
 * first-person memory rewriting. Separated from PerspectiveObserver for
 * testability.
 *
 * @module agentos/memory/observation/perspective-prompt
 * @see {@link PerspectiveObserver} for the consuming class.
 */
import type { Witness, ObservedEvent } from './PerspectiveObserver.js';
/**
 * Build the system prompt for a single witness.
 *
 * Encodes the witness's HEXACO personality, current mood, and relationships
 * into instructions for first-person memory rewriting.
 *
 * @param witness - The witness whose perspective shapes the prompt.
 * @returns System prompt string for the LLM call.
 */
export declare function buildPerspectiveSystemPrompt(witness: Witness): string;
/**
 * Build the user prompt containing the events to rewrite.
 *
 * @param events - Objective events to rewrite from the witness's perspective.
 * @returns User prompt string listing events as a numbered list.
 */
export declare function buildPerspectiveUserPrompt(events: ObservedEvent[]): string;
//# sourceMappingURL=perspective-prompt.d.ts.map