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

import type {
  MemoryBudgetAllocation,
  AssembledMemoryContext,
  ScoredMemoryTrace,
} from '../types.js';
import type { HexacoTraits } from '../config.js';
import { DEFAULT_BUDGET_ALLOCATION } from '../config.js';
import { formatMemoryTrace, type FormattingStyle } from './MemoryFormatters.js';

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Personality → formatting style
// ---------------------------------------------------------------------------

const clamp01 = (v: number | undefined): number =>
  v == null ? 0.5 : Math.max(0, Math.min(1, v));

function selectFormattingStyle(traits: HexacoTraits): FormattingStyle {
  const c = clamp01(traits.conscientiousness);
  const o = clamp01(traits.openness);
  const e = clamp01(traits.emotionality);

  // Highest trait wins
  if (c >= o && c >= e) return 'structured';
  if (o >= c && o >= e) return 'narrative';
  return 'emotional';
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

export interface MemoryAssemblerInput {
  /** Token budget for all memory context. */
  totalTokenBudget: number;
  /** Budget allocation percentages. */
  allocation?: Partial<MemoryBudgetAllocation>;
  /** HEXACO traits for formatting style selection. */
  traits: HexacoTraits;

  // --- Data sources ---
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

  // --- Cognitive Mechanisms (optional) ---
  /** Optional cognitive mechanisms engine for involuntary recall. */
  mechanismsEngine?: import('../mechanisms/CognitiveMechanismsEngine.js').CognitiveMechanismsEngine;
  /** All available traces for involuntary recall pool. */
  allTraces?: import('../types.js').MemoryTrace[];
}

/**
 * Assemble memory context into a single formatted string within
 * the given token budget, with overflow redistribution.
 */
export function assembleMemoryContext(input: MemoryAssemblerInput): AssembledMemoryContext {
  const alloc: MemoryBudgetAllocation = {
    ...DEFAULT_BUDGET_ALLOCATION,
    ...input.allocation,
  };

  const budget = input.totalTokenBudget;
  const style = selectFormattingStyle(input.traits);

  // Compute per-section budgets
  const pmBudget = Math.floor(budget * alloc.persistentMemory);
  const wmBudget = Math.floor(budget * alloc.workingMemory);
  let semanticBudget = Math.floor(budget * alloc.semanticRecall);
  const episodicBudget = Math.floor(budget * alloc.recentEpisodic);
  const prospectiveBudget = Math.floor(budget * alloc.prospectiveAlerts);
  const graphBudget = Math.floor(budget * alloc.graphAssociations);
  const observationBudget = Math.floor(budget * alloc.observationNotes);

  const sections: string[] = [];
  const includedIds: string[] = [];
  let totalTokens = 0;

  // --- Persistent Memory (MEMORY.md) ---
  if (input.persistentMemoryText && pmBudget > 0) {
    let pmText = input.persistentMemoryText;
    const maxChars = pmBudget * 4;
    if (pmText.length > maxChars) {
      pmText = pmText.slice(0, maxChars) + '\n<!-- truncated -->';
    }
    sections.push(`## Persistent Memory\n\n${pmText}`);
    totalTokens += Math.min(estimateTokens(input.persistentMemoryText), pmBudget);
  }

  // --- Working Memory ---
  const wmText = input.workingMemoryText ?? '';
  const wmTokens = estimateTokens(wmText);
  let wmUsed = 0;
  if (wmText && wmTokens <= wmBudget) {
    sections.push(`## Active Context\n${wmText}`);
    wmUsed = wmTokens;
    totalTokens += wmUsed;
  }
  const wmOverflow = wmBudget - wmUsed;

  // --- Separate episodic and semantic traces ---
  const episodicTraces: ScoredMemoryTrace[] = [];
  const semanticTraces: ScoredMemoryTrace[] = [];
  for (const trace of input.retrievedTraces ?? []) {
    if (trace.type === 'episodic') {
      episodicTraces.push(trace);
    } else {
      semanticTraces.push(trace);
    }
  }

  // --- Semantic Recall (gets overflow from WM and unused Batch 2 sections) ---
  semanticBudget += wmOverflow;
  // If Batch 2 sections are empty, their budgets flow to semantic
  if (!input.prospectiveAlerts?.length) semanticBudget += prospectiveBudget;
  if (!input.graphContext?.length) semanticBudget += graphBudget;
  if (!input.observationNotes?.length) semanticBudget += observationBudget;

  let semanticUsed = 0;
  if (semanticTraces.length > 0) {
    const semanticLines: string[] = [];
    for (const trace of semanticTraces) {
      const formatted = formatMemoryTrace(trace, style);
      const tokens = estimateTokens(formatted);
      if (semanticUsed + tokens > semanticBudget) break;
      semanticLines.push(formatted);
      semanticUsed += tokens;
      includedIds.push(trace.id);
    }
    if (semanticLines.length > 0) {
      sections.push(`## Relevant Memories\n${semanticLines.join('\n')}`);
      totalTokens += semanticUsed;
    }
  }

  // --- Recent Episodic ---
  let episodicUsed = 0;
  if (episodicTraces.length > 0) {
    const episodicLines: string[] = [];
    for (const trace of episodicTraces) {
      const formatted = formatMemoryTrace(trace, style);
      const tokens = estimateTokens(formatted);
      if (episodicUsed + tokens > episodicBudget) break;
      episodicLines.push(formatted);
      episodicUsed += tokens;
      includedIds.push(trace.id);
    }
    if (episodicLines.length > 0) {
      sections.push(`## Recent Experiences\n${episodicLines.join('\n')}`);
      totalTokens += episodicUsed;
    }
  }

  // --- Prospective Alerts (Batch 2) ---
  if (input.prospectiveAlerts?.length) {
    let prospectiveUsed = 0;
    const prospectiveLines: string[] = [];
    for (const alert of input.prospectiveAlerts) {
      const tokens = estimateTokens(alert);
      if (prospectiveUsed + tokens > prospectiveBudget) break;
      prospectiveLines.push(`- ${alert}`);
      prospectiveUsed += tokens;
    }
    if (prospectiveLines.length > 0) {
      sections.push(`## Reminders\n${prospectiveLines.join('\n')}`);
      totalTokens += prospectiveUsed;
    }
  }

  // --- Graph Associations (Batch 2) ---
  if (input.graphContext?.length) {
    let graphUsed = 0;
    const graphLines: string[] = [];
    for (const ctx of input.graphContext) {
      const tokens = estimateTokens(ctx);
      if (graphUsed + tokens > graphBudget) break;
      graphLines.push(`- ${ctx}`);
      graphUsed += tokens;
    }
    if (graphLines.length > 0) {
      sections.push(`## Related Context\n${graphLines.join('\n')}`);
      totalTokens += graphUsed;
    }
  }

  // --- Observation Notes (Batch 2) ---
  if (input.observationNotes?.length) {
    let observationUsed = 0;
    const observationLines: string[] = [];
    for (const note of input.observationNotes) {
      const tokens = estimateTokens(note);
      if (observationUsed + tokens > observationBudget) break;
      observationLines.push(`- ${note}`);
      observationUsed += tokens;
    }
    if (observationLines.length > 0) {
      sections.push(`## Observations\n${observationLines.join('\n')}`);
      totalTokens += observationUsed;
    }
  }

  // --- Involuntary Recall (Cognitive Mechanisms) ---
  if (input.mechanismsEngine && input.allTraces) {
    const retrievedSet = new Set(includedIds);
    const { involuntaryMemory } = input.mechanismsEngine.onPromptAssembly(input.allTraces, retrievedSet);
    if (involuntaryMemory) {
      const formatted = `[spontaneous memory] ${formatMemoryTrace(involuntaryMemory, style)}`;
      const tokens = estimateTokens(formatted);
      if (totalTokens + tokens <= budget) {
        sections.push(`## Something This Reminds Me Of\n${formatted}`);
        totalTokens += tokens;
        includedIds.push(involuntaryMemory.id);
      }
    }
  }

  return {
    contextText: sections.join('\n\n'),
    tokensUsed: totalTokens,
    allocation: alloc,
    includedMemoryIds: includedIds,
  };
}
