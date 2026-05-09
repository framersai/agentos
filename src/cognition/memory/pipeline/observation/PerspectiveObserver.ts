/**
 * @fileoverview PerspectiveObserver — multi-agent subjective memory encoding.
 *
 * Takes objective events and an array of witnesses, applies gating predicates,
 * then produces per-witness first-person memory traces via LLM rewriting.
 * Each witness's HEXACO traits, current mood, and relationships to entities
 * in the event shape what they notice, feel, and remember.
 *
 * Standalone pipeline stage — sibling to ObservationCompressor and
 * ObservationReflector, not an extension of either.
 *
 * @module agentos/memory/observation/PerspectiveObserver
 * @see {@link ObservationCompressor} for note compression (different job).
 * @see {@link ObservationReflector} for pattern extraction (different job).
 */

import type { PADState, HexacoTraits } from '../../core/config.js';
import type { EmotionalContext } from '../../core/types.js';
import { sha256 } from '../../core/util/crossPlatformCrypto.js';
import {
  buildPerspectiveSystemPrompt,
  buildPerspectiveUserPrompt,
} from './perspective-prompt.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An objective event witnessed by one or more agents.
 */
export interface ObservedEvent {
  /** Unique event ID for linking subjective traces back to the source. */
  eventId: string;
  /** Objective event text. */
  content: string;
  /** The player's action text. */
  playerAction: string;
  /** The narrator/system response text. */
  narratorProse: string;
  /** 0-1 importance score. */
  importance: number;
  /** PAD snapshot at the moment of the event. */
  emotionalContext: EmotionalContext;
  /** Entity names involved in the event. */
  entities: string[];
  /** When the event occurred (Unix ms). */
  timestamp: number;
}

/**
 * A relationship between a witness and an entity in the event.
 */
export interface WitnessRelationship {
  entityName: string;
  disposition: 'neutral' | 'friendly' | 'wary' | 'hostile' | 'grateful' | 'fearful';
  trustLevel: number;
}

/**
 * An agent witnessing the event.
 */
export interface Witness {
  agentId: string;
  agentName: string;
  hexaco: HexacoTraits;
  mood: PADState;
  relationships: WitnessRelationship[];
  tier: 'important' | 'combatant' | 'background';
}

/**
 * A first-person memory trace produced by perspective rewriting.
 */
export interface SubjectiveTrace {
  witnessId: string;
  content: string;
  sourceEventId: string;
  originalEventHash: string;
  perspectiveMetadata: {
    hexacoSnapshot: HexacoTraits;
    moodSnapshot: PADState;
    relationshipSnapshot: WitnessRelationship[];
  };
}

/**
 * Result of a rewrite batch.
 */
export interface PerspectiveRewriteResult {
  traces: SubjectiveTrace[];
  fallbacks: Array<{ witnessId: string; reason: string }>;
  llmCallCount: number;
}

/**
 * Configuration for PerspectiveObserver.
 */
export interface PerspectiveObserverConfig {
  /** LLM invoker with (system, user) → response contract. */
  llmInvoker: (system: string, user: string) => Promise<string>;
  /** Minimum importance for perspective encoding. @default 0.3 */
  importanceThreshold?: number;
  /** Max events per LLM call. @default 10 */
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Multi-agent subjective memory encoder.
 *
 * @example
 * ```ts
 * const observer = new PerspectiveObserver({
 *   llmInvoker: (sys, usr) => callHaiku(sys, usr),
 * });
 * const result = await observer.rewrite(events, witnesses);
 * for (const trace of result.traces) {
 *   await npcBrains.get(trace.witnessId)?.remember(trace.content, {
 *     type: 'episodic',
 *     tags: ['perspective-encoded'],
 *   });
 * }
 * ```
 */
export class PerspectiveObserver {
  private readonly llmInvoker: PerspectiveObserverConfig['llmInvoker'];
  private readonly importanceThreshold: number;
  private readonly batchSize: number;

  constructor(config: PerspectiveObserverConfig) {
    this.llmInvoker = config.llmInvoker;
    this.importanceThreshold = config.importanceThreshold ?? 0.3;
    this.batchSize = config.batchSize ?? 10;
  }

  /**
   * Rewrite objective events from each witness's perspective.
   *
   * Applies gating predicates, batches events per witness, invokes the LLM,
   * and returns per-witness subjective traces. Failures fall back to objective
   * encoding with a reason string.
   *
   * @param events - Objective events to rewrite.
   * @param witnesses - Agents who witnessed the events.
   * @returns Subjective traces + fallback records + LLM call count.
   */
  async rewrite(
    events: ObservedEvent[],
    witnesses: Witness[],
  ): Promise<PerspectiveRewriteResult> {
    const traces: SubjectiveTrace[] = [];
    const fallbacks: PerspectiveRewriteResult['fallbacks'] = [];
    let llmCallCount = 0;

    // Pre-compute event hashes
    const eventHashes = new Map<string, string>();
    for (const event of events) {
      eventHashes.set(event.eventId, await sha256(event.content));
    }

    for (const witness of witnesses) {
      // Gate: tier
      if (witness.tier !== 'important') {
        fallbacks.push({ witnessId: witness.agentId, reason: `Skipped: tier is '${witness.tier}', not 'important'` });
        continue;
      }

      // Gate: filter events by importance and entity overlap
      const qualifying = events.filter((e) => {
        if (e.importance < this.importanceThreshold) return false;
        const witnessEntityNames = new Set(witness.relationships.map((r) => r.entityName.toLowerCase()));
        const eventEntityNames = e.entities.map((n) => n.toLowerCase());
        const hasOverlap = eventEntityNames.some((n) => witnessEntityNames.has(n));
        const witnessNameInEvent = eventEntityNames.includes(witness.agentName.toLowerCase());
        return hasOverlap || witnessNameInEvent;
      });

      if (qualifying.length === 0) {
        const allBelowThreshold = events.every((e) => e.importance < this.importanceThreshold);
        if (allBelowThreshold) {
          fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: all events below importance threshold' });
        } else {
          fallbacks.push({ witnessId: witness.agentId, reason: 'Skipped: no entity overlap with witness relationships' });
        }
        continue;
      }

      // Batch events and invoke LLM per batch
      const systemPrompt = buildPerspectiveSystemPrompt(witness);
      const batches = this.chunk(qualifying, this.batchSize);

      for (const batch of batches) {
        const userPrompt = buildPerspectiveUserPrompt(batch);

        try {
          const response = await this.llmInvoker(systemPrompt, userPrompt);
          llmCallCount++;

          const parsed = this.parseResponse(response, batch.length);
          if (!parsed) {
            const reason = response.trim().startsWith('[')
              ? `Fallback: LLM returned wrong count (expected ${batch.length})`
              : 'Fallback: LLM response failed to parse as JSON array';
            fallbacks.push({ witnessId: witness.agentId, reason });
            continue;
          }

          for (let i = 0; i < parsed.length; i++) {
            const event = batch[i];
            traces.push({
              witnessId: witness.agentId,
              content: parsed[i],
              sourceEventId: event.eventId,
              originalEventHash: eventHashes.get(event.eventId) ?? '',
              perspectiveMetadata: {
                hexacoSnapshot: { ...witness.hexaco },
                moodSnapshot: { ...witness.mood },
                relationshipSnapshot: witness.relationships.map((r) => ({ ...r })),
              },
            });
          }
        } catch (err) {
          llmCallCount++;
          fallbacks.push({
            witnessId: witness.agentId,
            reason: `Fallback: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    return { traces, fallbacks, llmCallCount };
  }

  /**
   * Parse LLM response as a JSON array of strings.
   *
   * @param response - Raw LLM response text.
   * @param expectedCount - Number of events in the batch.
   * @returns Parsed string array, or null on failure.
   */
  private parseResponse(response: string, expectedCount: number): string[] | null {
    try {
      const cleaned = response.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return null;
      if (parsed.length !== expectedCount) return null;
      if (!parsed.every((item) => typeof item === 'string')) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Split an array into chunks of `size`. */
  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
