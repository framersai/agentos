/**
 * @fileoverview Per-model output-token ceilings for the OpenAI-family
 * models whose maximum completion length sits BELOW the large-output
 * requests agentos issues for flagship models (e.g. 32000 tokens sized
 * for Claude Opus).
 *
 * The OpenAI and OpenRouter providers clamp `max_tokens` /
 * `max_completion_tokens` through {@link clampMaxOutputTokens} so a
 * request sized for a bigger model is not rejected when the fallback
 * chain routes to gpt-4o, gpt-4o-mini, gpt-4-turbo, etc. with HTTP 400:
 *
 *   max_tokens is too large: 32000. This model supports at most 16384
 *   completion tokens, whereas you provided 32000.
 *
 * This is a per-model capability check, not an unconditional drop: the
 * request is reshaped to the model's real ceiling rather than discarded.
 */

/**
 * Maximum completion tokens for the OpenAI-family models whose output
 * ceiling sits below typical large-output requests.
 *
 * Returns `undefined` for any model whose ceiling is at or above the
 * largest request agentos issues (gpt-4.1 = 32768, the o-series, gpt-5)
 * and for every non-OpenAI or unknown id. Callers leave `maxTokens`
 * untouched in that case so a capable model is never truncated.
 *
 * Provider prefixes used by OpenRouter (e.g. `openai/gpt-4o`) are stripped
 * before matching, and matching is case-insensitive.
 *
 * @param modelId Model identifier, with or without an OpenRouter
 *   `provider/` prefix (e.g. `'gpt-4o'`, `'openai/gpt-4o-mini'`).
 * @returns The model's output-token ceiling, or `undefined` when no clamp
 *   is needed.
 */
export function openAiFamilyMaxOutputTokens(modelId: string): number | undefined {
  // Strip a single leading `provider/` segment (OpenRouter ids).
  const id = modelId.toLowerCase().replace(/^[^/]+\//, '');

  // gpt-4o, gpt-4o-mini, gpt-4o-<date>, chatgpt-4o-latest: 16384 ceiling.
  if (/^(gpt-4o|chatgpt-4o)/.test(id)) return 16384;
  // gpt-4-turbo and dated turbo snapshots: 4096.
  if (/^gpt-4-turbo/.test(id)) return 4096;
  // gpt-3.5-turbo and variants: 4096.
  if (/^gpt-3\.5/.test(id)) return 4096;

  return undefined;
}

/**
 * Clamp a requested `maxTokens` to the target model's output ceiling when
 * that ceiling is known to be lower than the request.
 *
 * Returns the request unchanged (including `undefined`) when no clamp is
 * needed, so callers can write
 * `clampMaxOutputTokens(model, options.maxTokens) ?? DEFAULT`.
 *
 * @param modelId Target model identifier (OpenRouter prefixes allowed).
 * @param requested The caller's requested completion-token budget.
 * @returns The clamped budget, or `requested` verbatim when no lower
 *   ceiling applies.
 */
export function clampMaxOutputTokens(
  modelId: string,
  requested: number | undefined,
): number | undefined {
  if (requested === undefined) return undefined;
  const ceiling = openAiFamilyMaxOutputTokens(modelId);
  return ceiling !== undefined ? Math.min(requested, ceiling) : requested;
}
