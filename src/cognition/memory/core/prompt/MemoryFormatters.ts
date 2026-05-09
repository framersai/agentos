/**
 * @fileoverview Personality-specific memory formatting.
 *
 * Formats MemoryTrace objects into text appropriate for prompt injection,
 * with style adapted to the agent's personality:
 * - **structured** (high conscientiousness): bullet lists with metadata
 * - **narrative** (high openness): flowing prose with associations
 * - **emotional** (high emotionality): includes emotional context annotations
 *
 * @module agentos/memory/prompt/MemoryFormatters
 */

import type { MemoryTrace, ScoredMemoryTrace } from '../types.js';

export type FormattingStyle = 'structured' | 'narrative' | 'emotional';
type FormatTrace = MemoryTrace & Partial<Pick<ScoredMemoryTrace, 'retrievalScore'>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(timestampMs: number): string {
  const elapsed = Date.now() - timestampMs;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function confidenceLabel(confidence: number): string {
  if (confidence > 0.8) return 'high confidence';
  if (confidence > 0.5) return 'moderate confidence';
  return 'low confidence';
}

function valenceEmoji(valence: number): string {
  if (valence > 0.3) return '(+)';
  if (valence < -0.3) return '(-)';
  return '(~)';
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatStructured(trace: FormatTrace): string {
  const parts = [
    `- [${trace.type}]`,
    trace.content.substring(0, 300),
  ];

  const meta: string[] = [];
  meta.push(timeAgo(trace.createdAt));
  meta.push(confidenceLabel(trace.provenance.confidence));
  meta.push(`relevance: ${(trace.retrievalScore ?? trace.provenance.confidence).toFixed(2)}`);
  if (trace.tags.length > 0) {
    meta.push(`tags: ${trace.tags.slice(0, 3).join(', ')}`);
  }

  parts.push(`(${meta.join(' | ')})`);
  return parts.join(' ');
}

function formatNarrative(trace: FormatTrace): string {
  const time = timeAgo(trace.createdAt);
  const content = trace.content.substring(0, 350);

  let text = `${time}: ${content}`;
  if (trace.associatedTraceIds.length > 0) {
    text += ` [linked to ${trace.associatedTraceIds.length} other memories]`;
  }
  if (trace.entities.length > 0) {
    text += ` (involves: ${trace.entities.slice(0, 3).join(', ')})`;
  }
  return text;
}

function formatEmotional(trace: FormatTrace): string {
  const time = timeAgo(trace.createdAt);
  const emoji = valenceEmoji(trace.emotionalContext.valence);
  const content = trace.content.substring(0, 300);
  const intensity = trace.emotionalContext.intensity;

  let text = `${emoji} ${time}: ${content}`;
  if (intensity > 0.6) {
    text += ` [strongly felt, mood: ${trace.emotionalContext.gmiMood}]`;
  } else if (intensity > 0.3) {
    text += ` [mood: ${trace.emotionalContext.gmiMood}]`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format a single memory trace according to the given style.
 */
export function formatMemoryTrace(trace: FormatTrace, style: FormattingStyle): string {
  switch (style) {
    case 'structured':
      return formatStructured(trace);
    case 'narrative':
      return formatNarrative(trace);
    case 'emotional':
      return formatEmotional(trace);
    default:
      return formatStructured(trace);
  }
}

/**
 * Format multiple traces with a separator appropriate for the style.
 */
export function formatMemoryTraces(traces: FormatTrace[], style: FormattingStyle): string {
  return traces.map((t) => formatMemoryTrace(t, style)).join('\n');
}
