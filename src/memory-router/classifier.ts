/**
 * @file classifier.ts
 * @description The LLM-as-judge classifier that the {@link MemoryRouter}
 * uses to pick a {@link MemoryQueryCategory} for each incoming query.
 *
 * The classifier is deliberately abstracted behind {@link IMemoryClassifier}
 * so callers can swap:
 *   - the LLM client (any provider — OpenAI, Anthropic, local, mock) via
 *     the {@link IMemoryClassifierLLM} adapter interface,
 *   - the prompt variant (base vs few-shot) per-call,
 *   - the classifier implementation entirely (e.g. a keyword-matcher or a
 *     small custom ML model) by implementing {@link IMemoryClassifier}.
 *
 * The reference implementation, {@link LLMMemoryClassifier}, runs the
 * gpt-5-mini-style cheap single-shot discriminator prompt and robustly
 * parses the output, falling back to `multi-session` on unparseable
 * responses (the safest default — multi-session routes cover cross-session
 * synthesis which handles most misidentified question types gracefully).
 *
 * @module @framers/agentos/memory-router/classifier
 */

import {
  MEMORY_QUERY_CATEGORIES,
  type MemoryQueryCategory,
} from './routing-tables.js';

// ============================================================================
// LLM adapter interface
// ============================================================================

/**
 * Minimal LLM-call interface the built-in classifier needs. Agentos
 * consumers wire their preferred provider to this shape via an adapter
 * — we intentionally do NOT import any provider SDK here so the
 * memory-router module stays provider-agnostic.
 */
export interface MemoryClassifierLLMRequest {
  /** System prompt. The classifier supplies this based on prompt variant. */
  readonly system: string;
  /** User prompt. The classifier renders `Question: {q}\n\nCategory:`. */
  readonly user: string;
  /** Max tokens to generate. Classifier passes ≤16 (bare category token). */
  readonly maxTokens: number;
  /** Temperature. Classifier passes 0 for determinism. */
  readonly temperature: number;
}

/**
 * Response shape the built-in classifier expects from the adapter.
 */
export interface MemoryClassifierLLMResponse {
  /** The model's raw text. Whitespace is tolerated; the parser normalizes it. */
  readonly text: string;
  /** Input token count, for cost tracking. */
  readonly tokensIn: number;
  /** Output token count, for cost tracking. */
  readonly tokensOut: number;
  /** Model identifier the LLM reports. */
  readonly model: string;
}

/**
 * The LLM-client adapter the built-in classifier expects. Adapt any
 * provider SDK (OpenAI, Anthropic, a provider-router, a mock) to this
 * shape before passing into {@link LLMMemoryClassifier}.
 */
export interface IMemoryClassifierLLM {
  invoke(
    request: MemoryClassifierLLMRequest,
  ): Promise<MemoryClassifierLLMResponse>;
}

// ============================================================================
// Classifier interface + options
// ============================================================================

/**
 * Options passed per-call to {@link IMemoryClassifier.classify}. The
 * classifier reads these to pick a prompt variant; everything else is
 * constructor-scoped.
 */
export interface MemoryClassifierClassifyOptions {
  /**
   * Use the few-shot prompt variant instead of the base prompt. The
   * few-shot prompt includes explicit Question/Category pairs targeting
   * known confusion patterns (SSU-vs-SSA, SSP-vs-SSA, MS-vs-KU). Default
   * false — the base prompt is ~2.5x cheaper per-classification-token and
   * matches the shipping Tier 3 v10 classifier configuration.
   */
  readonly useFewShotPrompt?: boolean;
}

/**
 * Result of a classification call. The returned category is always a
 * valid {@link MemoryQueryCategory}; parse failures map to the safe
 * fallback 'multi-session'.
 */
export interface MemoryClassifierResult {
  readonly category: MemoryQueryCategory;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

/**
 * The public classifier contract. Implementations decide how to turn a
 * query into a category — via LLM, keyword heuristic, small ML model, or
 * mock.
 */
export interface IMemoryClassifier {
  classify(
    query: string,
    options?: MemoryClassifierClassifyOptions,
  ): Promise<MemoryClassifierResult>;
}

// ============================================================================
// Prompts
// ============================================================================

/**
 * Base classifier prompt. Lists the six category tokens with one-sentence
 * definitions and a few examples per category, then instructs the model
 * to emit ONLY the bare category token.
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are classifying a memory-system question into one of six categories.

Return ONLY the category token (no explanation, no quotes, no punctuation).

Categories:
- single-session-user: the question asks about something the USER said, did, or stated in a specific past session. Answer is in one session. Examples: "What did I tell you about my favorite dessert?", "Where did I say I moved to last month?"
- single-session-assistant: the question asks about something the ASSISTANT said, generated, or recommended in a specific session. Answer is in one session. Examples: "What recipe did you suggest for the birthday party?", "What books did you recommend to me?"
- single-session-preference: the question asks about a preference the user stated in passing. Answer is in one session. Examples: "Do I prefer tea or coffee?", "What's my favorite type of movie?"
- knowledge-update: the question asks about current state where the answer EVOLVED across sessions (supersession). Examples: "What's my current job title?", "Where do I live now?", "What's my latest project?"
- multi-session: the question requires combining information from 2+ separate sessions. Examples: "How many different languages have I mentioned studying?", "Which authors did you recommend across our conversations?"
- temporal-reasoning: the question asks about the order, timing, or duration of events across time. Examples: "In what order did I visit the three countries?", "How many months ago did I start the new job?"`;

/**
 * Few-shot variant of the classifier prompt. Adds explicit
 * Question/Category pairs targeting confusion patterns observed in the
 * gpt-5-mini base-prompt classifier on LongMemEval Tier A:
 *   - SSA confused as SSU (YOU-said vs I-said distinction)
 *   - SSP confused as SSA (preferences phrased like recommendations)
 *   - MS confused as KU (cross-session vs current-state)
 *
 * Used when {@link MemoryClassifierClassifyOptions.useFewShotPrompt} is true.
 */
export const CLASSIFIER_SYSTEM_PROMPT_FEWSHOT = `You are classifying a memory-system question into one of six categories.

Return ONLY the category token (no explanation, no quotes, no punctuation).

Categories:
- single-session-user: the question asks about something the USER said, did, or stated in a specific past session. Answer is in one session.
- single-session-assistant: the question asks about something the ASSISTANT said, generated, or recommended in a specific session. Answer is in one session.
- single-session-preference: the question asks about a preference the user stated in passing. Answer is in one session.
- knowledge-update: the question asks about current state where the answer EVOLVED across sessions (supersession). The user wants the LATEST value of an attribute that has changed over time.
- multi-session: the question requires combining information from 2+ separate sessions. Counting, listing, or aggregating items the user mentioned across sessions.
- temporal-reasoning: the question asks about the order, timing, or duration of events across time.

Examples:

Question: What did I tell you my favorite ice cream flavor was?
Category: single-session-user

Question: Where did I say I moved to last month?
Category: single-session-user

Question: What book did you recommend to me last week?
Category: single-session-assistant

Question: What recipe did you suggest for the birthday party?
Category: single-session-assistant

Question: Do I prefer working in the morning or evening?
Category: single-session-preference

Question: What's my favorite type of movie?
Category: single-session-preference

Question: What's my current job title?
Category: knowledge-update

Question: Where do I live now?
Category: knowledge-update

Question: How many different programming languages have I mentioned learning?
Category: multi-session

Question: Which authors have you recommended to me across our conversations?
Category: multi-session

Question: In what order did I visit the three European cities?
Category: temporal-reasoning

Question: How many weeks ago did I start the new job?
Category: temporal-reasoning`;

// ============================================================================
// Parser
// ============================================================================

/**
 * Default fallback category used when the classifier's LLM output cannot
 * be parsed into a known category token. multi-session is chosen because
 * its routing target (OM-based cross-session synthesis under max-accuracy,
 * canonical-hybrid under min-cost) degrades gracefully on most other
 * question types.
 */
export const SAFE_FALLBACK_CATEGORY: MemoryQueryCategory = 'multi-session';

/**
 * Strips common LLM-output decorations so the parser can match the bare
 * category token:
 *   - keeps only the first non-empty line,
 *   - strips common label prefixes ("category:", "type:", "answer:"),
 *   - strips surrounding quotes / backticks,
 *   - strips trailing sentence punctuation,
 *   - lower-cases the result.
 */
export function normalizeClassifierOutput(raw: string): string {
  // First non-empty line only — models occasionally emit multi-line explanations.
  const lines = raw.split('\n');
  let firstLine = '';
  for (const ln of lines) {
    if (ln.trim().length > 0) {
      firstLine = ln;
      break;
    }
  }
  let cleaned = firstLine.trim().toLowerCase();
  cleaned = cleaned.replace(/^(category|type|answer|label|class)\s*[:\-=]\s*/, '');
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/[.,;!?]+$/g, '');
  return cleaned.trim();
}

/**
 * Parse a normalized classifier output into a known category token, or
 * return the safe fallback if no match is found.
 */
export function parseClassifierOutput(raw: string): MemoryQueryCategory {
  const cleaned = normalizeClassifierOutput(raw);
  for (const token of MEMORY_QUERY_CATEGORIES) {
    if (
      cleaned === token ||
      cleaned.startsWith(`${token} `) ||
      cleaned.startsWith(`${token}\n`)
    ) {
      return token;
    }
  }
  return SAFE_FALLBACK_CATEGORY;
}

// ============================================================================
// Reference implementation
// ============================================================================

/**
 * Constructor options for {@link LLMMemoryClassifier}.
 */
export interface LLMMemoryClassifierOptions {
  /** LLM adapter the classifier calls. */
  readonly llm: IMemoryClassifierLLM;
  /**
   * Max output tokens. Default 16 — the classifier only needs to emit
   * one bare category token. Callers rarely need to change this.
   */
  readonly maxTokens?: number;
}

/**
 * The built-in LLM-based classifier. Runs the category-discrimination
 * prompt on the configured LLM adapter and parses the response robustly.
 *
 * @example
 * ```ts
 * import { LLMMemoryClassifier } from '@framers/agentos/memory-router';
 *
 * const classifier = new LLMMemoryClassifier({
 *   llm: createOpenAIClassifierAdapter('gpt-5-mini'),
 * });
 * const { category } = await classifier.classify(
 *   "What's my current job title?",
 * );
 * // => { category: 'knowledge-update', tokensIn: 412, tokensOut: 4, model: 'gpt-5-mini-2025-08-07' }
 * ```
 */
export class LLMMemoryClassifier implements IMemoryClassifier {
  private readonly llm: IMemoryClassifierLLM;
  private readonly maxTokens: number;

  constructor(options: LLMMemoryClassifierOptions) {
    this.llm = options.llm;
    this.maxTokens = options.maxTokens ?? 16;
  }

  async classify(
    query: string,
    options?: MemoryClassifierClassifyOptions,
  ): Promise<MemoryClassifierResult> {
    const system = options?.useFewShotPrompt
      ? CLASSIFIER_SYSTEM_PROMPT_FEWSHOT
      : CLASSIFIER_SYSTEM_PROMPT;
    const user = `Question: ${query}\n\nCategory:`;

    const response = await this.llm.invoke({
      system,
      user,
      maxTokens: this.maxTokens,
      temperature: 0,
    });

    return {
      category: parseClassifierOutput(response.text),
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      model: response.model,
    };
  }
}
