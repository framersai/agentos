/**
 * @file provider-priority.ts
 *
 * Module-level override for the auto-detect provider priority chain
 * (see `provider-defaults.ts` → `AUTO_DETECT_ORDER`). When set, the
 * custom order replaces the hardcoded default for every subsequent
 * `autoDetectProvider()` call until cleared.
 *
 * Resolution priority (highest first):
 *   1. Inline `provider` / `apiKey` on the call.
 *   2. Module-level default via `setDefaultProvider()`.
 *   3. Auto-detect chain — uses the custom priority list if one was
 *      installed via `setProviderPriority()`, otherwise the default.
 *
 * Empty arrays are accepted and disable auto-detection entirely (the
 * caller has opted out). Pass `undefined` (or call `clearProviderPriority`)
 * to revert to the default order.
 */

import { PROVIDER_DEFAULTS } from './provider-defaults.js';

let _customPriority: readonly string[] | undefined;

/**
 * Set a custom provider priority order for auto-detection. The first
 * provider in the list whose env var (or CLI binary) is available will
 * be picked. Providers not in the list are skipped entirely — pass the
 * full set you want considered.
 *
 * Throws if any provider id is unknown to the runtime (typo guard).
 *
 * @example
 * ```ts
 * import { setProviderPriority, generateText } from '@framers/agentos';
 *
 * // Prefer Anthropic over OpenAI even if both keys are set:
 * setProviderPriority(['anthropic', 'openai', 'ollama']);
 *
 * const { text } = await generateText({ prompt: 'hi' });
 * ```
 */
export function setProviderPriority(providers?: readonly string[]): void {
  if (providers === undefined) {
    _customPriority = undefined;
    return;
  }
  const unknown = providers.filter((p) => !PROVIDER_DEFAULTS[p]);
  if (unknown.length > 0) {
    throw new Error(
      `Unknown provider(s) in priority list: ${unknown.join(', ')}. ` +
        `Known providers: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}.`
    );
  }
  _customPriority = providers;
}

/**
 * Returns the current custom priority list, or `undefined` if the default
 * order is in effect.
 */
export function getProviderPriority(): readonly string[] | undefined {
  return _customPriority;
}

/** Reset to the default auto-detect priority order. */
export function clearProviderPriority(): void {
  _customPriority = undefined;
}
