/**
 * @fileoverview Forced-tool_choice capability helper for the Anthropic
 * Claude models.
 *
 * Anthropic structured output and `toolChoice: 'required'` both resolve to a
 * FORCED `tool_choice` on the Messages API (`{ type: 'tool', name }` or
 * `{ type: 'any' }`). Most Claude models accept this — it is the gold-standard
 * way to constrain output. Claude Fable 5 is the exception: it REJECTS a forced
 * `tool_choice` at the API level with a 400 ("tool_choice forces tool use is
 * not compatible with this model"). The model can still USE tools, just not be
 * FORCED to; on Fable the choice must be downgraded to `{ type: 'auto' }`.
 *
 * Two consumers read this:
 *   - {@link AnthropicProvider} clamps any resolved forced `tool_choice` to
 *     `auto` for Fable (the same defensive clamp it already applies when
 *     extended thinking is active), so no caller has to remember the quirk.
 *   - {@link generateObject} skips the forced-tool structured-output payload
 *     for Fable and falls through to the prompt-only JSON path instead (the
 *     schema already rides in the system prompt; the result text is
 *     extractJson + safeParse'd in the retry loop), so structured output
 *     gracefully degrades on Fable rather than 400-ing.
 *
 * Sibling of `modelSupportsThinking` / `modelSupportsTemperature`. Kept in its
 * own pure module so the unit test imports no provider/SDK code.
 */

/**
 * Whether Anthropic will accept a FORCED `tool_choice` (`{ type: 'tool' }` or
 * `{ type: 'any' }`) for the given Claude model id.
 *
 * Deny-by-explicit-model: only Claude Fable 5 (and its dated variants like
 * `claude-fable-5-20260601`) rejects forced tool use; every other current
 * Claude model — Sonnet, Opus, Haiku — accepts it. Future models that share
 * the constraint get added to the regex as Anthropic releases them.
 *
 * @param modelId Anthropic-side model id (e.g. `"claude-fable-5"` or
 *   `"claude-sonnet-4-6"`).
 * @returns `false` when Anthropic rejects a forced `tool_choice` for this
 *   model, `true` otherwise.
 */
export function modelSupportsForcedToolChoice(modelId: string): boolean {
  return !/^claude-fable-5\b/i.test(modelId);
}
