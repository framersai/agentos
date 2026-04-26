# Session-aware structured output for `agent.session.send()`

**Authored:** 2026-04-26.
**Author:** paracosm-track. **Paired plan:** `docs/superpowers/plans/2026-04-26-session-structured-output-plan.md`.

---

## §1. Problem

`agent.session.send(input)` is the agentos primitive for stateful conversational LLM calls. It accumulates a per-session message history and routes through `generateText` to the configured provider. Today it is a text-in / text-out function: the schema of the assistant reply is the model's responsibility alone.

Downstream callers that need a typed object (paracosm `commander`, `department`, `judge`, plus any future agentos consumer) wrap `session.send` with a retry-with-feedback loop, validate against a Zod schema, push corrective user turns when validation fails, and fall back after N attempts. paracosm's [`runtime/llm-invocations/sendAndValidate.ts`](https://github.com/framersai/paracosm/blob/master/src/runtime/llm-invocations/sendAndValidate.ts) is one such wrapper. The fallback path produces visible artifacts like `decision: "Commander decision unavailable; defer to department consensus."` whenever the model fails 3 attempts at producing schema-valid JSON. Real prod recordings of `paracosm.agentos.sh` show this happening on `gpt-5.4-mini` for a 10-field nested-array schema, repeatedly.

The retry-with-feedback approach predates GA structured outputs across providers. Today every relevant provider either (a) supports native JSON-Schema enforcement (OpenAI `response_format: { type: 'json_schema' }`) or (b) supports forced tool-use that achieves the same guarantee (Anthropic `tool_choice: { type: 'tool', name }`) or (c) supports a constrained-decoding equivalent (Gemini `responseSchema` + `responseMimeType: 'application/json'`). agentos already plumbs the OpenAI shape through `generateText._responseFormat` to `OpenAIProvider.generateCompletion`, but only for `generateObject` (a one-shot API that discards session memory). The same bytes are not exposed to `session.send`.

The result is paracosm and other agentos consumers run a retry loop that the underlying providers can eliminate at the API call.

## §2. Goals

1. Add an optional `responseSchema` parameter to `AgentSession.send()` that accepts a Zod schema.
2. When `responseSchema` is set, route through the provider's native structured-output API:
   - OpenAI: `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`
   - Anthropic: forced tool_use with `tools: [{ name, input_schema }]` and `tool_choice: { type: 'tool', name }`
   - Gemini: `responseMimeType: 'application/json'` + `responseSchema: <jsonSchema>`
3. Preserve session memory: the user message + the assistant's structured response both append to history, just as in the text-only path. A subsequent `session.send` call sees the prior structured output as part of its context.
4. Return a typed result object: when `responseSchema` is set, the `GenerateTextResult` extension includes a typed `.object: z.infer<T>` field. The raw `.text` field still carries the JSON string for debugging.
5. Backward compatible: every existing `session.send(input)` call (no schema) keeps its current behavior. No rename, no breaking change to the return type for the default overload.
6. Where a provider doesn't support strict JSON-Schema enforcement, degrade gracefully to its best available mode (e.g. OpenRouter falls back to `json_object`); never silently call without any constraint.

## §3. Out of scope

- Streaming structured output. `session.stream` is not extended in this spec; the schema-aware path is non-streaming on first ship. A follow-up adds streaming if a real consumer asks.
- Replacing `generateObject`. It stays as the one-shot, no-session API. Many callers use it that way and the path is well-tested. Schema-aware `session.send` is the new option for callers that need both schema enforcement AND session memory.
- Migrating paracosm's `sendAndValidate`. That migration is queued as a follow-up paracosm spec; this spec only adds the agentos primitive.
- Auto-retry on provider-side errors (rate-limit / 5xx). Existing retry/backoff in agentos providers continues to apply; the schema-validation retry loop becomes dead code when native enforcement is on.
- Tool calling alongside `responseSchema`. When a schema is set, tools are disabled for that call; mixing both requires a different API shape (e.g. multi-turn function-call loops) and is out of scope.

## §4. Implementation

### §4.1 New types

`packages/agentos/src/api/agent.ts` (extend the existing types):

```ts
import type { ZodType, z } from 'zod';

/** Options for a single session.send call. */
export interface SessionSendOptions<S extends ZodType | undefined = undefined> {
  /**
   * Zod schema describing the expected shape of the assistant reply. When
   * present, agentos converts the schema to JSON Schema, routes through
   * the provider's native structured-output API (OpenAI json_schema,
   * Anthropic forced tool_use, Gemini responseSchema), and returns a typed
   * .object field on the result.
   *
   * Tools are disabled for the duration of a schema-aware call; see §3.
   */
  responseSchema?: S;
  /**
   * Display name for the schema in provider payloads. Surfaces in OpenAI's
   * json_schema.name and Anthropic's tool name. Defaults to 'response'.
   */
  schemaName?: string;
}

/** Typed result returned when responseSchema is set. */
export interface SessionSendStructuredResult<T> extends GenerateTextResult {
  /** The Zod-validated object, typed via z.infer. */
  object: T;
}
```

The session interface adds an overload:

```ts
export interface AgentSession {
  send(input: MessageContent): Promise<GenerateTextResult>;
  send<S extends ZodType>(
    input: MessageContent,
    opts: SessionSendOptions<S>,
  ): Promise<SessionSendStructuredResult<z.infer<S>>>;
  // ... existing stream / messages / usage / clear methods unchanged
}
```

### §4.2 `session.send` implementation

Modify the implementation at `packages/agentos/src/api/agent.ts:501`:

```ts
async send<S extends ZodType | undefined = undefined>(
  input: MessageContent,
  sendOpts?: SessionSendOptions<S>,
): Promise<S extends ZodType ? SessionSendStructuredResult<z.infer<S>> : GenerateTextResult> {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
  const userMessage: Message = { role: 'user', content: input };
  const requestMessages = useMemory ? [...history, userMessage] : [userMessage];

  // Resolve provider-specific structured-output payload when a schema is set.
  const responseFormat = sendOpts?.responseSchema
    ? buildResponseFormat({
        provider: resolveProviderForStructuredOutput(baseOpts),
        schema: sendOpts.responseSchema,
        schemaName: sendOpts.schemaName ?? 'response',
      })
    : undefined;

  // Schema-aware calls disable tools (§3). Mixing native structured
  // output with tool-calling requires a multi-turn schema+tool protocol
  // this overload doesn't speak. Strip caller-provided tools and
  // toolChoice; warn if the caller passed both so they can correct
  // their setup. Anthropic's forced tool-use mode reserves the tool
  // slot for the schema tool, and OpenAI's json_schema mode forbids
  // tools alongside.
  const baseForRequest: Partial<GenerateTextOptions> = sendOpts?.responseSchema
    ? (() => {
        if (baseOpts.tools !== undefined || baseOpts.toolChoice !== undefined) {
          console.warn(
            '[agentos] session.send: tools and toolChoice are ignored when responseSchema is set. Use generateObject for one-shot schema calls or call send() without a schema for tool-loop calls.',
          );
        }
        const { tools: _tools, toolChoice: _toolChoice, ...rest } = baseOpts;
        return rest;
      })()
    : baseOpts;

  const wrappedOpts = applyMemoryProvider(
    {
      ...baseForRequest,
      messages: requestMessages,
      usageLedger: mergeUsageLedgerOptions(baseOpts.usageLedger, {
        sessionId,
        source: 'agent.session.send',
      }),
      ...(responseFormat ? { _responseFormat: responseFormat } : {}),
    },
    opts.memoryProvider,
    textForMemory,
  );

  const result = await generateText(wrappedOpts as GenerateTextOptions);

  // Parse + validate when a schema was supplied. Throws on validation
  // failure rather than retrying — native enforcement guarantees a valid
  // shape on every successful response, so a parse failure here is a real
  // bug (provider returned a malformed payload despite enforcement).
  // Both JSON.parse failure and Zod failure surface as ObjectGenerationError
  // with the rawText attached for forensic inspection.
  let object: z.infer<NonNullable<S>> | undefined;
  if (sendOpts?.responseSchema) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch (err) {
      throw new ObjectGenerationError(
        `session.send: provider returned non-JSON despite enforcement (${err instanceof Error ? err.message : String(err)})`,
        result.text,
      );
    }
    const safe = sendOpts.responseSchema.safeParse(parsed);
    if (!safe.success) {
      throw new ObjectGenerationError(
        'session.send: provider returned schema-enforced JSON that failed Zod validation',
        result.text,
        safe.error,
      );
    }
    object = safe.data;
  }

  if (useMemory) {
    history.push(userMessage);
    history.push({ role: 'assistant', content: result.text });
  }

  return (object !== undefined
    ? ({ ...result, object } as SessionSendStructuredResult<z.infer<NonNullable<S>>>)
    : result) as any;
},
```

`resolveProviderForStructuredOutput(baseOpts)` is a new local helper at the top of `agent.ts` that returns the provider id by reading `baseOpts.provider` first, then parsing `baseOpts.model` (the `'<provider>:<model>'` string form), trimming whitespace, and falling back to `'openai'` if no provider can be derived. Used only by this code path.

For the response-text extraction: OpenAI and Gemini surface the JSON as `result.text` directly. Anthropic's forced tool_use surfaces it in the matching `tool_use` block's `input` field, but `AnthropicProvider.mapResponseToCompletion` already normalizes that into `result.text` (writing `JSON.stringify(toolBlock.input)` as the choice's content) when `responseFormat._agentosUseToolForStructuredOutput` was set. The session.send caller therefore reads `result.text` regardless of provider, which keeps this code path provider-agnostic.

### §4.3 Provider-format adapter

New file `packages/agentos/src/core/llm/providers/structuredOutputFormat.ts`:

```ts
import type { ZodType } from 'zod';
import { lowerZodToJsonSchema } from '../../../orchestration/compiler/SchemaLowering.js';

/**
 * Build a provider-specific structured-output payload from a Zod schema.
 * Returns the object that agentos plumbs through GenerateTextOptions._responseFormat
 * to the underlying provider.generateCompletion call.
 *
 * Provider matrix (April 2026):
 *   - openai     →  { type: 'json_schema', json_schema: { name, strict: true, schema } }
 *   - anthropic  →  { _agentosUseToolForStructuredOutput: true, tool: { name, input_schema } }
 *                    AnthropicProvider routes this to tools + tool_choice forced.
 *   - gemini     →  { type: 'json_object', _gemini: { responseSchema } }
 *                    GeminiProvider already maps json_object → responseMimeType; the
 *                    extra _gemini field tells it to also set responseSchema.
 *   - openrouter →  { type: 'json_object' }
 *                    OpenRouter currently exposes json_object only; degrade.
 *   - default    →  { type: 'json_object' }
 *                    Best-effort for unknown providers.
 */
export interface BuildResponseFormatInput {
  provider: string;
  schema: ZodType;
  schemaName: string;
}

export function buildResponseFormat(
  input: BuildResponseFormatInput,
): Record<string, unknown> {
  const jsonSchema = lowerZodToJsonSchema(input.schema);
  const schemaName = input.schemaName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);

  switch (input.provider) {
    case 'openai':
      return {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          strict: true,
          schema: jsonSchema,
        },
      };
    case 'anthropic':
      return {
        _agentosUseToolForStructuredOutput: true,
        tool: { name: schemaName, input_schema: jsonSchema },
      };
    case 'gemini':
    case 'gemini-cli':
      return {
        type: 'json_object',
        _gemini: { responseSchema: jsonSchema },
      };
    case 'openrouter':
    default:
      return { type: 'json_object' };
  }
}
```

The adapter is intentionally thin: each provider's `generateCompletion` keeps the full shape-translation logic local to that provider (§4.4-§4.6), preserving the layering already in agentos.

### §4.4 OpenAIProvider

OpenAI is already complete. Existing logic at [`OpenAIProvider.ts:662`](src/core/llm/providers/implementations/OpenAIProvider.ts#L662) already does:

```ts
if (options.responseFormat !== undefined) payload.response_format = options.responseFormat;
```

This passes the `{ type: 'json_schema', json_schema: { name, strict, schema } }` object straight to the OpenAI API. The API enforces schema on output. No change needed.

The only correction: tighten the type of `IProvider.responseFormat` from `{ type: 'text' | 'json_object' | string }` to also accept the json_schema shape:

```ts
// IProvider.ts (line ~137)
responseFormat?:
  | { type: 'text' | 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } }
  | Record<string, unknown>;
```

Plus tests added per §4.7.

### §4.5 AnthropicProvider

Anthropic doesn't have a `response_format` field. The structured-output equivalent is forced tool-use: declare a single `output` tool with the schema as `input_schema`, then set `tool_choice: { type: 'tool', name: 'output' }`. The model is forced to call that tool with input matching the schema; the JSON-validated input is in the response's `tool_use` block.

Modify `AnthropicProvider.generateCompletion` (around line 848 where `tool_choice` is already built):

```ts
// Detect schema-driven structured output and route to forced tool_use.
if (options.responseFormat
  && (options.responseFormat as any)._agentosUseToolForStructuredOutput
) {
  const sf = options.responseFormat as { tool: { name: string; input_schema: Record<string, unknown> } };
  // Tools are disabled when responseSchema is set (§3): the schema tool
  // is the only tool. Caller-side AgentSession.send strips its tools
  // before reaching here; this block enforces it provider-side as a
  // second line of defense for any direct provider.generateCompletion
  // caller that passes both a structured-output marker AND a tools
  // array.
  payload.tools = [{ name: sf.tool.name, input_schema: sf.tool.input_schema }];
  payload.tool_choice = { type: 'tool', name: sf.tool.name };
}
```

After response, in the response-mapping path (already exists for tool_use blocks), surface the matching block's `input` field as a JSON string in the resulting `text` so generateText callers see a JSON-string body even though the underlying mechanism is tool_use. This keeps `result.text` semantics consistent across providers and lets `session.send`'s `extractStructuredOutputText` helper (§4.2) just `JSON.stringify(toolUseBlock.input)`.

Concretely: Anthropic returns content blocks; the existing mapping at AnthropicProvider already handles tool_use. We add a line that looks for the matching tool_use block by name and writes its `JSON.stringify(input)` as the `text` of the response when forced-tool-use mode is active.

### §4.6 GeminiProvider

Gemini already maps `responseFormat.type === 'json_object'` to `responseMimeType: 'application/json'` ([GeminiProvider.ts:732](src/core/llm/providers/implementations/GeminiProvider.ts#L732)). Extend that branch to also set `responseSchema` when present:

```ts
if (options.responseFormat?.type === 'json_object') {
  generationConfig.responseMimeType = 'application/json';
  const geminiExtra = (options.responseFormat as any)._gemini;
  if (geminiExtra?.responseSchema) {
    generationConfig.responseSchema = geminiExtra.responseSchema;
  }
}
```

Gemini's structured-output enforcement is constraint-decoding; the model output text is already JSON.

### §4.7 Tests

`packages/agentos/src/api/__tests__/agent.session.send.structured.test.ts` (new):

- send(prompt, { responseSchema }) with a stub OpenAI invoker returning a valid JSON payload that matches: returns `{ ..., object: parsed }` with correct types.
- send(prompt) without options: behaves identically to before, returns plain `GenerateTextResult` (regression guard).
- session memory survives a structured call: `messages()` after a structured send shows user + assistant entries; the subsequent send sees them as context.
- ZodError is thrown when the provider returns malformed JSON despite enforcement (forced via stub).
- Tools are skipped when `responseSchema` is set (assertion that `payload.tools` is not added).

`packages/agentos/src/core/llm/providers/__tests__/structuredOutputFormat.test.ts` (new):

- `buildResponseFormat({ provider: 'openai', schema: ZodObj, schemaName: 'X' })` returns `{ type: 'json_schema', json_schema: { name: 'X', strict: true, schema } }`.
- Anthropic returns the `_agentosUseToolForStructuredOutput: true, tool: { name, input_schema }` shape.
- Gemini returns `{ type: 'json_object', _gemini: { responseSchema } }`.
- Unknown provider returns `{ type: 'json_object' }` (degrade).
- `schemaName` characters are sanitized: dots / slashes / spaces replaced with underscores; >64 chars truncated.

`packages/agentos/src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts` (new):

- generateCompletion with `responseFormat._agentosUseToolForStructuredOutput` adds the forced tool + tool_choice into the payload.
- Response mapping picks up the matching tool_use block and writes `JSON.stringify(input)` as the `text` field.

`packages/agentos/src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts` (new):

- generateCompletion with `responseFormat: { type: 'json_object', _gemini: { responseSchema } }` sets both `responseMimeType` and `responseSchema` on `generationConfig`.

`packages/agentos/src/core/llm/providers/implementations/__tests__/OpenAIProvider.structured.test.ts` (extend existing test file):

- generateCompletion with `responseFormat: { type: 'json_schema', json_schema: { ... } }` passes the entire object as `payload.response_format`.

## §5. Risks + mitigations

1. **Provider-side schema enforcement is not bug-for-bug identical across vendors.** OpenAI's strict json_schema rejects unknown fields; Anthropic's tool_use is permissive; Gemini's responseSchema currently has feature gaps (refs, oneOf). Mitigation: the spec calls out one path per provider and the per-provider test suite (§4.7) pins the exact shape we send. Where a provider chokes on a sub-feature of JSON Schema, callers see a clear provider error, not a silent fallback.
2. **`lowerZodToJsonSchema` may emit JSON Schema constructs that one provider supports and another doesn't** (e.g., `additionalProperties`, `oneOf`). Mitigation: existing orchestration graph compiler already uses this lowering against all providers; downstream issues surface in tests rather than at runtime. Schema authors keep schemas conservative.
3. **Tools are disabled when `responseSchema` is set.** A future caller may want both. Mitigation: documented in §3 and in the new `SessionSendOptions` JSDoc; a follow-up spec extends to a multi-turn schema+tool-loop pattern.
4. **OpenRouter has no schema enforcement available.** Mitigation: degrades to `json_object` (the model is asked for JSON but the schema is not enforced). Caller-side validation still runs (`safeParse`); fails fast on invalid output rather than retry. Documented in §4.3 default branch.
5. **Existing callers passing `_responseFormat: { type: 'json_object' }` (e.g. `generateObject`) keep working.** The new code paths only trigger when `responseSchema` is set on `session.send`. Mitigation: explicit branch on the new `_agentosUseToolForStructuredOutput` flag for Anthropic; OpenAI's `response_format` passthrough still accepts `json_object`.
6. **Concurrent-session-work in working tree.** agentos has uncommitted changes in `src/emergent/`, `src/memory/`, etc. None overlap the files this spec touches. Mitigation: the surgical-stage pattern (HEAD-clean diff applied via `git apply --cached`) used by paracosm-track is also valid here; the plan calls it out in §6.

## §6. Execution order

Each step ends with `npm test` from `packages/agentos/` (full suite) and a commit. Push happens on user request after all commits land.

1. Add `lowerZodToJsonSchema` import path verification + new file `structuredOutputFormat.ts` with full provider-matrix function. Tests in §4.7. Run; expect existing suite + new tests pass.
2. Tighten `IProvider.responseFormat` type to accept the `json_schema` shape (no behavior change; type-only). Existing tests pass; type-check the workspace.
3. Add `_agentosUseToolForStructuredOutput` branch to `AnthropicProvider.generateCompletion` request build + response mapping. Tests added per §4.7. Existing Anthropic tests still pass.
4. Add `_gemini.responseSchema` branch to `GeminiProvider`. Tests per §4.7.
5. Add `OpenAIProvider` structured-output test (§4.7). No code change.
6. Extend `AgentSession.send` signature + implementation per §4.1-§4.2. Add overload typing. Tests per §4.7. Verify `messages()` shows the structured assistant entry.
7. Em-dash sweep across all changed files. Per project rule (no em-dashes in agentos code or docs).
8. Final type check: `npx tsc --noEmit`. Final test: full agentos suite pass.

## §7. Success criteria

- Backward compat: every existing `session.send(input)` call returns the same shape (regression test in §4.7).
- New: `session.send(input, { responseSchema })` returns `{ ..., object: T }` with T inferred from the Zod schema.
- Provider matrix tests (§4.7) pass for OpenAI / Anthropic / Gemini / fallback.
- Session memory verified: after a structured send, `messages()` returns the user + assistant entries; the next send sees them.
- `npx tsc --noEmit` clean.
- Em-dash sweep clean.
- agentos npm package version bumps appropriately (minor: new public API).

## §8. References

- [packages/agentos/src/api/agent.ts:501](src/api/agent.ts#L501) — `AgentSession.send` impl (text-only path)
- [packages/agentos/src/api/generateText.ts:338](src/api/generateText.ts#L338) — `GenerateTextOptions._responseFormat`
- [packages/agentos/src/api/generateText.ts:931](src/api/generateText.ts#L931) — `_responseFormat → provider responseFormat` plumbing
- [packages/agentos/src/api/generateObject.ts:419](src/api/generateObject.ts#L419) — existing `json_object` usage (one-shot, no session memory)
- [packages/agentos/src/core/llm/providers/IProvider.ts:137](src/core/llm/providers/IProvider.ts#L137) — `responseFormat` type definition
- [packages/agentos/src/core/llm/providers/implementations/OpenAIProvider.ts:662](src/core/llm/providers/implementations/OpenAIProvider.ts#L662) — passthrough
- [packages/agentos/src/core/llm/providers/implementations/AnthropicProvider.ts:848](src/core/llm/providers/implementations/AnthropicProvider.ts#L848) — `tool_choice` build
- [packages/agentos/src/core/llm/providers/implementations/GeminiProvider.ts:732](src/core/llm/providers/implementations/GeminiProvider.ts#L732) — `responseMimeType` mapping
- [packages/agentos/src/orchestration/compiler/SchemaLowering.ts:38](src/orchestration/compiler/SchemaLowering.ts#L38) — `lowerZodToJsonSchema`
- paracosm consumer waiting on this primitive: [paracosm/src/runtime/llm-invocations/sendAndValidate.ts](https://github.com/framersai/paracosm/blob/master/src/runtime/llm-invocations/sendAndValidate.ts)

## §9. Glossary

- **Structured output:** the provider-level mechanism that forces the model's reply to conform to a schema. OpenAI calls this `response_format: { type: 'json_schema' }`; Anthropic uses forced tool-use; Gemini uses `responseSchema`.
- **Session memory:** the conversation history accumulated by `AgentSession`. Each `send` call appends user + assistant messages to the history; subsequent calls include the history as messages context.
- **Schema-aware send:** a `session.send` invocation with `responseSchema` set. Returns a typed object validated against the schema; raw JSON is also available on `.text`.
- **`generateObject`:** existing one-shot agentos primitive. Sets `_responseFormat: { type: 'json_object' }` and runs no session memory. Coexists with this spec.
