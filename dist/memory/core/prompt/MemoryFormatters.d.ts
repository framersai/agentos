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
/**
 * Format a single memory trace according to the given style.
 */
export declare function formatMemoryTrace(trace: FormatTrace, style: FormattingStyle): string;
/**
 * Format multiple traces with a separator appropriate for the style.
 */
export declare function formatMemoryTraces(traces: FormatTrace[], style: FormattingStyle): string;
export {};
//# sourceMappingURL=MemoryFormatters.d.ts.map