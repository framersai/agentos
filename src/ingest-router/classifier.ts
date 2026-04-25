/**
 * @file classifier.ts
 * @description LLM-as-judge classifier that maps a piece of content to
 * one of the six {@link IngestContentKind} values.
 *
 * Same shape as the memory-router classifier, deliberately so Cognitive
 * Pipeline can compose them with one mental model.
 *
 * @module @framers/agentos/ingest-router/classifier
 */

import {
  INGEST_CONTENT_KINDS,
  type IngestContentKind,
} from './routing-tables.js';

// ============================================================================
// LLM adapter
// ============================================================================

export interface IngestClassifierLLMRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface IngestClassifierLLMResponse {
  readonly text: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export interface IIngestClassifierLLM {
  invoke(
    request: IngestClassifierLLMRequest,
  ): Promise<IngestClassifierLLMResponse>;
}

// ============================================================================
// Classifier interface + types
// ============================================================================

export interface IngestClassifierClassifyOptions {
  /** Use the few-shot prompt variant (more accurate on ambiguous content). */
  readonly useFewShotPrompt?: boolean;
}

export interface IngestClassifierResult {
  readonly kind: IngestContentKind;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export interface IIngestClassifier {
  classify(
    content: string,
    options?: IngestClassifierClassifyOptions,
  ): Promise<IngestClassifierResult>;
}

// ============================================================================
// Prompts
// ============================================================================

export const INGEST_CLASSIFIER_SYSTEM_PROMPT = `You are classifying a piece of content into one of six ingest kinds for memory storage.

Return ONLY the kind token (no explanation, no quotes, no punctuation).

Kinds:
- short-conversation: 1-3 turns of chat dialog. Examples: a one-message Q&A, a brief support exchange.
- long-conversation: extended chat sessions across many turns. Examples: a 50-turn coding conversation, a 30-turn customer support thread.
- long-article: prose document over ~500 words. Examples: a blog post, a research paper section, a long email.
- code: source code, configuration files, schemas. Examples: a TypeScript module, a SQL migration, a JSON schema.
- structured-data: tabular or JSON-style records. Examples: a CSV, a JSON list of records, a database export.
- multimodal: content that includes images, video frames, or audio. Examples: a PDF with figures, a presentation slide.`;

export const INGEST_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT = `You are classifying a piece of content into one of six ingest kinds for memory storage.

Return ONLY the kind token (no explanation, no quotes, no punctuation).

Kinds:
- short-conversation: 1-3 turns of chat dialog.
- long-conversation: extended chat sessions across many turns.
- long-article: prose document over ~500 words.
- code: source code, configuration files, schemas.
- structured-data: tabular or JSON-style records.
- multimodal: content that includes images, video frames, or audio.

Examples:

Content: "user: hi\\nassistant: hi! how can I help?"
Kind: short-conversation

Content: "[3000 words of a research paper introduction]"
Kind: long-article

Content: "export function fibonacci(n: number): number { return n < 2 ? n : fibonacci(n-1) + fibonacci(n-2); }"
Kind: code

Content: "[CSV with 50 rows of user records]"
Kind: structured-data

Content: "[40 turns of a customer-support thread]"
Kind: long-conversation

Content: "[image bytes + caption text]"
Kind: multimodal`;

export const SAFE_INGEST_FALLBACK_KIND: IngestContentKind = 'short-conversation';

export function normalizeIngestClassifierOutput(raw: string): string {
  const lines = raw.split('\n');
  let firstLine = '';
  for (const ln of lines) {
    if (ln.trim().length > 0) {
      firstLine = ln;
      break;
    }
  }
  let cleaned = firstLine.trim().toLowerCase();
  cleaned = cleaned.replace(/^(kind|category|type|answer|label|class)\s*[:\-=]\s*/, '');
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/[.,;!?]+$/g, '');
  return cleaned.trim();
}

export function parseIngestClassifierOutput(raw: string): IngestContentKind {
  const cleaned = normalizeIngestClassifierOutput(raw);
  for (const token of INGEST_CONTENT_KINDS) {
    if (
      cleaned === token ||
      cleaned.startsWith(`${token} `) ||
      cleaned.startsWith(`${token}\n`)
    ) {
      return token;
    }
  }
  return SAFE_INGEST_FALLBACK_KIND;
}

// ============================================================================
// Reference implementation
// ============================================================================

export interface LLMIngestClassifierOptions {
  readonly llm: IIngestClassifierLLM;
  readonly maxTokens?: number;
  /**
   * Maximum content characters to forward to the classifier. Most ingest
   * decisions can be made from the first ~1k chars (kind detection
   * doesn't require the full body). Default 1000.
   */
  readonly maxContentChars?: number;
}

export class LLMIngestClassifier implements IIngestClassifier {
  private readonly llm: IIngestClassifierLLM;
  private readonly maxTokens: number;
  private readonly maxContentChars: number;

  constructor(options: LLMIngestClassifierOptions) {
    this.llm = options.llm;
    this.maxTokens = options.maxTokens ?? 16;
    this.maxContentChars = options.maxContentChars ?? 1000;
  }

  async classify(
    content: string,
    options?: IngestClassifierClassifyOptions,
  ): Promise<IngestClassifierResult> {
    const system = options?.useFewShotPrompt
      ? INGEST_CLASSIFIER_SYSTEM_PROMPT_FEWSHOT
      : INGEST_CLASSIFIER_SYSTEM_PROMPT;
    const truncated = content.slice(0, this.maxContentChars);
    const user = `Content: ${truncated}\n\nKind:`;

    const response = await this.llm.invoke({
      system,
      user,
      maxTokens: this.maxTokens,
      temperature: 0,
    });

    return {
      kind: parseIngestClassifierOutput(response.text),
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      model: response.model,
    };
  }
}
