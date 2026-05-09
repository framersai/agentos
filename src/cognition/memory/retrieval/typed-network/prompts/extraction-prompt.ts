/**
 * @file extraction-prompt.ts
 * @description The 6-step extraction prompt for the Hindsight 4-network
 * typed observer. The system prompt defines the six decomposition
 * steps verbatim from Hindsight §2.3 (coreference resolution, temporal
 * normalization, participant attribution, reasoning preservation, fact
 * type classification, entity extraction). The user prompt frames the
 * conversation as a single block and asks the model to emit structured
 * JSON conforming to {@link TypedExtractionSchema}.
 *
 * @module @framers/agentos/memory/retrieval/typed-network/prompts/extraction-prompt
 */

/**
 * System prompt for the 6-step extraction. Verbatim from Hindsight
 * §2.3 with one omission: the spec doesn't include the "do not
 * commentate" line, but the LLM tends to drift into prose without it,
 * which breaks JSON parsing. Included.
 */
export const TYPED_EXTRACTION_SYSTEM_PROMPT = `You are an information extractor for a typed memory network. Process the conversation below into structured facts.

For each fact, perform these six steps:

1. COREFERENCE: resolve "he/she/they/it/this/that" to the actual referent.
2. TEMPORAL: normalize times to ISO 8601. Extract ranges as (start, end) when applicable.
3. PARTICIPANTS: list every named participant and their role.
4. REASONING: preserve any explicit reasoning marker (because, since, therefore, etc.) verbatim.
5. FACT TYPE: classify into ONE of:
   - WORLD: objective facts about the external world
   - EXPERIENCE: biographical / first-person events
   - OPINION: claims with confidence < 1.0
   - OBSERVATION: preference-neutral summaries of entities
6. ENTITIES: list every named entity (proper nouns, organizations, places, products).

Output JSON matching the schema strictly. Do not add commentary.`;

/**
 * Build the user prompt for a single conversation block. Wraps the
 * source text in delimiters that resist accidental inline-injection
 * if the conversation contains JSON-looking content.
 *
 * @param sessionText - The conversation text to extract from. Whole
 *   session passed as one block; the model decomposes per turn
 *   internally.
 */
export function buildExtractionUserPrompt(sessionText: string): string {
  return `CONVERSATION:\n<<<\n${sessionText}\n>>>`;
}
