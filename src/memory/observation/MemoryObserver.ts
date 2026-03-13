/**
 * @fileoverview Memory Observer — personality-biased background note extraction.
 *
 * Monitors accumulated conversation tokens via ObservationBuffer.
 * When the threshold is reached, extracts concise observation notes
 * via a persona-configured LLM (defaults to cheap model).
 *
 * Personality bias:
 * - High emotionality → notes emotional shifts
 * - High conscientiousness → notes commitments/deadlines
 * - High openness → notes creative tangents
 * - High agreeableness → notes user preferences and rapport cues
 * - High honesty → notes corrections and retractions
 *
 * @module agentos/memory/observation/MemoryObserver
 */

import type { HexacoTraits, PADState, ObserverConfig } from '../config.js';
import { ObservationBuffer, type BufferedMessage } from './ObservationBuffer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObservationNote {
  id: string;
  /** Category of observation. */
  type: 'factual' | 'emotional' | 'commitment' | 'preference' | 'creative' | 'correction';
  /** Short summary of the observation. */
  content: string;
  /** 0-1 importance score. */
  importance: number;
  /** Entities mentioned. */
  entities: string[];
  /** Emotional context at observation time. */
  emotionalContext?: { valence: number; arousal: number };
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Personality-aware system prompt builder
// ---------------------------------------------------------------------------

function buildObserverSystemPrompt(traits: HexacoTraits): string {
  const clamp = (v: number | undefined): number => v == null ? 0.5 : Math.max(0, Math.min(1, v));

  const emphases: string[] = [];
  if (clamp(traits.emotionality) > 0.6) emphases.push('Pay special attention to emotional shifts, tone changes, and sentiment transitions.');
  if (clamp(traits.conscientiousness) > 0.6) emphases.push('Note any commitments, deadlines, action items, or structured plans.');
  if (clamp(traits.openness) > 0.6) emphases.push('Capture creative tangents, novel ideas, and exploratory topics.');
  if (clamp(traits.agreeableness) > 0.6) emphases.push('Track user preferences, rapport cues, and communication style patterns.');
  if (clamp(traits.honesty) > 0.6) emphases.push('Flag any corrections, retractions, or contradictions to prior statements.');

  const emphasisBlock = emphases.length > 0
    ? `\n\nPriority focus areas:\n${emphases.map((e) => `- ${e}`).join('\n')}`
    : '';

  return `You are a memory observer. Extract concise observation notes from the conversation below.

For each observation, output a JSON object on its own line with these fields:
- type: "factual" | "emotional" | "commitment" | "preference" | "creative" | "correction"
- content: brief summary (1-2 sentences max)
- importance: 0.0-1.0 (how important is this for future recall?)
- entities: string[] (key entities mentioned)

Output ONLY valid JSON objects, one per line. No markdown, no explanation.${emphasisBlock}`;
}

// ---------------------------------------------------------------------------
// MemoryObserver
// ---------------------------------------------------------------------------

let noteIdCounter = 0;

export class MemoryObserver {
  private buffer: ObservationBuffer;
  private traits: HexacoTraits;
  private llmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  private config: ObserverConfig;

  constructor(
    traits: HexacoTraits,
    config?: Partial<ObserverConfig>,
  ) {
    this.traits = traits;
    this.config = {
      activationThresholdTokens: config?.activationThresholdTokens ?? 30_000,
      modelId: config?.modelId,
      llmInvoker: config?.llmInvoker,
    };
    this.llmInvoker = config?.llmInvoker;
    this.buffer = new ObservationBuffer({
      activationThresholdTokens: this.config.activationThresholdTokens,
    });
  }

  /**
   * Feed a message into the observation buffer.
   * Returns observation notes if the buffer has reached activation threshold.
   */
  async observe(
    role: BufferedMessage['role'],
    content: string,
    mood?: PADState,
  ): Promise<ObservationNote[] | null> {
    const shouldActivate = this.buffer.push(role, content);

    if (!shouldActivate) return null;
    if (!this.llmInvoker) return null;

    return this.extractNotes(mood);
  }

  /**
   * Force extraction of observation notes from buffered messages.
   */
  async extractNotes(mood?: PADState): Promise<ObservationNote[]> {
    if (!this.llmInvoker) return [];

    const messages = this.buffer.drain();
    if (messages.length === 0) return [];

    // Build conversation text for the LLM
    const conversationText = messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    const systemPrompt = buildObserverSystemPrompt(this.traits);

    try {
      const response = await this.llmInvoker(systemPrompt, conversationText);
      return this.parseNotes(response, mood);
    } catch {
      return [];
    }
  }

  /** Get the underlying buffer for inspection. */
  getBuffer(): ObservationBuffer {
    return this.buffer;
  }

  /** Check if observation should be triggered. */
  shouldActivate(): boolean {
    return this.buffer.shouldActivate();
  }

  /** Reset the observer. */
  clear(): void {
    this.buffer.clear();
  }

  // --- Internal ---

  private parseNotes(llmResponse: string, mood?: PADState): ObservationNote[] {
    const notes: ObservationNote[] = [];
    const lines = llmResponse.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed.type && parsed.content) {
          notes.push({
            id: `obs_${Date.now()}_${++noteIdCounter}`,
            type: parsed.type,
            content: parsed.content,
            importance: typeof parsed.importance === 'number' ? parsed.importance : 0.5,
            entities: Array.isArray(parsed.entities) ? parsed.entities : [],
            emotionalContext: mood ? { valence: mood.valence, arousal: mood.arousal } : undefined,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return notes;
  }
}
