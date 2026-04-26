/**
 * @file TypedNetworkObserver.ts
 * @description LLM-driven extractor that turns a conversation block
 * into 0+ {@link TypedFact}s. Wraps the 6-step extraction prompt and
 * the zod-validated parsing of the LLM's structured-output response.
 *
 * Production wiring: a typical caller constructs the observer once per
 * pipeline (re-using the same `gpt-5-mini` adapter), then invokes
 * {@link TypedNetworkObserver.extract} per session. The returned facts
 * are then upserted into a {@link TypedNetworkStore} and embedded by
 * the host's {@link IEmbeddingManager}.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/TypedNetworkObserver
 */

import { TypedExtractionSchema } from './prompts/extraction-schema.js';
import {
  TYPED_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from './prompts/extraction-prompt.js';
import type { TypedFact } from './types.js';

/**
 * Provider-agnostic LLM interface for the extractor. Matches the
 * shape used elsewhere in agentos for classifier / observer LLM
 * adapters: a single `invoke(args)` async method returning the raw
 * text response. Implementations wrap OpenAI, Anthropic, local
 * models, or test mocks.
 */
export interface ITypedExtractionLLM {
  invoke(args: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<string>;
}

/**
 * Construction options for the observer.
 */
export interface TypedNetworkObserverOptions {
  /** LLM adapter implementing the 6-step extraction call. */
  llm: ITypedExtractionLLM;
  /** Max output tokens. Default 4096 (Hindsight extractions are typically 50-200 facts × ~30 tokens each). */
  maxTokens?: number;
  /** Temperature. Default 0 for deterministic extraction. */
  temperature?: number;
}

/**
 * The 6-step extractor. Stateless aside from its constructor options;
 * safe to share across concurrent extractions.
 */
export class TypedNetworkObserver {
  private readonly llm: ITypedExtractionLLM;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(options: TypedNetworkObserverOptions) {
    this.llm = options.llm;
    this.maxTokens = options.maxTokens ?? 4096;
    this.temperature = options.temperature ?? 0;
  }

  /**
   * Extract typed facts from a conversation block. Uses the 6-step
   * prompt + zod-validated parsing. The resulting facts have stable
   * IDs of the form `<sessionId>-fact-<index>` so re-extraction
   * against the same content reproduces the same IDs.
   *
   * @param sessionText - Full conversation text. Will be wrapped in
   *   the user prompt's delimiters automatically.
   * @param sessionId - Stable identifier used to namespace the
   *   resulting fact IDs.
   * @returns Array of {@link TypedFact}s, possibly empty.
   * @throws ZodError if the LLM output fails schema validation.
   * @throws SyntaxError if the LLM output is not valid JSON.
   */
  async extract(sessionText: string, sessionId: string): Promise<TypedFact[]> {
    const raw = await this.llm.invoke({
      system: TYPED_EXTRACTION_SYSTEM_PROMPT,
      user: buildExtractionUserPrompt(sessionText),
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    });
    // Strip markdown code fences if the LLM wraps the JSON in them
    // (some models do this even with explicit "no commentary" prompts).
    const stripped = stripCodeFence(raw);
    const json = JSON.parse(stripped);
    const parsed = TypedExtractionSchema.parse(json);
    return parsed.facts.map((f, idx) => ({
      id: `${sessionId}-fact-${idx}`,
      bank: f.bank,
      text: f.text,
      embedding: [],
      temporal: f.temporal,
      participants: f.participants,
      reasoningMarkers: f.reasoning_markers,
      entities: f.entities,
      confidence: f.confidence,
    }));
  }
}

/**
 * Strip leading/trailing markdown code fences. Tolerates both
 * triple-backtick-with-language and bare triple-backtick wrappers.
 */
function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  // Drop the opening ``` (with or without language tag) and any trailing ```
  const withoutOpen = trimmed.replace(/^```(?:json|JSON)?\s*\n?/, '');
  return withoutOpen.replace(/\n?```\s*$/, '');
}
