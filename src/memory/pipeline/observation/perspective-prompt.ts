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
export function buildPerspectiveSystemPrompt(witness: Witness): string {
  const h = witness.hexaco;
  const m = witness.mood;

  const relBlock = witness.relationships.length > 0
    ? witness.relationships
        .map((r) => `- ${r.entityName}: ${r.disposition} (trust: ${r.trustLevel})`)
        .join('\n')
    : '- No known relationships to entities in these events.';

  return `You are encoding memories for ${witness.agentName}. Rewrite each event as this character's first-person memory. What stands out to THEM? What do they notice, feel, emphasize?

Personality (HEXACO, 0-1 scale):
- Honesty: ${h.honesty ?? 0.5} — low: spin things favorably; high: record things as they are
- Emotionality: ${h.emotionality ?? 0.5} — low: focus on facts; high: focus on feelings and atmosphere
- Extraversion: ${h.extraversion ?? 0.5} — low: internal monologue; high: focus on social dynamics
- Agreeableness: ${h.agreeableness ?? 0.5} — low: note conflicts, competition; high: note cooperation
- Conscientiousness: ${h.conscientiousness ?? 0.5} — low: skip details; high: note commitments, consequences
- Openness: ${h.openness ?? 0.5} — low: stick to what happened; high: wonder about implications

Current mood: valence=${m.valence}, arousal=${m.arousal}, dominance=${m.dominance}

Relationships:
${relBlock}

Rules:
1. Write 1-2 sentences per event, first person.
2. Personality MUST color the encoding — a suspicious character notices threats, an emotional character remembers how things felt, a conscientious character tracks who promised what.
3. Hostile relationships mean interpreting actions with suspicion.
4. Friendly relationships mean charitable interpretation.
5. Do NOT fabricate events that didn't happen. Rewrite perspective, not facts.

Output a JSON array of strings, one per event. No explanation.`;
}

/**
 * Build the user prompt containing the events to rewrite.
 *
 * @param events - Objective events to rewrite from the witness's perspective.
 * @returns User prompt string listing events as a numbered list.
 */
export function buildPerspectiveUserPrompt(events: ObservedEvent[]): string {
  const list = events
    .map((e, i) => `${i + 1}. ${e.content}`)
    .join('\n');
  return `Events to encode:\n${list}`;
}
