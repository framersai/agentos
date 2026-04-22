/**
 * @file memoryProviderHooks.ts
 * Shared helper that wires {@link AgentMemoryProvider} hooks into
 * {@link GenerateTextOptions}.
 *
 * Used by all four agent call paths (`Agent.generate`, `Agent.stream`,
 * `AgentSession.send`, `AgentSession.stream`) to consistently invoke
 * `memory.getContext` before the LLM call and `memory.observe` after.
 * Pure function: returns a new options object without mutating inputs.
 *
 * @module api/runtime/memoryProviderHooks
 */
import type {
  GenerateTextOptions,
  GenerationHookContext,
  GenerationHookResult,
} from '../generateText.js';
import type { AgentMemoryProvider } from '../agent.js';

/** Timeout applied to memory.getContext calls to prevent hangs. */
export const MEMORY_TIMEOUT_MS = 5000;

/** Default token budget forwarded to memory.getContext. */
export const DEFAULT_MEMORY_TOKEN_BUDGET = 2000;

/**
 * Apply memory-provider hooks to an options object.
 *
 * @param baseOpts - The GenerateTextOptions object to wrap.
 * @param provider - Memory provider. When undefined or lacking both
 *   `getContext` and `observe`, returns baseOpts unchanged.
 * @param userText - The user input text for this turn; passed to
 *   getContext and observe('user', ...).
 * @returns A new options object with onBeforeGeneration +
 *   onAfterGeneration wrappers that invoke the memory hooks. Existing
 *   user hooks (if any) are chained AFTER the memory wiring so the
 *   caller's hook sees the memory-augmented context and result.
 */
export function applyMemoryProvider(
  baseOpts: Partial<GenerateTextOptions>,
  provider: AgentMemoryProvider | undefined,
  userText: string,
): Partial<GenerateTextOptions> {
  const hasContext = Boolean(provider?.getContext);
  const hasObserve = Boolean(provider?.observe);
  if (!hasContext && !hasObserve) return baseOpts;

  const userOnBefore = baseOpts.onBeforeGeneration;
  const userOnAfter = baseOpts.onAfterGeneration;

  const wrappedOnBefore: NonNullable<GenerateTextOptions['onBeforeGeneration']> = async (
    ctx: GenerationHookContext,
  ): Promise<GenerationHookContext | void> => {
    let nextCtx: GenerationHookContext = ctx;
    if (hasContext) {
      try {
        const memCtx = await Promise.race([
          provider!.getContext!(userText, { tokenBudget: DEFAULT_MEMORY_TOKEN_BUDGET }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
        ]);
        if (memCtx && 'contextText' in memCtx && memCtx.contextText) {
          nextCtx = {
            ...ctx,
            messages: [
              { role: 'system' as const, content: memCtx.contextText },
              ...ctx.messages,
            ],
          };
        }
      } catch {
        // Memory recall failure is non-fatal; continue with unmodified ctx.
      }
    }
    if (userOnBefore) {
      const userResult = await userOnBefore(nextCtx);
      return userResult ?? nextCtx;
    }
    return nextCtx;
  };

  const wrappedOnAfter: NonNullable<GenerateTextOptions['onAfterGeneration']> = async (
    result: GenerationHookResult,
  ): Promise<GenerationHookResult | void> => {
    if (hasObserve) {
      void provider!.observe!('user', userText).catch(() => {
        /* fire-and-forget */
      });
      if (result.text) {
        void provider!.observe!('assistant', result.text).catch(() => {
          /* fire-and-forget */
        });
      }
    }
    if (userOnAfter) {
      const userResult = await userOnAfter(result);
      return userResult ?? result;
    }
    return result;
  };

  return {
    ...baseOpts,
    onBeforeGeneration: wrappedOnBefore,
    onAfterGeneration: wrappedOnAfter,
  };
}
