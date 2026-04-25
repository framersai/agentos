/**
 * @file sessionSummarizer.ts
 * @description One-shot session summarizer using the verbatim Anthropic
 * Contextual Retrieval prompt. Source:
 * platform.claude.com/cookbook/capabilities-contextual-embeddings-guide.
 *
 * Cost model (per Anthropic): ~$0.003 per session at gpt-5-mini, fully
 * cached after first run via {@link SummarizedIngestExecutor}'s
 * per-sessionId cache.
 *
 * @module @framers/agentos/ingest-router/executors/sessionSummarizer
 */

import type { SessionContent, SummarizerLLM } from './types.js';

/**
 * Verbatim Anthropic Contextual Retrieval prompt. Two phrases are
 * load-bearing: "situate this" identifies the recipe lineage, and
 * "Answer only with the succinct context" prevents the model from
 * adding preambles that pollute the embedding text. Asserted in
 * sessionSummarizer.test.ts to prevent silent prompt drift.
 */
export const ANTHROPIC_CONTEXTUAL_PROMPT = `You are summarizing a conversation session for retrieval. Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else.`;

/**
 * Run one summarize call against a session. Returns a structured result
 * with the trimmed summary plus token usage for cost accounting.
 *
 * Caller-supplied {@link SummarizerLLM} is provider-agnostic; the
 * shipping config wires gpt-5-mini for single-OpenAI-key reproducibility.
 */
export async function summarizeSession(
  session: SessionContent,
  opts: { llm: SummarizerLLM; maxSummaryTokens?: number },
): Promise<{
  sessionId: string;
  summary: string;
  tokensIn: number;
  tokensOut: number;
}> {
  const maxTokens = opts.maxSummaryTokens ?? 100;
  const result = await opts.llm.invoke({
    system: ANTHROPIC_CONTEXTUAL_PROMPT,
    user: session.text,
    maxTokens,
    temperature: 0,
  });
  return {
    sessionId: session.sessionId,
    summary: result.text.trim(),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
