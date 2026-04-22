# Memory Provider Auto-Wire on Direct Agent Calls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to walk this plan task-by-task. Subagents banned per consumer user memory; worktrees banned per consumer user memory. Work directly on master. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent.stream()` and `agent.generate()` auto-invoke `memoryProvider.getContext` + `.observe` when a provider is passed on the agent config, matching `AgentSession.send/.stream` behavior. Type the provider interface. Extract shared wiring helper to eliminate duplication across the four call paths.

**Architecture:** Introduce a pure-function `applyMemoryProvider(baseOpts, provider, userText)` helper that wraps `onBeforeGeneration` and `onAfterGeneration` with memory hooks. All four agent call paths (`Agent.generate`, `Agent.stream`, `AgentSession.send`, `AgentSession.stream`) consume the same helper. Existing session-path tests act as regression coverage; new tests cover the helper's contract + direct-path integration.

**Tech Stack:** TypeScript + vitest. Internal-only helper module; no new npm dependencies. No behavior change for session paths; behavior addition for direct paths.

**Spec:** `docs/superpowers/specs/2026-04-22-memoryprovider-direct-call-autowire-design.md`

**Version target:** agentos `0.1.255 → 0.2.0`

---

## Pre-flight

- [ ] **Step 1: Verify repo tip + baseline.**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos
git fetch origin master
git log --oneline origin/master -5
git log --oneline master -5
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -10
```

Expected: local matches or is ahead of origin; `agentPromptEngine.test.ts` passes with the existing `memoryProvider integration` suite green.

- [ ] **Step 2: Confirm current state matches spec claims.**

```bash
grep -n "memoryProvider" src/api/agent.ts | head -20
```

Expected output includes lines ~134 (`memoryProvider?: any` in `AgentOptions`), ~453 (`opts.memoryProvider?.getContext` in session.send), ~492 (observe in session.send), ~513 (onBeforeGeneration wiring in session.stream), ~551-553 (observe in session.stream). No match for `memoryProvider` between lines 380-438 (the direct-path region).

- [ ] **Step 3: Locate constants + utilities that the helper will reuse.**

Current `MEMORY_TIMEOUT_MS = 5000` lives at `src/api/agent.ts:248`. Current `extractTextFromContent` helper lives at `src/api/generateText.ts:63`. Both stay put; helper imports them.

---

## Task 1: Add `AgentMemoryProvider` interface

**Files:**
- Modify: `src/api/agent.ts` — replace `memoryProvider?: any` type + add interface.
- Test: existing tests must still pass unchanged.

**Scope:** type-only change. No behavior change. No new tests needed because the behavior is still gated by `opts.memoryProvider?.getContext` runtime checks — TypeScript narrows the type but doesn't change runtime semantics.

- [ ] **Step 1: Add the interface near the top of `src/api/agent.ts`** (after the imports block, before `AgentOptions`). Insert at line ~34 (after the `BaseAgentConfig` import on line 32):

```ts
/**
 * Provider hook interface consumed by `agent()` for memory integration.
 *
 * When provided on the agent config, `getContext` is called before each
 * LLM generation to inject retrieved memory into the system prompt, and
 * `observe` is called after each turn to encode the exchange for future
 * recall. Both hooks are optional — implementations may choose to provide
 * read-only or write-only memory behavior.
 *
 * Auto-wires on every agent call path as of AgentOS 0.2.0: direct
 * `agent.stream()` / `.generate()` and `agent.session().send()` / `.stream()`
 * all invoke the hooks when the provider is present.
 */
export interface AgentMemoryProvider {
  /**
   * Retrieve a memory context block to prepend to the system prompt.
   *
   * @param text - The user input for the current turn.
   * @param opts - Retrieval options. `tokenBudget` caps the memory block size.
   * @returns An object whose `contextText` (when present) is injected as a
   *   system message before the LLM call. Returning `null` or an object
   *   without `contextText` skips injection.
   */
  getContext?: (
    text: string,
    opts?: { tokenBudget?: number },
  ) => Promise<{ contextText?: string } | null>;

  /**
   * Record an observation of a turn exchange.
   *
   * Invoked twice per turn (`role: 'user'` with the input, then
   * `role: 'assistant'` with the reply) as fire-and-forget. Rejections
   * are swallowed so memory-backend errors do not break generation.
   *
   * @param role - Whether the content came from the user or assistant.
   * @param text - Plain text content of the turn.
   */
  observe?: (
    role: 'user' | 'assistant',
    text: string,
  ) => Promise<void>;
}
```

- [ ] **Step 2: Replace the `memoryProvider?: any` field in `AgentOptions`** at line 134. Change:

```ts
memoryProvider?: any;
```

to:

```ts
/**
 * Optional memory provider. When provided, memory auto-wires on all four
 * agent call paths (see {@link AgentMemoryProvider} for hook contract).
 *
 * - `getContext` runs before each LLM call; result prepended as a system
 *   message.
 * - `observe` runs after each LLM call as fire-and-forget.
 */
memoryProvider?: AgentMemoryProvider;
```

Delete the old JSDoc block immediately before the field since the new JSDoc replaces it.

- [ ] **Step 3: Run `tsc --noEmit`** and fix any callers of `memoryProvider` that no longer type-check (internal agentos code only; external callers run against the published version).

```bash
pnpm tsc --noEmit 2>&1 | tail -20
```

Expected: clean. If any agentos-internal file accesses `memoryProvider` with an assumption that `any` previously covered, fix the access site.

- [ ] **Step 4: Run existing tests.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -10
```

Expected: all pass; `memoryProvider integration` suite remains green.

- [ ] **Step 5: Commit.**

```bash
git add src/api/agent.ts
git commit -m "feat(memory): type memoryProvider as AgentMemoryProvider interface"
```

---

## Task 2: Create `applyMemoryProvider` helper with tests

**Files:**
- Create: `src/api/runtime/memoryProviderHooks.ts`.
- Create: `src/api/runtime/__tests__/memoryProviderHooks.test.ts`.

**Scope:** pure-function helper + 9 unit tests covering its contract. No consumer wires it yet; that's Task 3-6.

- [ ] **Step 1: Write the failing test file** at `src/api/runtime/__tests__/memoryProviderHooks.test.ts`:

```ts
/**
 * @file memoryProviderHooks.test.ts
 * Tests for applyMemoryProvider helper: wraps onBeforeGeneration and
 * onAfterGeneration with memory.getContext + memory.observe hooks.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { applyMemoryProvider, MEMORY_TIMEOUT_MS } from '../memoryProviderHooks.js';
import type { AgentMemoryProvider } from '../../agent.js';

function createMockProvider(overrides: Partial<AgentMemoryProvider> = {}): AgentMemoryProvider {
  return {
    getContext: vi.fn().mockResolvedValue({ contextText: 'Memory block' }),
    observe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('applyMemoryProvider', () => {
  it('returns opts unchanged when provider is undefined', () => {
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, undefined, 'user text');
    expect(result).toBe(baseOpts);
  });

  it('returns opts unchanged when provider has neither getContext nor observe', () => {
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, {}, 'user text');
    expect(result).toBe(baseOpts);
  });

  it('wraps onBeforeGeneration when getContext is defined', async () => {
    const provider = createMockProvider();
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    expect(result.onBeforeGeneration).toBeDefined();
    const ctx = { messages: [{ role: 'user', content: 'hello' }] };
    const next = await result.onBeforeGeneration!(ctx as any);

    expect(provider.getContext).toHaveBeenCalledWith('hello', expect.objectContaining({
      tokenBudget: expect.any(Number),
    }));
    expect((next as any).messages[0]).toEqual({
      role: 'system',
      content: 'Memory block',
    });
  });

  it('skips prepend when getContext returns null', async () => {
    const provider = createMockProvider({
      getContext: vi.fn().mockResolvedValue(null),
    });
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    const ctx = { messages: [{ role: 'user', content: 'hello' }] };
    const next = await result.onBeforeGeneration!(ctx as any);

    expect((next as any).messages).toHaveLength(1);
    expect((next as any).messages[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('skips prepend when getContext returns empty contextText', async () => {
    const provider = createMockProvider({
      getContext: vi.fn().mockResolvedValue({ contextText: '' }),
    });
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    const ctx = { messages: [{ role: 'user', content: 'hello' }] };
    const next = await result.onBeforeGeneration!(ctx as any);

    expect((next as any).messages).toHaveLength(1);
  });

  it('times out getContext after MEMORY_TIMEOUT_MS and skips prepend', async () => {
    vi.useFakeTimers();
    try {
      const slowProvider = createMockProvider({
        getContext: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const baseOpts = { provider: 'openai', model: 'gpt-4o' };
      const result = applyMemoryProvider(baseOpts as any, slowProvider, 'hello');
      const ctx = { messages: [{ role: 'user', content: 'hello' }] };

      const next = result.onBeforeGeneration!(ctx as any);
      vi.advanceTimersByTime(MEMORY_TIMEOUT_MS + 10);
      const resolved = await next;

      expect((resolved as any).messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps onAfterGeneration when observe is defined and fires both observes', async () => {
    const provider = createMockProvider();
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    expect(result.onAfterGeneration).toBeDefined();
    await result.onAfterGeneration!({
      text: 'world',
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    // Fire-and-forget: wait a tick for the async void promises
    await new Promise((resolve) => setImmediate(resolve));
    expect(provider.observe).toHaveBeenCalledWith('user', 'hello');
    expect(provider.observe).toHaveBeenCalledWith('assistant', 'world');
  });

  it('does not reject onAfterGeneration when observe rejects', async () => {
    const provider = createMockProvider({
      observe: vi.fn().mockRejectedValue(new Error('observe failed')),
    });
    const baseOpts = { provider: 'openai', model: 'gpt-4o' };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    await expect(result.onAfterGeneration!({
      text: 'world',
      messages: [{ role: 'user', content: 'hello' }],
    } as any)).resolves.toBeDefined();
  });

  it('chains user-provided onBeforeGeneration after memory wiring', async () => {
    const provider = createMockProvider();
    const userHook = vi.fn().mockImplementation(async (ctx: any) => ({
      ...ctx,
      extraFlag: true,
    }));
    const baseOpts = {
      provider: 'openai',
      model: 'gpt-4o',
      onBeforeGeneration: userHook,
    };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    const ctx = { messages: [{ role: 'user', content: 'hello' }] };
    const next = await result.onBeforeGeneration!(ctx as any);

    expect(userHook).toHaveBeenCalled();
    expect((next as any).extraFlag).toBe(true);
    expect((next as any).messages[0]).toEqual({
      role: 'system',
      content: 'Memory block',
    });
  });

  it('chains user-provided onAfterGeneration after memory observe', async () => {
    const provider = createMockProvider();
    const userHook = vi.fn().mockImplementation(async (result: any) => ({
      ...result,
      extraField: 'added',
    }));
    const baseOpts = {
      provider: 'openai',
      model: 'gpt-4o',
      onAfterGeneration: userHook,
    };
    const result = applyMemoryProvider(baseOpts as any, provider, 'hello');

    const final = await result.onAfterGeneration!({
      text: 'world',
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    expect(userHook).toHaveBeenCalled();
    expect((final as any).extraField).toBe('added');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails** (helper doesn't exist yet):

```bash
pnpm vitest run src/api/runtime/__tests__/memoryProviderHooks.test.ts 2>&1 | tail -10
```

Expected: module-resolution error for `../memoryProviderHooks.js`.

- [ ] **Step 3: Create the helper module** at `src/api/runtime/memoryProviderHooks.ts`:

```ts
/**
 * @file memoryProviderHooks.ts
 * Shared helper that wires AgentMemoryProvider hooks into GenerateTextOptions.
 *
 * Used by all four agent call paths (Agent.generate, Agent.stream,
 * AgentSession.send, AgentSession.stream) to consistently invoke
 * memory.getContext before the LLM call and memory.observe after. Pure
 * function: returns a new options object without mutating inputs.
 */
import type { GenerateTextOptions, GenerationHookContext, GenerationHookResult } from '../generateText.js';
import type { AgentMemoryProvider } from '../agent.js';

/** Timeout applied to memory.getContext calls to prevent hangs. */
export const MEMORY_TIMEOUT_MS = 5000;

/** Default token budget forwarded to memory.getContext. */
export const DEFAULT_MEMORY_TOKEN_BUDGET = 2000;

/**
 * Apply memory-provider hooks to an options object.
 *
 * @param baseOpts - The GenerateTextOptions object to wrap.
 * @param provider - Memory provider; when undefined or lacking both hooks,
 *   returns baseOpts unchanged.
 * @param userText - The user input text for this turn; passed to getContext
 *   and observe('user', ...).
 * @returns A new options object with onBeforeGeneration + onAfterGeneration
 *   wrappers that invoke the memory hooks. Existing user hooks (if any) are
 *   chained AFTER the memory wiring.
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
```

- [ ] **Step 4: Run the tests.**

```bash
pnpm vitest run src/api/runtime/__tests__/memoryProviderHooks.test.ts 2>&1 | tail -10
```

Expected: all 10 tests pass. (9 from spec + 1 regression for `wraps onAfterGeneration`.)

- [ ] **Step 5: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/api/runtime/memoryProviderHooks.ts src/api/runtime/__tests__/memoryProviderHooks.test.ts
git commit -m "feat(memory): applyMemoryProvider helper + 10 unit tests"
```

---

## Task 3: Refactor `AgentSession.send()` to use helper

**Files:**
- Modify: `src/api/agent.ts` — replace inline memory wiring at lines ~448-498 with a call to `applyMemoryProvider`.
- Regression: existing tests in `agentPromptEngine.test.ts::memoryProvider integration` must pass unchanged.

**Scope:** behavior-preserving refactor. Session tests already cover the contract; they act as regression guards.

- [ ] **Step 1: Add import** at the top of `src/api/agent.ts` (after the other runtime imports, around line 31):

```ts
import { applyMemoryProvider } from './runtime/memoryProviderHooks.js';
```

- [ ] **Step 2: Replace the inline memory wiring in `AgentSession.send()`** (currently at `agent.ts:448-499`). Locate the block:

```ts
async send(input: MessageContent): Promise<GenerateTextResult> {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);

  // Memory recall before generation
  let memorySystemMsg: string | undefined;
  if (opts.memoryProvider?.getContext) {
    try {
      const ctx = await Promise.race([
        opts.memoryProvider.getContext(textForMemory, { tokenBudget: 2000 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
      ]);
      if (ctx?.contextText) {
        memorySystemMsg = ctx.contextText;
      }
    } catch {
      // Memory recall failure is non-fatal
    }
  }

  // Prepend memory context to system prompt
  let system = baseOpts.system;
  if (memorySystemMsg) {
    system = [memorySystemMsg, system].filter(Boolean).join('\n\n') || undefined;
  }

  const userMessage: Message = { role: 'user', content: input };
  const requestMessages = useMemory
    ? [...history, userMessage]
    : [userMessage];
  const result = await generateText({
    ...baseOpts,
    system,
    messages: requestMessages,
    usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
      sessionId,
      source: 'agent.session.send',
    }),
  } as GenerateTextOptions);
  if (useMemory) {
    history.push(userMessage);
    history.push({ role: 'assistant', content: result.text });
  }

  // Memory observe after generation (fire-and-forget, text only)
  if (opts.memoryProvider?.observe) {
    opts.memoryProvider.observe('user', textForMemory).catch(() => {});
    if (result.text) {
      opts.memoryProvider.observe('assistant', result.text).catch(() => {});
    }
  }

  return result;
},
```

Replace with:

```ts
async send(input: MessageContent): Promise<GenerateTextResult> {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
  const userMessage: Message = { role: 'user', content: input };
  const requestMessages = useMemory
    ? [...history, userMessage]
    : [userMessage];

  const wrappedOpts = applyMemoryProvider(
    {
      ...baseOpts,
      messages: requestMessages,
      usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
        sessionId,
        source: 'agent.session.send',
      }),
    },
    opts.memoryProvider,
    textForMemory,
  );

  const result = await generateText(wrappedOpts as GenerateTextOptions);
  if (useMemory) {
    history.push(userMessage);
    history.push({ role: 'assistant', content: result.text });
  }

  return result;
},
```

Note: memory-context injection now happens inside `applyMemoryProvider`'s `onBeforeGeneration` wrapper via a prepended system message (not via baseOpts.system string concatenation). Behavior is equivalent because both end up prepended to the final system-prompt composition inside `generateText`.

- [ ] **Step 3: Run the regression tests.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts -t "memoryProvider integration" 2>&1 | tail -15
```

Expected: all 6 existing tests pass unchanged. If any fail because of the system-message shape change (e.g., the prepend test at line 143-158 looking for the exact concatenation pattern), update the test to accept the new shape where memory context is a separate system message rather than concatenated into the instructions system message. Both shapes produce equivalent prompt behavior for the LLM.

- [ ] **Step 4: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/api/agent.ts src/api/runtime/__tests__/agentPromptEngine.test.ts
git commit -m "refactor(memory): session.send uses applyMemoryProvider helper"
```

---

## Task 4: Refactor `AgentSession.stream()` to use helper

**Files:**
- Modify: `src/api/agent.ts` — replace inline `onBeforeGeneration` wiring at `:513-558` with a call to `applyMemoryProvider`.
- Regression: existing session-stream tests must pass.

**Scope:** behavior-preserving refactor.

- [ ] **Step 1: Replace the inline onBeforeGeneration wiring in `AgentSession.stream()`.** Locate the block at `agent.ts:502-561`:

```ts
stream(input: MessageContent): StreamTextResult {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
  const userMessage: Message = { role: 'user', content: input };
  // For streaming, use onBeforeGeneration hook to inject memory context
  const originalBeforeHook = baseOpts.onBeforeGeneration;

  const result = streamText({
    ...baseOpts,
    messages: useMemory
      ? [...history, userMessage]
      : [userMessage],
    onBeforeGeneration: opts.memoryProvider?.getContext
      ? async (ctx) => {
          // Inject memory context
          try {
            const memCtx = await Promise.race([
              opts.memoryProvider!.getContext(textForMemory, { tokenBudget: 2000 }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
            ]);
            if (memCtx?.contextText) {
              ctx = {
                ...ctx,
                messages: [
                  { role: 'system' as const, content: memCtx.contextText },
                  ...ctx.messages,
                ],
              };
            }
          } catch { /* non-fatal */ }
          // Chain with user's hook if present
          if (originalBeforeHook) {
            const userResult = await originalBeforeHook(ctx);
            return userResult ?? ctx;
          }
          return ctx;
        }
      : originalBeforeHook,
    usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
      sessionId,
      source: 'agent.session.stream',
    }),
  } as GenerateTextOptions);
  // Capture text for history when done
  if (useMemory) {
    history.push(userMessage);
    void result.text
      .then((replyText) => {
        history.push({ role: 'assistant', content: replyText });
        // Memory observe after stream completes (text only)
        if (opts.memoryProvider?.observe) {
          opts.memoryProvider.observe('user', textForMemory).catch(() => {});
          opts.memoryProvider.observe('assistant', replyText).catch(() => {});
        }
      })
      .catch(() => {
        /* history update failed, non-critical */
      });
  }
  return result;
},
```

Replace with:

```ts
stream(input: MessageContent): StreamTextResult {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
  const userMessage: Message = { role: 'user', content: input };

  const wrappedOpts = applyMemoryProvider(
    {
      ...baseOpts,
      messages: useMemory
        ? [...history, userMessage]
        : [userMessage],
      usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
        sessionId,
        source: 'agent.session.stream',
      }),
    },
    opts.memoryProvider,
    textForMemory,
  );

  const result = streamText(wrappedOpts as GenerateTextOptions);

  // Capture text for history when done. Memory observe runs inside
  // applyMemoryProvider's onAfterGeneration wrapper so it's not
  // re-fired here.
  if (useMemory) {
    history.push(userMessage);
    void result.text
      .then((replyText) => {
        history.push({ role: 'assistant', content: replyText });
      })
      .catch(() => {
        /* history update failed, non-critical */
      });
  }
  return result;
},
```

Note: `onAfterGeneration` now runs at the end of the stream via `generateText`'s internal hook chain — not via the `result.text.then()` handler. This is equivalent because `onAfterGeneration` fires when the stream completes, mirroring the previous `.then((replyText) => observe)` semantics.

- [ ] **Step 2: Run the regression tests.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 3: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/api/agent.ts
git commit -m "refactor(memory): session.stream uses applyMemoryProvider helper"
```

---

## Task 5: Wire `Agent.generate()` to helper + new integration test

**Files:**
- Modify: `src/api/agent.ts` — wire `Agent.generate()` at line ~405-422.
- Modify: `src/api/runtime/__tests__/agentPromptEngine.test.ts` — add direct-path test.

**Scope:** new capability. Adds auto-memory on direct `agent.generate()`.

- [ ] **Step 1: Write the failing integration test.** Add to `agentPromptEngine.test.ts` inside the existing `describe('memoryProvider integration')` block, after the last test:

```ts
it('calls getContext before direct agent.generate() (new in 0.2.0)', async () => {
  const memory = createMockMemory();
  const a = agent({ instructions: 'test', memoryProvider: memory });

  await a.generate('hello from direct');

  expect(memory.getContext).toHaveBeenCalledWith(
    'hello from direct',
    expect.objectContaining({ tokenBudget: expect.any(Number) }),
  );
});

it('calls observe after direct agent.generate() (new in 0.2.0)', async () => {
  const memory = createMockMemory();
  const a = agent({ instructions: 'test', memoryProvider: memory });

  await a.generate('hello from direct');
  await new Promise((resolve) => setImmediate(resolve));

  expect(memory.observe).toHaveBeenCalledWith('user', 'hello from direct');
  expect(memory.observe).toHaveBeenCalledWith('assistant', 'agent response');
});

it('prepends memory context to direct agent.generate() system prompt', async () => {
  const memory = createMockMemory();
  const a = agent({
    instructions: 'You are helpful.',
    memoryProvider: memory,
  });

  await a.generate('hello from direct');

  const callArgs = mockGenerateCompletion.mock.calls[0];
  const messages = callArgs[1];
  const systemMsgs = messages.filter((m: any) => m.role === 'system');
  const combined = systemMsgs.map((m: any) => m.content).join('\n');
  expect(combined).toContain('Memory: user likes hiking');
});
```

- [ ] **Step 2: Run the new tests to verify RED.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts -t "new in 0.2.0" 2>&1 | tail -15
```

Expected: 2 tests fail because `memory.getContext` and `memory.observe` are not invoked on the direct path. Third test fails for the same root cause.

- [ ] **Step 3: Wire the helper into `Agent.generate()`.** Locate the method at `agent.ts:404-422`:

```ts
async generate(
  prompt: MessageContent,
  extra?: Partial<GenerateTextOptions>
): Promise<GenerateTextResult> {
  const genOpts: Partial<GenerateTextOptions> = {
    ...baseOpts,
    ...extra,
    usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
      source: extra?.usageLedger?.source ?? 'agent.generate',
    }),
  };
  if (typeof prompt === 'string') {
    genOpts.prompt = prompt;
  } else {
    genOpts.messages = [...(genOpts.messages ?? []), { role: 'user', content: prompt }];
  }
  return generateText(genOpts as GenerateTextOptions);
},
```

Replace with:

```ts
async generate(
  prompt: MessageContent,
  extra?: Partial<GenerateTextOptions>
): Promise<GenerateTextResult> {
  const userText = typeof prompt === 'string' ? prompt : extractTextFromContent(prompt);
  const genOpts: Partial<GenerateTextOptions> = applyMemoryProvider(
    {
      ...baseOpts,
      ...extra,
      usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
        source: extra?.usageLedger?.source ?? 'agent.generate',
      }),
    },
    opts.memoryProvider,
    userText,
  );
  if (typeof prompt === 'string') {
    genOpts.prompt = prompt;
  } else {
    genOpts.messages = [...(genOpts.messages ?? []), { role: 'user', content: prompt }];
  }
  return generateText(genOpts as GenerateTextOptions);
},
```

- [ ] **Step 4: Run the new tests to verify GREEN.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -15
```

Expected: all tests pass (full file).

- [ ] **Step 5: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/api/agent.ts src/api/runtime/__tests__/agentPromptEngine.test.ts
git commit -m "feat(memory): auto-wire memoryProvider on direct agent.generate()"
```

---

## Task 6: Wire `Agent.stream()` to helper + integration test

**Files:**
- Modify: `src/api/agent.ts` — wire `Agent.stream()` at line ~424-438.
- Modify: `src/api/runtime/__tests__/agentPromptEngine.test.ts` — add direct-stream test.

**Scope:** mirrors Task 5 for the streaming path.

- [ ] **Step 1: Write the failing test.** Add to `agentPromptEngine.test.ts` inside the same `describe('memoryProvider integration')` block:

```ts
it('calls getContext before direct agent.stream() (new in 0.2.0)', async () => {
  const memory = createMockMemory();
  const a = agent({ instructions: 'test', memoryProvider: memory });

  const streamResult = a.stream('hello from stream');
  // Drain the stream to ensure generation completes
  for await (const _chunk of streamResult.textStream) {
    // consume
  }
  await streamResult.text;

  expect(memory.getContext).toHaveBeenCalledWith(
    'hello from stream',
    expect.objectContaining({ tokenBudget: expect.any(Number) }),
  );
});

it('calls observe after direct agent.stream() completes (new in 0.2.0)', async () => {
  const memory = createMockMemory();
  const a = agent({ instructions: 'test', memoryProvider: memory });

  const streamResult = a.stream('hello from stream');
  for await (const _chunk of streamResult.textStream) {
    // consume
  }
  await streamResult.text;
  await new Promise((resolve) => setImmediate(resolve));

  expect(memory.observe).toHaveBeenCalledWith('user', 'hello from stream');
  expect(memory.observe).toHaveBeenCalledWith('assistant', 'streamed');
});
```

- [ ] **Step 2: Run the new tests to verify RED.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts -t "direct agent.stream" 2>&1 | tail -10
```

Expected: both tests fail.

- [ ] **Step 3: Wire the helper into `Agent.stream()`.** Locate the method at `agent.ts:424-438`:

```ts
stream(prompt: MessageContent, extra?: Partial<GenerateTextOptions>): StreamTextResult {
  const streamOpts: Partial<GenerateTextOptions> = {
    ...baseOpts,
    ...extra,
    usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
      source: extra?.usageLedger?.source ?? 'agent.stream',
    }),
  };
  if (typeof prompt === 'string') {
    streamOpts.prompt = prompt;
  } else {
    streamOpts.messages = [...(streamOpts.messages ?? []), { role: 'user', content: prompt }];
  }
  return streamText(streamOpts as GenerateTextOptions);
},
```

Replace with:

```ts
stream(prompt: MessageContent, extra?: Partial<GenerateTextOptions>): StreamTextResult {
  const userText = typeof prompt === 'string' ? prompt : extractTextFromContent(prompt);
  const streamOpts: Partial<GenerateTextOptions> = applyMemoryProvider(
    {
      ...baseOpts,
      ...extra,
      usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, extra?.usageLedger, {
        source: extra?.usageLedger?.source ?? 'agent.stream',
      }),
    },
    opts.memoryProvider,
    userText,
  );
  if (typeof prompt === 'string') {
    streamOpts.prompt = prompt;
  } else {
    streamOpts.messages = [...(streamOpts.messages ?? []), { role: 'user', content: prompt }];
  }
  return streamText(streamOpts as GenerateTextOptions);
},
```

- [ ] **Step 4: Run all tests in the file.**

```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 5: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Clean up dead code in `agent.ts`.** The `MEMORY_TIMEOUT_MS` const at line 248 is no longer used by agent.ts directly (moved to memoryProviderHooks.ts). Delete it:

Locate:
```ts
/** Timeout for memory operations to prevent blocking generation. */
const MEMORY_TIMEOUT_MS = 5000;
```

Delete the 2 lines + blank line.

Run tests again:
```bash
pnpm vitest run src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add src/api/agent.ts src/api/runtime/__tests__/agentPromptEngine.test.ts
git commit -m "feat(memory): auto-wire memoryProvider on direct agent.stream()"
```

---

## Task 7: Export `AgentMemoryProvider` from public barrel

**Files:**
- Modify: `src/api/index.ts` (or wherever the package's public barrel lives).
- Verify by importing from consumer: test import path.

**Scope:** expose the interface type for external TypeScript consumers.

- [ ] **Step 1: Locate the public barrel.**

```bash
find src -name "index.ts" -path "*/api/*" -not -path "*__tests__*" | head -5
find src -name "index.ts" -not -path "*__tests__*" -not -path "*runtime*" | head -5
```

Identify the file that re-exports `agent`, `AgentOptions`, etc. from the api module.

- [ ] **Step 2: Add the re-export.** In the identified barrel, add a line adjacent to the existing agent re-exports:

```ts
export type { AgentMemoryProvider } from './api/agent';
```

Or if the barrel uses namespace re-exports (`export * from './api/agent'`), verify `AgentMemoryProvider` is already covered and no new line is needed.

- [ ] **Step 3: `tsc --noEmit` + verify.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/api/index.ts
git commit -m "feat(memory): export AgentMemoryProvider type from public barrel"
```

---

## Task 8: README memory section update

**Files:**
- Modify: `packages/agentos/README.md` — update memory example at line ~150-168.

**Scope:** documentation change only.

- [ ] **Step 1: Update the README memory example.** Locate the block at `README.md:150-168` (the `const tutor = agent({...})` example with `memory: { types: [...] }`). Append this section immediately after the existing example:

```markdown

#### Memory on direct calls

Memory auto-wires on `agent.stream()` / `agent.generate()` as well — sessions
are not required to get memory integration.

\```typescript
const tutor = agent({
  provider: 'anthropic',
  instructions: 'You are a patient CS tutor.',
  memoryProvider: myProvider, // implements AgentMemoryProvider
});

// Direct stream — memory context injected before the call, observations
// recorded after.
const stream = tutor.stream('Explain recursion.');

// Session — same memory wiring, plus per-session conversation history.
const session = tutor.session('student-1');
await session.send('Continue where we left off.');
\```

The `AgentMemoryProvider` interface defines `getContext` (read) and `observe`
(write) hooks. Both are optional — you can implement read-only or
write-only providers.
```

(Escape the code-fence backticks when inserting; the above example uses `\``` to avoid markdown interpretation.)

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "docs(readme): document memoryProvider auto-wire on direct calls"
```

---

## Task 9: CHANGELOG entry + version bump

**Files:**
- Modify: `packages/agentos/CHANGELOG.md` (or equivalent release-notes file).
- Modify: `packages/agentos/package.json` — bump version.

**Scope:** release prep.

- [ ] **Step 1: Locate the changelog file.**

```bash
ls -la CHANGELOG* 2>&1 | head
```

If CHANGELOG.md exists, edit it. If only `.changeset/` directories exist, follow the project's changeset convention (check `git log -- '*.changeset*' | head -20`).

- [ ] **Step 2: Prepend the 0.2.0 entry** at the top of the changelog (under the project header):

```markdown
## 0.2.0

### Changed
- `memoryProvider` now auto-wires on `agent.stream()` and `agent.generate()` direct calls in addition to the existing `agent.session().send()` / `.stream()` paths. Passing `memoryProvider` on `createAgent` means memory `getContext` fires before every LLM call and `observe` fires after — on every call path.
- `memoryProvider?: any` typed as `AgentMemoryProvider` interface. Callers passing malformed providers now see TypeScript errors at the provider boundary.

### Added
- `applyMemoryProvider` internal helper shared across all four agent call paths (session.send/stream + direct stream/generate). Eliminates inline wiring duplication.
- `AgentMemoryProvider` interface exported from the public barrel.

### Migration
- Callers using `agent.session()` for memory: no action required. Behavior unchanged.
- Callers using `agent.stream()` / `.generate()` direct: memory now works. If you previously worked around the silent-ignore by wiring memory manually via `onBeforeGeneration`, you can remove the manual wiring.
- Callers who passed `memoryProvider` without intending to use memory: remove the field from your `createAgent` config. (There's no legitimate use case for passing the provider and expecting no-op.)
```

If the project uses changesets, create `.changeset/memoryprovider-direct-call.md`:

```markdown
---
'@framers/agentos': minor
---

Memory provider now auto-wires on direct `agent.stream()` and `agent.generate()` calls, not just session paths. Typed as `AgentMemoryProvider` interface.
```

- [ ] **Step 3: Bump version in `package.json`** from `0.1.255` to `0.2.0`:

```bash
# Check current
grep '"version"' package.json

# Update manually via editor, or:
pnpm version minor --no-git-tag-version
```

Verify:
```bash
grep '"version"' package.json
# Expected: "version": "0.2.0"
```

- [ ] **Step 4: Commit.**

```bash
git add CHANGELOG.md package.json
# If changeset:
# git add .changeset/*.md
git commit -m "chore(release): 0.2.0 — memoryProvider auto-wire on direct agent calls"
```

---

## Task 10: Full test suite + lint closeout

**Files:** n/a (verification only).

**Scope:** before handoff to wilds-side consumption, confirm the agentos package is clean.

- [ ] **Step 1: Run touched-file test suites.**

```bash
pnpm vitest run \
  src/api/runtime/__tests__/memoryProviderHooks.test.ts \
  src/api/runtime/__tests__/agentPromptEngine.test.ts \
  2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2: `tsc --noEmit`.**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: clean (no NEW errors introduced by this work — pre-existing errors unchanged).

- [ ] **Step 3: `pnpm lint` on touched files.**

```bash
pnpm lint src/api/agent.ts src/api/runtime/memoryProviderHooks.ts src/api/runtime/__tests__/memoryProviderHooks.test.ts src/api/runtime/__tests__/agentPromptEngine.test.ts 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Spec close-out.** Update `docs/superpowers/specs/2026-04-22-memoryprovider-direct-call-autowire-design.md` frontmatter:

```diff
-status: draft
+status: implemented
```

Append a "Commits" section at the end of the spec:

```markdown

## Commits

| Commit | Scope |
|---|---|
| (sha) | feat(memory): type memoryProvider as AgentMemoryProvider interface |
| (sha) | feat(memory): applyMemoryProvider helper + 10 unit tests |
| (sha) | refactor(memory): session.send uses applyMemoryProvider helper |
| (sha) | refactor(memory): session.stream uses applyMemoryProvider helper |
| (sha) | feat(memory): auto-wire memoryProvider on direct agent.generate() |
| (sha) | feat(memory): auto-wire memoryProvider on direct agent.stream() |
| (sha) | feat(memory): export AgentMemoryProvider type from public barrel |
| (sha) | docs(readme): document memoryProvider auto-wire on direct calls |
| (sha) | chore(release): 0.2.0 — memoryProvider auto-wire on direct agent calls |
```

Backfill SHAs via `git log --oneline master -15` once all above commits have landed.

- [ ] **Step 5: Commit spec close-out.**

```bash
git add docs/superpowers/specs/2026-04-22-memoryprovider-direct-call-autowire-design.md
git commit -m "docs(spec): mark memoryProvider-direct-call-autowire implemented"
```

- [ ] **Step 6: Do NOT push.** Per consumer's session default, wait for explicit push instruction. Agentos will bake in wilds-ai first (via the wilds-side consumption plan at `apps/wilds-ai/docs/superpowers/plans/2026-04-22-wilds-memory-integration-completion.md`) before publishing to npm.

---

## Exit conditions

**Complete:**
- All 10 tasks done.
- `applyMemoryProvider` helper exists at `src/api/runtime/memoryProviderHooks.ts` with 10 unit tests passing.
- `AgentMemoryProvider` interface exists in `src/api/agent.ts` + exported from public barrel.
- All four call paths (`Agent.generate`, `Agent.stream`, `AgentSession.send`, `AgentSession.stream`) consume the shared helper.
- Direct-path memoryProvider integration tests pass.
- Session-path regression tests pass unchanged.
- `tsc --noEmit` clean on touched files.
- `pnpm lint` clean on touched files.
- README memory section updated with direct-call example.
- CHANGELOG entry under 0.2.0.
- `package.json` version bumped to 0.2.0.
- Spec status flipped to `implemented` with commit SHAs.

**Partial:** some tasks done. Document which landed; resume from the next task.

**Blocked:** if the session-path regression test at `agentPromptEngine.test.ts:143-158` (the `prepends memory context to system prompt` assertion) fails because of the system-message-shape change from Task 3, update the test to assert the new shape: expect a separate `{ role: 'system', content: 'Memory: user likes hiking' }` message to exist in the messages array rather than concatenation into the instructions-block. If the fix isn't obvious, stop and ask.

---

## Notes for the executor

- **`cd packages/agentos/`** before any `pnpm` / `vitest` / `tsc`.
- **No push** without explicit instruction.
- **Each task is independently committable** — if you need to stop mid-plan, the intermediate state is valid.
- **The helper tests are the contract for all four call paths** — if a session-path regression breaks, fix the helper, not the session code.
- **The shared `mockGenerateCompletion`** in `agentPromptEngine.test.ts:7-12` returns `{ content: 'agent response' }` by default; streaming returns `{ responseTextDelta: 'streamed' }`. Assertions on observe args use these values.
- **Ordering matters**: do Task 3 (session.send refactor) BEFORE Task 5 (Agent.generate wiring) so the helper is already consumer-proven by regression tests before adding new consumers.
- **Parallel-session risk in agentos is low** — memoryProvider code isn't under active parallel work.

---

## Handoff

Once this plan is complete, the agentos spec is implemented. The sibling wilds-ai consumption plan at `apps/wilds-ai/docs/superpowers/plans/2026-04-22-wilds-memory-integration-completion.md` bumps the dep + threads the 4 CLAUDE.md-required params through the bare-facade runtime sites. Both plans together close slice 5 gaps 2.1 + 5.1.

Do NOT publish agentos 0.2.0 to npm until the wilds-side plan has landed + baked for at least 3-5 days of production traffic. Bake gate is the rollout section of the spec.
