/**
 * @file classifier.ts
 * @description LLM-as-judge classifier that maps a query+evidence pair
 * to one of the five {@link ReadIntent} values.
 *
 * @module @framers/agentos/read-router/classifier
 */

import { READ_INTENTS, type ReadIntent } from './routing-tables.js';

// ============================================================================
// LLM adapter
// ============================================================================

export interface ReadIntentClassifierLLMRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface ReadIntentClassifierLLMResponse {
  readonly text: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export interface IReadIntentClassifierLLM {
  invoke(
    request: ReadIntentClassifierLLMRequest,
  ): Promise<ReadIntentClassifierLLMResponse>;
}

// ============================================================================
// Classifier interface
// ============================================================================

export interface ReadIntentClassifierClassifyOptions {
  readonly useFewShotPrompt?: boolean;
}

export interface ReadIntentClassifierResult {
  readonly intent: ReadIntent;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export interface IReadIntentClassifier {
  classify(
    query: string,
    evidence: readonly string[],
    options?: ReadIntentClassifierClassifyOptions,
  ): Promise<ReadIntentClassifierResult>;
}

// ============================================================================
// Prompts
// ============================================================================

export const READ_INTENT_CLASSIFIER_SYSTEM_PROMPT = `You are classifying a user query (with retrieved evidence) into one of five read intents.

Return ONLY the intent token (no explanation, no quotes, no punctuation).

Intents:
- precise-fact: the user wants a specific named entity, number, date, or fact. Examples: "What is X's email?", "When was the last release?"
- multi-source-synthesis: the answer requires combining information from multiple evidence chunks. Examples: "Summarize all the topics we discussed", "Aggregate counts across sessions."
- time-interval: the query asks about durations, orderings, or "how long ago / before / after" timing. Examples: "How many days since X?", "In what order did Y, Z, W happen?"
- preference-recommendation: the user wants tips, suggestions, advice, or recommendations grounded in their own context. Examples: "Any tips for X?", "Can you suggest Y?"
- abstention-candidate: the question may be unanswerable from the evidence. Adversarial or off-topic. Examples: "Where did I move to last year?" when no move is in evidence.`;

export const READ_INTENT_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT = `You are classifying a user query (with retrieved evidence) into one of five read intents.

Return ONLY the intent token (no explanation, no quotes, no punctuation).

Intents:
- precise-fact: a specific named entity, number, date, or fact.
- multi-source-synthesis: combining information across multiple evidence chunks.
- time-interval: durations, orderings, or "how long ago".
- preference-recommendation: tips / suggestions / advice grounded in user context.
- abstention-candidate: question may be unanswerable from evidence.

Examples:

Question: What was my final boss's name in the game I played last week?
Intent: precise-fact

Question: What topics did we discuss across our last five conversations?
Intent: multi-source-synthesis

Question: How many weeks have passed since I started the new job?
Intent: time-interval

Question: Any tips for improving my morning routine?
Intent: preference-recommendation

Question: Where did I move to four years ago?
Intent: abstention-candidate`;

export const SAFE_READ_INTENT_FALLBACK: ReadIntent = 'multi-source-synthesis';

export function normalizeReadIntentClassifierOutput(raw: string): string {
  const lines = raw.split('\n');
  let firstLine = '';
  for (const ln of lines) {
    if (ln.trim().length > 0) {
      firstLine = ln;
      break;
    }
  }
  let cleaned = firstLine.trim().toLowerCase();
  cleaned = cleaned.replace(/^(intent|category|type|answer|label|class)\s*[:\-=]\s*/, '');
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/[.,;!?]+$/g, '');
  return cleaned.trim();
}

export function parseReadIntentClassifierOutput(raw: string): ReadIntent {
  const cleaned = normalizeReadIntentClassifierOutput(raw);
  for (const token of READ_INTENTS) {
    if (
      cleaned === token ||
      cleaned.startsWith(`${token} `) ||
      cleaned.startsWith(`${token}\n`)
    ) {
      return token;
    }
  }
  return SAFE_READ_INTENT_FALLBACK;
}

// ============================================================================
// Reference implementation
// ============================================================================

export interface LLMReadIntentClassifierOptions {
  readonly llm: IReadIntentClassifierLLM;
  readonly maxTokens?: number;
  /** Max evidence-preview chars forwarded to the classifier. Default 600. */
  readonly maxEvidenceChars?: number;
}

export class LLMReadIntentClassifier implements IReadIntentClassifier {
  private readonly llm: IReadIntentClassifierLLM;
  private readonly maxTokens: number;
  private readonly maxEvidenceChars: number;

  constructor(options: LLMReadIntentClassifierOptions) {
    this.llm = options.llm;
    this.maxTokens = options.maxTokens ?? 16;
    this.maxEvidenceChars = options.maxEvidenceChars ?? 600;
  }

  async classify(
    query: string,
    evidence: readonly string[],
    options?: ReadIntentClassifierClassifyOptions,
  ): Promise<ReadIntentClassifierResult> {
    const system = options?.useFewShotPrompt
      ? READ_INTENT_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT
      : READ_INTENT_CLASSIFIER_SYSTEM_PROMPT;
    const evidencePreview = evidence
      .join('\n---\n')
      .slice(0, this.maxEvidenceChars);
    const user = `Question: ${query}\n\nEvidence (preview):\n${evidencePreview}\n\nIntent:`;

    const response = await this.llm.invoke({
      system,
      user,
      maxTokens: this.maxTokens,
      temperature: 0,
    });

    return {
      intent: parseReadIntentClassifierOutput(response.text),
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      model: response.model,
    };
  }
}
