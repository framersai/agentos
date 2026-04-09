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
import { DEFAULT_BUDGET_ALLOCATION } from '../config.js';
import { formatMemoryTrace } from './MemoryFormatters.js';
// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ---------------------------------------------------------------------------
// Personality → formatting style
// ---------------------------------------------------------------------------
const clamp01 = (v) => v == null ? 0.5 : Math.max(0, Math.min(1, v));
/**
 * Select the memory formatting style based on HEXACO personality traits.
 * Highest trait wins: conscientiousness → structured, openness → narrative,
 * emotionality → emotional. Ties favor structured > narrative > emotional.
 *
 * @param traits - HEXACO personality traits
 * @returns Formatting style for memory trace presentation
 */
function selectFormattingStyle(traits) {
    const c = clamp01(traits.conscientiousness);
    const o = clamp01(traits.openness);
    const e = clamp01(traits.emotionality);
    // Highest trait wins
    if (c >= o && c >= e)
        return 'structured';
    if (o >= c && o >= e)
        return 'narrative';
    return 'emotional';
}
/**
 * Build the memory usage preamble that teaches the LLM how to use
 * each memory type differently in its response.
 *
 * This preamble is critical for memory-aware behavior. Without it,
 * LLMs treat all memory sections as flat context and may announce
 * facts, list memories, or state relationships explicitly — all of
 * which feel unnatural.
 *
 * Personality variants add style-specific guidance:
 * - Structured (high conscientiousness): logical, organized references
 * - Narrative (high openness): flowing, associative references
 * - Emotional (high emotionality): empathetic, mood-aware references
 *
 * @param traits - HEXACO traits for personality-aware variant selection
 * @returns Formatted preamble string (~200 tokens)
 */
function buildMemoryPreamble(traits) {
    const style = selectFormattingStyle(traits);
    // Personality-specific guidance on how to reference memories in conversation
    const styleGuidance = style === 'structured'
        ? '\nOrganize your references to past knowledge logically. Connect facts to the current discussion with clear reasoning.'
        : style === 'narrative'
            ? '\nLet memories flow into your responses as stories and associations. Draw creative connections between past and present.'
            : '\nLet emotional memories influence your mood and empathy. If you recall a time the user was struggling, let that inform your warmth now.';
    return `## How To Use Your Memories

- **Working Memory**: Reference directly — this is your active context.
- **Semantic Recall** (facts): Background truth. Don't announce — let it shape responses naturally.
- **Episodic Memories** (experiences): Weave in naturally. Never list.
- **Prospective Alerts** (reminders): Act on these. Bring up naturally.
- **Relational Signals** (trust/bonds): Modulate TONE, not words. Never state explicitly.
- **Graph Associations** (connected memories): Use for richer context and connection depth.
- **Partial Memories** (feeling-of-knowing): Express uncertainty naturally — "I feel like we talked about..."
${styleGuidance}`;
}
/**
 * Assemble memory context into a single formatted string within
 * the given token budget, with overflow redistribution.
 */
export function assembleMemoryContext(input) {
    const alloc = {
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
    const sections = [];
    const includedIds = [];
    let totalTokens = 0;
    // --- Memory Usage Preamble ---
    // Teaches the LLM how to use each memory type differently (~200 tokens).
    // Deducted from total budget before section allocation. Skipped when
    // budget is too small to fit the preamble meaningfully.
    const preamble = buildMemoryPreamble(input.traits);
    const preambleTokens = estimateTokens(preamble);
    if (budget >= preambleTokens + 100) {
        sections.push(preamble);
        totalTokens += preambleTokens;
    }
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
        sections.push(`## Active Context (in focus — reference directly)\n${wmText}`);
        wmUsed = wmTokens;
        totalTokens += wmUsed;
    }
    const wmOverflow = wmBudget - wmUsed;
    // --- Separate episodic and semantic traces ---
    const episodicTraces = [];
    const semanticTraces = [];
    for (const trace of input.retrievedTraces ?? []) {
        if (trace.type === 'episodic') {
            episodicTraces.push(trace);
        }
        else {
            semanticTraces.push(trace);
        }
    }
    // --- Semantic Recall (gets overflow from WM and unused Batch 2 sections) ---
    semanticBudget += wmOverflow;
    // If Batch 2 sections are empty, their budgets flow to semantic
    if (!input.prospectiveAlerts?.length)
        semanticBudget += prospectiveBudget;
    if (!input.graphContext?.length)
        semanticBudget += graphBudget;
    if (!input.observationNotes?.length)
        semanticBudget += observationBudget;
    let semanticUsed = 0;
    if (semanticTraces.length > 0) {
        const semanticLines = [];
        for (const trace of semanticTraces) {
            const formatted = formatMemoryTrace(trace, style);
            const tokens = estimateTokens(formatted);
            if (semanticUsed + tokens > semanticBudget)
                break;
            semanticLines.push(formatted);
            semanticUsed += tokens;
            includedIds.push(trace.id);
        }
        if (semanticLines.length > 0) {
            sections.push(`## Relevant Memories (facts — use as background truth, don't announce)\n${semanticLines.join('\n')}`);
            totalTokens += semanticUsed;
        }
    }
    // --- Recent Episodic ---
    let episodicUsed = 0;
    if (episodicTraces.length > 0) {
        const episodicLines = [];
        for (const trace of episodicTraces) {
            const formatted = formatMemoryTrace(trace, style);
            const tokens = estimateTokens(formatted);
            if (episodicUsed + tokens > episodicBudget)
                break;
            episodicLines.push(formatted);
            episodicUsed += tokens;
            includedIds.push(trace.id);
        }
        if (episodicLines.length > 0) {
            sections.push(`## Recent Experiences (events — weave in naturally, never list)\n${episodicLines.join('\n')}`);
            totalTokens += episodicUsed;
        }
    }
    // --- Prospective Alerts (Batch 2) ---
    if (input.prospectiveAlerts?.length) {
        let prospectiveUsed = 0;
        const prospectiveLines = [];
        for (const alert of input.prospectiveAlerts) {
            const tokens = estimateTokens(alert);
            if (prospectiveUsed + tokens > prospectiveBudget)
                break;
            prospectiveLines.push(`- ${alert}`);
            prospectiveUsed += tokens;
        }
        if (prospectiveLines.length > 0) {
            sections.push(`## Reminders (act on these — bring up naturally)\n${prospectiveLines.join('\n')}`);
            totalTokens += prospectiveUsed;
        }
    }
    // --- Graph Associations (Batch 2) ---
    if (input.graphContext?.length) {
        let graphUsed = 0;
        const graphLines = [];
        for (const ctx of input.graphContext) {
            const tokens = estimateTokens(ctx);
            if (graphUsed + tokens > graphBudget)
                break;
            graphLines.push(`- ${ctx}`);
            graphUsed += tokens;
        }
        if (graphLines.length > 0) {
            sections.push(`## Related Context (connected memories — use for depth)\n${graphLines.join('\n')}`);
            totalTokens += graphUsed;
        }
    }
    // --- Observation Notes (Batch 2) ---
    if (input.observationNotes?.length) {
        let observationUsed = 0;
        const observationLines = [];
        for (const note of input.observationNotes) {
            const tokens = estimateTokens(note);
            if (observationUsed + tokens > observationBudget)
                break;
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
//# sourceMappingURL=MemoryPromptAssembler.js.map