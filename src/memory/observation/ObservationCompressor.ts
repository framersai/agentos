/**
 * @fileoverview LLM-based observational memory compressor.
 *
 * Takes a batch of {@link ObservationNote} objects and compresses them into
 * denser {@link CompressedObservation} summaries via an LLM call. This is the
 * "Observer" agent in Mastra's agentic memory model — it groups related
 * observations by topic/entity overlap, produces a 1-3 sentence summary per
 * group, assigns a priority level, and attaches three-date temporal metadata.
 *
 * Typical compression: 3-10x (many individual notes become fewer dense
 * summaries while preserving all critical facts).
 *
 * Personality bias: when HEXACO traits are provided, the system prompt
 * is tuned to emphasise observation categories that align with the agent's
 * personality (e.g. high conscientiousness → emphasise commitments).
 *
 * @module agentos/memory/observation/ObservationCompressor
 */

import type { HexacoTraits } from '../config.js';
import type { ObservationNote } from './MemoryObserver.js';
import { relativeTimeLabel } from './temporal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority level for a compressed observation. */
export type CompressionPriority = 'critical' | 'important' | 'informational';

/**
 * A compressed observation produced by merging multiple raw
 * {@link ObservationNote} objects into a single dense summary.
 */
export interface CompressedObservation {
  /** Unique identifier for this compressed observation. */
  id: string;
  /** Dense summary of multiple observations (1-3 sentences). */
  summary: string;
  /** Triage priority. */
  priority: CompressionPriority;
  /** Three-date temporal metadata. */
  temporal: {
    /** When this compression was performed (Unix ms). */
    observedAt: number;
    /** Earliest event timestamp across all source observations (Unix ms). */
    referencedAt: number;
    /** Human-friendly relative time label for `referencedAt`. */
    relativeLabel: string;
  };
  /** IDs of the source {@link ObservationNote} objects that were compressed. */
  sourceIds: string[];
  /** Union of key entities across all source observations. */
  entities: string[];
  /** Average importance score of the source observations (0-1). */
  importance: number;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the LLM system prompt for observation compression.
 * Personality traits modulate which observation categories receive emphasis.
 */
function buildCompressorSystemPrompt(traits?: HexacoTraits): string {
  const emphases: string[] = [];
  if (traits) {
    const c = (v: number | undefined): number => v == null ? 0.5 : Math.max(0, Math.min(1, v));
    if (c(traits.emotionality) > 0.6) emphases.push('Preserve emotional context and sentiment shifts.');
    if (c(traits.conscientiousness) > 0.6) emphases.push('Preserve commitments, deadlines, and action items.');
    if (c(traits.openness) > 0.6) emphases.push('Preserve creative ideas and exploratory tangents.');
    if (c(traits.agreeableness) > 0.6) emphases.push('Preserve rapport cues and user preferences.');
    if (c(traits.honesty) > 0.6) emphases.push('Preserve corrections, retractions, and factual updates.');
  }

  const emphasisBlock = emphases.length > 0
    ? `\n\nPersonality emphasis:\n${emphases.map((e) => `- ${e}`).join('\n')}`
    : '';

  return `You are a memory compressor. Your task is to compress a batch of observation notes into denser summary groups.

Rules:
1. Group related observations by topic overlap or entity overlap.
2. For each group, produce ONE dense summary of 1-3 sentences that captures all key facts.
3. Assign a priority: "critical" (security, safety, urgent deadlines), "important" (user preferences, key decisions, commitments), or "informational" (context, background, trivia).
4. Include the IDs of all source observations in each group.
5. Merge entity lists from all grouped observations.
6. Target 3-10x compression while preserving ALL critical facts.

Output a JSON array of objects, each with:
{
  "summary": "dense summary text",
  "priority": "critical|important|informational",
  "sourceIds": ["obs_id_1", "obs_id_2"],
  "entities": ["entity1", "entity2"]
}

Output ONLY a valid JSON array. No markdown, no explanation.${emphasisBlock}`;
}

// ---------------------------------------------------------------------------
// Counter for unique IDs
// ---------------------------------------------------------------------------

let compressedIdCounter = 0;

// ---------------------------------------------------------------------------
// ObservationCompressor
// ---------------------------------------------------------------------------

/**
 * LLM-based compressor that takes a batch of {@link ObservationNote} objects
 * and produces denser {@link CompressedObservation} summaries.
 *
 * Achieves 3-10x compression while preserving key facts, entities, and
 * temporal context. Each compressed observation carries three-date temporal
 * metadata: when the compression happened, the earliest referenced event,
 * and a human-friendly relative time label.
 */
export class ObservationCompressor {
  /**
   * @param llmInvoker - Function that calls an LLM with (system, user) prompts.
   * @param traits - Optional HEXACO personality traits for bias-aware compression.
   */
  constructor(
    private llmInvoker: (system: string, user: string) => Promise<string>,
    private traits?: HexacoTraits,
  ) {}

  /**
   * Compress a batch of observation notes into denser summaries.
   *
   * The method:
   * 1. Formats the notes as a numbered list for the LLM.
   * 2. Sends the batch to the LLM with a compression prompt.
   * 3. Parses the JSON array response into {@link CompressedObservation} objects.
   * 4. Attaches three-date temporal metadata (observedAt, referencedAt, relativeLabel).
   *
   * @param notes - Batch of observation notes to compress.
   * @returns Array of compressed observations. Returns empty array on LLM failure.
   */
  async compress(notes: ObservationNote[]): Promise<CompressedObservation[]> {
    if (notes.length === 0) return [];

    const systemPrompt = buildCompressorSystemPrompt(this.traits);

    // Format notes as a numbered list with IDs, types, importance, and content.
    const userPrompt = notes
      .map((n) =>
        `[${n.id}] (${n.type}, importance=${n.importance.toFixed(2)}, entities=[${n.entities.join(', ')}]) ${n.content}`,
      )
      .join('\n');

    try {
      const response = await this.llmInvoker(systemPrompt, userPrompt);
      return this.parseCompressed(response, notes);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Internal parsing
  // -------------------------------------------------------------------------

  /**
   * Parse the LLM response into CompressedObservation objects.
   *
   * Tries to parse the response as a JSON array. Falls back to extracting
   * individual JSON objects from lines if the array parse fails.
   */
  private parseCompressed(
    llmResponse: string,
    sourceNotes: ObservationNote[],
  ): CompressedObservation[] {
    const now = Date.now();
    const noteMap = new Map(sourceNotes.map((n) => [n.id, n]));
    const results: CompressedObservation[] = [];

    // Try parsing as a JSON array first.
    let parsed: unknown[];
    try {
      // Strip markdown fences if present.
      const cleaned = llmResponse
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        parsed = [parsed];
      }
    } catch {
      // Fallback: try parsing line by line.
      parsed = [];
      for (const line of llmResponse.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '[' || trimmed === ']') continue;
        try {
          // Strip trailing comma for JSON-lines style.
          const clean = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
          parsed.push(JSON.parse(clean));
        } catch {
          // Skip malformed lines.
        }
      }
    }

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;

      if (typeof obj.summary !== 'string' || !obj.summary) continue;

      const sourceIds = Array.isArray(obj.sourceIds)
        ? (obj.sourceIds as string[]).filter((id) => typeof id === 'string')
        : [];

      const entities = Array.isArray(obj.entities)
        ? (obj.entities as string[]).filter((e) => typeof e === 'string')
        : [];

      const priority = (['critical', 'important', 'informational'].includes(obj.priority as string)
        ? obj.priority
        : 'informational') as CompressionPriority;

      // Compute temporal metadata from source notes.
      const sourceTimes = sourceIds
        .map((id) => noteMap.get(id)?.timestamp)
        .filter((t): t is number => t != null);
      const earliestRef = sourceTimes.length > 0
        ? Math.min(...sourceTimes)
        : now;

      // Compute average importance from source notes.
      const sourceImportances = sourceIds
        .map((id) => noteMap.get(id)?.importance)
        .filter((i): i is number => i != null);
      const avgImportance = sourceImportances.length > 0
        ? sourceImportances.reduce((a, b) => a + b, 0) / sourceImportances.length
        : 0.5;

      results.push({
        id: `cobs_${Date.now()}_${++compressedIdCounter}`,
        summary: obj.summary,
        priority,
        temporal: {
          observedAt: now,
          referencedAt: earliestRef,
          relativeLabel: relativeTimeLabel(earliestRef, now),
        },
        sourceIds,
        entities,
        importance: avgImportance,
      });
    }

    return results;
  }
}
