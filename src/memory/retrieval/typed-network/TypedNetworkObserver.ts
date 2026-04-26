/**
 * @file TypedNetworkObserver.ts
 * @description LLM-driven extractor that turns a conversation block
 * into 0+ {@link TypedFact}s. Wraps the 6-step extraction prompt and
 * the tolerant zod parsing of the LLM's structured-output response.
 *
 * Production wiring: a typical caller constructs the observer once per
 * pipeline (re-using the same `gpt-5-mini` adapter), then invokes
 * {@link TypedNetworkObserver.extract} per session. The returned facts
 * are then upserted into a {@link TypedNetworkStore} and embedded by
 * the host's {@link IEmbeddingManager}.
 *
 * **Tolerance design (Phase 4c smoke fix):** the parser accepts the
 * common deviations gpt-5-mini emits at scale, rather than throwing on
 * any deviation:
 *
 * 1. **Code-fence stripping**: triple-backtick fences (with or without
 *    language tag) are removed before JSON parse.
 * 2. **Top-level array auto-wrap**: a bare `[fact, fact]` is wrapped
 *    as `{facts: [...]}` before schema validation.
 * 3. **Per-fact tolerance**: facts are validated one at a time via
 *    `TypedExtractionFactSchema.safeParse`. Bad facts are dropped
 *    silently; good facts in the same response are kept.
 * 4. **Schema-level defaults**: `temporal`, `participants`,
 *    `reasoning_markers`, and `entities` default to sensible empties
 *    when the LLM omits them. `bank` is uppercase-coerced. See
 *    {@link TypedExtractionFactSchema} for the full tolerance surface.
 * 5. **Retry-on-outer-failure**: if the catastrophic outer parse
 *    fails (invalid JSON, primitive value, neither array nor object
 *    with `facts`), the extractor retries once with the validation
 *    error appended to the user prompt. Implements spec section 6's
 *    retry path that was specified but never shipped.
 *
 * The extract method NEVER throws on extractable input; persistent
 * outer failure returns `[]` so the caller can continue ingest.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/TypedNetworkObserver
 */

import { TypedExtractionFactSchema } from './prompts/extraction-schema.js';
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
 * Maximum total LLM invocations per `extract` call. The first attempt
 * uses the base prompt; the second appends the validation error from
 * the first attempt for the model to self-correct against.
 */
const MAX_ATTEMPTS = 2;

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
   * Extract typed facts from a conversation block.
   *
   * Resulting facts have stable IDs of the form
   * `<sessionId>-fact-<index>`, where `<index>` is the sequential
   * POST-DROP position so dropped facts produce contiguous IDs in the
   * returned array.
   *
   * **Never throws on extractable input.** Catastrophic outer parse
   * failures (invalid JSON, primitive value, missing facts key) get
   * one retry; persistent failure returns `[]`. Bad individual facts
   * are dropped silently via per-fact `safeParse`.
   *
   * @param sessionText - Full conversation text. Will be wrapped in
   *   the user prompt's delimiters automatically.
   * @param sessionId - Stable identifier used to namespace the
   *   resulting fact IDs.
   * @returns Array of {@link TypedFact}s, possibly empty.
   */
  async extract(sessionText: string, sessionId: string): Promise<TypedFact[]> {
    const baseUserPrompt = buildExtractionUserPrompt(sessionText);
    let lastValidationError: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // First attempt uses the bare prompt; retry appends the
      // validation error so the model can self-correct.
      const userPrompt =
        lastValidationError === null
          ? baseUserPrompt
          : `${baseUserPrompt}\n\nThe previous response failed validation: ${lastValidationError}\nReturn JSON matching the schema strictly. Do not add commentary.`;

      const raw = await this.llm.invoke({
        system: TYPED_EXTRACTION_SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: this.maxTokens,
        temperature: this.temperature,
      });

      const stripped = stripCodeFence(raw);

      // Parse JSON. SyntaxError captures bad-JSON outer failures into
      // the retry path.
      let json: unknown;
      try {
        json = JSON.parse(stripped);
      } catch (err) {
        lastValidationError = err instanceof Error ? err.message : String(err);
        continue;
      }

      // Auto-wrap top-level array. gpt-5-mini frequently emits a bare
      // facts array instead of `{facts: [...]}`; this recovers the
      // most common deviation.
      const container = Array.isArray(json) ? { facts: json } : json;

      // Outer-shape validation. We accept any object with a `facts`
      // array; per-fact validation runs in `extractFactsFromContainer`.
      if (
        typeof container !== 'object' ||
        container === null ||
        !('facts' in container) ||
        !Array.isArray((container as { facts: unknown }).facts)
      ) {
        lastValidationError =
          'expected JSON object with a "facts" array; got unexpected outer shape';
        continue;
      }

      return extractFactsFromContainer(
        (container as { facts: unknown[] }).facts,
        sessionId,
      );
    }

    // Both attempts failed at the outer layer; return empty rather
    // than throwing so the caller can continue ingest. The caller is
    // responsible for downstream "no typed facts in this session"
    // semantics.
    return [];
  }
}

/**
 * Run per-fact tolerance over a candidate array. Returns only the
 * facts that pass {@link TypedExtractionFactSchema} validation;
 * silently drops the rest. IDs are sequential post-drop indices to
 * keep the output array contiguously addressable.
 */
function extractFactsFromContainer(
  candidates: unknown[],
  sessionId: string,
): TypedFact[] {
  const facts: TypedFact[] = [];
  for (const candidate of candidates) {
    const result = TypedExtractionFactSchema.safeParse(candidate);
    if (!result.success) continue;
    const f = result.data;
    facts.push({
      id: `${sessionId}-fact-${facts.length}`,
      bank: f.bank,
      text: f.text,
      embedding: [],
      temporal: f.temporal,
      participants: f.participants,
      reasoningMarkers: f.reasoning_markers,
      entities: f.entities,
      confidence: f.confidence,
    });
  }
  return facts;
}

/**
 * Strip leading/trailing markdown code fences. Tolerates triple-backtick
 * wrappers with any alphabetic language tag (json, javascript, typescript,
 * etc.) or no tag. Necessary because providers occasionally emit fences
 * even with explicit "no commentary" prompts, and the language tag varies.
 */
function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  // Drop the opening ``` (with or without alphabetic language tag) and any trailing ```
  const withoutOpen = trimmed.replace(/^```([a-zA-Z]+)?\s*\n?/, '');
  return withoutOpen.replace(/\n?```\s*$/, '');
}
