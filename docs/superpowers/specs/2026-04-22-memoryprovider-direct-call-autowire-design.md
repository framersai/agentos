---
title: Memory Provider Auto-Wire on Direct Calls — Design Spec
date: 2026-04-22
status: implemented
owner: agentos
audience: agentos open-source users + wilds-ai
---

# Memory Provider Auto-Wire on Direct `agent.stream()` / `agent.generate()`

## Problem

`agent({ memoryProvider })` stores the provider on the agent config but only invokes it on `agent.session().send()` and `agent.session().stream()`. Direct `agent.stream()` and `agent.generate()` silently ignore `memoryProvider`.

This is a public-API footgun. External agentos users who:

1. Pass `memoryProvider` on the factory call.
2. Invoke the agent through the simpler direct path (`agent.stream(...)` / `agent.generate(...)`).

… get zero memory activation. No error. No warning. No auto-wire. The `memoryProvider.getContext` and `memoryProvider.observe` hooks are never called, memory never reaches the prompt, observations never persist.

The silent-misuse failure mode is proven in wilds-ai, the flagship agentos consumer. Wilds narrator passes `memoryProvider: pipeline.memoryProvider` to `createAgent` and then calls `narratorAgent.stream(...)` direct — memory is computed, stored, but never read on that path. External library users will hit the same pattern.

Additionally, `memoryProvider?: any` at `AgentOptions:134` provides no type-level contract. Callers can pass malformed providers with missing `getContext` / `observe` methods and the silent-no-op surface swallows the mistake.

## Decision

**Auto-wire `memoryProvider` on `agent.stream()` and `agent.generate()` whenever `opts.memoryProvider?.getContext` is defined.** Matches existing `AgentSession.send/.stream` behavior. Makes the public API honest: pass the provider → memory works on every call path.

Introduce a typed `AgentMemoryProvider` interface to replace `memoryProvider?: any`.

Extract the existing session memory wiring into a single internal helper so session and direct paths share one implementation.

## Scope

- Add `AgentMemoryProvider` interface at `packages/agentos/src/api/types.ts`.
- Replace `memoryProvider?: any` with `memoryProvider?: AgentMemoryProvider` in `AgentOptions`.
- Extract `applyMemoryProvider(opts, provider, sessionOpts?)` private helper in `packages/agentos/src/api/runtime/memoryProviderHooks.ts`.
- Refactor `AgentSession.send()` and `AgentSession.stream()` at `agent.ts:440-579` to consume the shared helper.
- Wire `Agent.stream()` and `Agent.generate()` at `agent.ts:404-438` to apply the helper when `opts.memoryProvider?.getContext` is set.
- Update `README.md` memory integration section so users see memory works on direct calls.
- Add CHANGELOG entry for the behavior change.
- Minor version bump: `0.1.255 → 0.2.0`.

## Non-goals

- Changing the `AgentMemoryProvider` interface shape beyond the typing (`getContext` / `observe` semantics stay identical).
- Adding a `useMemory` opt-in flag — auto-wire is the default when the provider is present.
- Touching `CognitiveMemoryManager`, `WildsMemoryFacade`, or any wilds-side code.
- Adding new memory capabilities (no new hooks, no new timeout knobs, no new tokenBudget defaults).
- Refactoring the base system-prompt assembly or the existing `onBeforeGeneration` / `onAfterGeneration` chain semantics.
- Full agentos test suite runs; only targeted `vitest` on touched modules.

## Authoritative references

- `packages/agentos/src/api/agent.ts` — factory + `Agent` + `AgentSession` (current source of truth).
- `packages/agentos/src/api/generateText.ts` — `GenerateTextOptions`, `onBeforeGeneration`, `onAfterGeneration` types.
- `packages/agentos/src/api/streamText.ts` — streaming entry point.
- `packages/agentos/README.md:150-168` — current memory documentation (the session-only example).
- `packages/agentos/src/api/runtime/__tests__/agentPromptEngine.test.ts:118-183` — existing session-path memory tests (reference shape for the new direct-path tests).

## Current state

```ts
// agent.ts:380-402 — baseOpts fed into direct stream/generate
const baseOpts: Partial<GenerateTextOptions> = {
  provider: opts.provider,
  model: opts.model,
  system: opts.systemBlocks ?? buildSystemPrompt(opts),
  tools: opts.tools,
  // ... 15 more fields ...
  // NO memoryProvider here.
};

// agent.ts:404-438 — direct Agent.stream / Agent.generate
async generate(prompt, extra) {
  const genOpts = { ...baseOpts, ...extra, usageLedger: ... };
  // ... prompt assembly ...
  return generateText(genOpts);  // memoryProvider never consulted
}

stream(prompt, extra) {
  const streamOpts = { ...baseOpts, ...extra, usageLedger: ... };
  // ... prompt assembly ...
  return streamText(streamOpts);  // memoryProvider never consulted
}

// agent.ts:440-579 — session paths have inline memory wiring
session(id) {
  return {
    async send(input) {
      // ~20 LOC of memory wiring:
      // - Race getContext against 5s timeout
      // - Prepend contextText to system prompt
      // - Call observe('user', ...) + observe('assistant', ...) fire-and-forget
      // ...
    },
    stream(input) {
      // ~25 LOC of same wiring via onBeforeGeneration hook
      // ...
    },
  };
}
```

## Target state

```ts
// New interface at types.ts
export interface AgentMemoryProvider {
  getContext?: (
    text: string,
    opts?: { tokenBudget?: number }
  ) => Promise<{ contextText?: string } | null>;
  observe?: (
    role: 'user' | 'assistant',
    text: string
  ) => Promise<void>;
}

// AgentOptions uses the interface
export interface AgentOptions extends BaseAgentConfig {
  // ... existing fields ...
  memoryProvider?: AgentMemoryProvider;
  // ... remaining fields ...
}

// New helper at runtime/memoryProviderHooks.ts
export const MEMORY_TIMEOUT_MS = 5000;
export const DEFAULT_MEMORY_TOKEN_BUDGET = 2000;

export function applyMemoryProvider(
  baseOpts: Partial<GenerateTextOptions>,
  provider: AgentMemoryProvider | undefined,
  sessionLog?: { onObserve?: (role: 'user' | 'assistant', text: string) => void }
): Partial<GenerateTextOptions> {
  if (!provider?.getContext && !provider?.observe) return baseOpts;

  const userOnBefore = baseOpts.onBeforeGeneration;
  const userOnAfter = baseOpts.onAfterGeneration;

  const wrappedOnBefore: GenerateTextOptions['onBeforeGeneration'] = async (ctx) => {
    if (provider.getContext) {
      try {
        const userText = extractLastUserText(ctx.messages);
        const memCtx = await Promise.race([
          provider.getContext(userText, { tokenBudget: DEFAULT_MEMORY_TOKEN_BUDGET }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)),
        ]);
        if (memCtx?.contextText) {
          ctx = {
            ...ctx,
            messages: [
              { role: 'system', content: memCtx.contextText },
              ...ctx.messages,
            ],
          };
        }
      } catch {
        // Memory recall failure is non-fatal
      }
    }
    if (userOnBefore) {
      const userResult = await userOnBefore(ctx);
      return userResult ?? ctx;
    }
    return ctx;
  };

  const wrappedOnAfter: GenerateTextOptions['onAfterGeneration'] = async (result) => {
    if (provider.observe) {
      // Fire-and-forget; don't block generation
      const userText = extractLastUserText(result.messages);
      void provider.observe('user', userText).catch(() => {});
      if (result.text) {
        void provider.observe('assistant', result.text).catch(() => {});
      }
      sessionLog?.onObserve?.('user', userText);
      if (result.text) sessionLog?.onObserve?.('assistant', result.text);
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

// agent.ts Agent.stream/generate applies the helper
async generate(prompt, extra) {
  const genOpts = applyMemoryProvider(
    { ...baseOpts, ...extra },
    opts.memoryProvider
  );
  // ... prompt assembly ...
  return generateText(genOpts);
}

stream(prompt, extra) {
  const streamOpts = applyMemoryProvider(
    { ...baseOpts, ...extra },
    opts.memoryProvider
  );
  // ... prompt assembly ...
  return streamText(streamOpts);
}

// AgentSession.send/stream consume the same helper — no inline duplication
session(id) {
  return {
    async send(input) {
      const sessOpts = applyMemoryProvider(
        { ...baseOpts, messages: [...history, userMessage] },
        opts.memoryProvider
      );
      const result = await generateText(sessOpts);
      // history bookkeeping unchanged
      return result;
    },
    stream(input) {
      const sessOpts = applyMemoryProvider(
        { ...baseOpts, messages: [...history, userMessage] },
        opts.memoryProvider
      );
      const result = streamText(sessOpts);
      // history bookkeeping unchanged
      return result;
    },
  };
}
```

`extractLastUserText(messages)` is a small helper that pulls the most recent `role: 'user'` message content (string or multimodal parts → concatenated text). Shared with the existing `extractTextFromContent` utility.

## Architecture

### Helper placement

New file: `packages/agentos/src/api/runtime/memoryProviderHooks.ts`.

Sits next to the existing `usageLedger.ts`, `hostPolicy.ts`, `toolAdapter.ts` helpers under `runtime/`. Private module — not exported from the package barrel. Consumed only by `api/agent.ts`.

### Interface exports

`AgentMemoryProvider` exported from `@framers/agentos/api/types` so external callers can type their providers. Added to the public barrel re-exports.

### Test strategy

New test file: `packages/agentos/src/api/runtime/__tests__/memoryProviderHooks.test.ts` covering:

1. Returns opts unchanged when provider absent.
2. Wraps `onBeforeGeneration` when `provider.getContext` defined; unchanged when only `observe` defined.
3. Wraps `onAfterGeneration` when `provider.observe` defined; unchanged when only `getContext` defined.
4. Prepends contextText as a system message when getContext returns content.
5. Skips prepend when getContext returns null, undefined, or empty contextText.
6. Respects the 5-second timeout (uses fake timers).
7. Observe runs fire-and-forget; rejection doesn't block.
8. Chains user-provided `onBeforeGeneration` after memory wiring.
9. Chains user-provided `onAfterGeneration` after observe.

New direct-path integration tests in `packages/agentos/src/api/runtime/__tests__/agentPromptEngine.test.ts`:

10. `agent({ memoryProvider }).stream(...)` fires `getContext` + `observe`.
11. `agent({ memoryProvider }).generate(...)` fires `getContext` + `observe`.
12. Session path (`agent().session().send()`) continues to fire `getContext` + `observe` (regression test — preserves existing semantics).

### Version bump

`0.1.255 → 0.2.0`. Reasoning:

- Direct-path behavior change: previously memoryProvider was silently ignored; now auto-wires. Affects any external caller who passed memoryProvider expecting no-op — but there's no legitimate reason for that pattern.
- Type change: `any` → `AgentMemoryProvider`. Callers currently passing malformed providers will see TypeScript errors surface.
- Semver: Minor (0.x.y → 0.2.0) signals additive-plus-behavior-aligned, not a full semver-major rewrite. AgentOS is in 0.x so minor bumps carry behavior changes by convention.

### CHANGELOG entry

```markdown
## 0.2.0

### Changed
- `memoryProvider` now auto-wires on `agent.stream()` and `agent.generate()` direct calls in addition to the existing `agent.session().send()` / `.stream()` paths. Passing `memoryProvider` on `createAgent` now means memory `getContext` fires before every LLM call and `observe` fires after — on every call path.
- `memoryProvider?: any` typed as `AgentMemoryProvider` interface. Callers passing malformed providers will see new TypeScript errors.

### Migration
- Callers using `agent.session()` for memory: no action required. Behavior unchanged.
- Callers using `agent.stream()` / `.generate()` direct: memory now works. If you previously worked around the silent-ignore by wiring memory manually via `onBeforeGeneration`, you can remove the manual wiring.
- Callers who passed `memoryProvider` without intending to use memory: remove the field from your `createAgent` config. Or type-check at compile time via the new `AgentMemoryProvider` interface.
```

### README update

Line 150-168's memory example updates to show direct-call usage:

```markdown
#### Memory on direct calls

Memory auto-wires on `agent.stream()` / `agent.generate()` as well — sessions
are not required to get memory integration.

```typescript
const tutor = agent({
  provider: 'anthropic',
  instructions: 'You are a patient CS tutor.',
  memoryProvider: myProvider,
});

// Direct stream — memory context injected before the call, observations
// recorded after.
const stream = tutor.stream('Explain recursion.');

// Session — same memory wiring, plus per-session conversation history.
const session = tutor.session('student-1');
await session.send('Continue where we left off.');
```
```

## Risks and how they're handled

- **External caller relies on silent-ignore**: theoretical risk. No legitimate use case. Minor-version bump + CHANGELOG warn. If a caller surfaces a complaint post-release, we can add a `disableAutoMemory: true` opt-out in a 0.2.1 patch.
- **Test-mock drift**: wilds and external consumers may have mocks for `memoryProvider` that shape-match `any`. Moving to `AgentMemoryProvider` surfaces those mocks as type errors. Callers fix per the interface.
- **Performance**: direct-path callers now pay one 5s-bounded `getContext` call + fire-and-forget `observe` per invocation. For single-shot classification use cases this is a small overhead; callers concerned about hot-loop cost should not pass memoryProvider (the obvious fix). No real-timer test issues because the existing `AgentSession.stream` already uses this timeout pattern.
- **Hook chain ordering**: user-provided `onBeforeGeneration` runs AFTER memory wiring (to allow user to see memory context). User-provided `onAfterGeneration` runs AFTER observe dispatch. Same chain semantics as existing `AgentSession.stream` at `agent.ts:513-538`. Tests pin the order.
- **Typing breakage on upgrade**: callers with `memoryProvider: any` on their config type won't break. Callers with malformed provider implementations will see TS errors — that's the intended benefit.
- **Session history duplication**: not applicable. Direct-path doesn't hold history; session-path history behavior is unchanged.
- **Test duplication between session and direct paths**: the shared helper tests cover the core wiring; session + direct integration tests cover the call-path glue. No duplicate assertion trees.

## Success criteria

- `AgentMemoryProvider` interface exported from `@framers/agentos/api/types` + package barrel.
- `applyMemoryProvider` helper exists at `packages/agentos/src/api/runtime/memoryProviderHooks.ts`.
- `agent.stream()` + `agent.generate()` auto-wire memoryProvider when present.
- `agent.session().send()` + `.stream()` use the same helper (no inline duplication).
- Behavior on all four call paths proven by targeted `vitest` runs.
- Existing agentos tests (full suite) pass unchanged. Memory-related session tests at `agentPromptEngine.test.ts:118-183` pass as regression.
- `tsc --noEmit` clean on the agentos package.
- `pnpm lint` clean for touched files.
- README memory section updated with the direct-call example.
- CHANGELOG entry published under `0.2.0`.
- Package `version` bumped to `0.2.0` in `package.json`.
- Spec status flipped to `implemented` + commit SHAs annotated once landed.

## Constraints (carried from agentos repo conventions)

- Work on the `packages/agentos/` submodule. `cd` into it before `pnpm` / `vitest`.
- Agentos has its own `vitest` config. Run targeted tests only.
- Agentos has its own commit message + PR conventions (see existing commits).
- Agentos is actively published to npm via CI on master commits (CHANGELOG / version bump triggers release).
- No subagents. No worktrees. No stash/reset. All work directly on master.
- Commit and push inside `packages/agentos/` first, then bump the monorepo submodule pointer.

## Rollout

1. Ship all code changes + tests.
2. Bake in wilds-ai master for at least 3-5 days of narrator + companion traffic via the wilds-side consumer spec (`2026-04-22-wilds-memory-integration-completion-design.md`).
3. If no regression surfaces (monitor `refusal_retry_*` + `usage_event_*` + any narrator latency metrics), publish `0.2.0` to npm.
4. If regression surfaces, roll back the agentos pointer in wilds to `0.1.255` and iterate.

## Immediate next step after approval

Invoke `superpowers:writing-plans` to produce `packages/agentos/docs/superpowers/plans/2026-04-22-memoryprovider-direct-call-autowire.md` — the TDD implementation plan that walks the scope task-by-task.

## Commits (landed)

| Commit | Scope |
|---|---|
| `3a1785dae` | `feat(memory): type memoryProvider as AgentMemoryProvider interface` |
| `392c1bd5d` | `feat(memory): applyMemoryProvider helper + 10 unit tests` |
| `415608402` | `refactor(memory): session.send uses applyMemoryProvider helper` |
| `38f0cf87a` | `refactor(memory): session.stream uses applyMemoryProvider helper` |
| `ab3a2d94b` | `feat(memory): auto-wire memoryProvider on direct agent.generate()` |
| `13efc856d` | `feat(memory): auto-wire memoryProvider on direct agent.stream() + drop dead MEMORY_TIMEOUT_MS` |
| `9250da4b7` | `feat(memory): export AgentMemoryProvider type from public barrel` |
| `ad8988d5f` | `docs(readme): document memoryProvider auto-wire on direct calls` |
| `d866ad4f2` | `feat(memory)!: memoryProvider auto-wires on all four agent call paths` (BREAKING CHANGE marker for semantic-release 0.1.255 → 0.2.0 bump) |

### Final state

- 23/23 tests pass (10 helper unit + 13 agent integration including 5 new direct-path tests + 8 existing session-path regression).
- `AgentMemoryProvider` interface exported from public barrel at `src/index.ts`.
- All four agent call paths consume the shared `applyMemoryProvider` helper — zero duplication.
- README `Agent with Personality & Memory` section extended with the direct-call example.
- Version bump + CHANGELOG entry are handled by `semantic-release` on master push (triggered by the `feat!:` + `BREAKING CHANGE:` footer in commit `d866ad4f2`).
- Per rollout plan: agentos master stays unpushed until wilds-ai bakes the changes for 3-5 days. Wilds consumption happens via the sibling plan at `apps/wilds-ai/docs/superpowers/plans/2026-04-22-wilds-memory-integration-completion.md`.
