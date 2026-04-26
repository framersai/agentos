# Session-aware structured output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add an optional `responseSchema` parameter to `agent.session.send()` that routes through the provider's native structured-output API (OpenAI `json_schema`, Anthropic forced tool-use, Gemini `responseSchema`) while preserving session memory.

**Architecture:** Backwards-compat overload on `AgentSession.send`. New thin provider-format adapter (`structuredOutputFormat.ts`) maps a Zod schema + provider id to the per-provider payload shape. Each provider (`OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`) routes its `responseFormat` payload to the right native API surface.

**Tech Stack:** TypeScript, Zod, agentos's existing `lowerZodToJsonSchema` lowering, node:test for tests.

**Spec:** [`docs/superpowers/specs/2026-04-26-session-structured-output-design.md`](../specs/2026-04-26-session-structured-output-design.md).

**Working directory:** Always `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos`.

**Concurrent state caveat:** agentos working tree has uncommitted changes in `src/emergent/`, `src/memory/`, `src/memory-router/`, etc. None overlap the files this plan touches. Stage explicit file paths only — no `git add -A`.

---

## File map

**Created:**
- `src/core/llm/providers/structuredOutputFormat.ts` — provider-format adapter
- `src/api/__tests__/agent.session.send.structured.test.ts`
- `src/core/llm/providers/__tests__/structuredOutputFormat.test.ts`
- `src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts`
- `src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts`

**Modified:**
- `src/api/agent.ts` — overload + impl on `AgentSession.send`; export `SessionSendOptions` + `SessionSendStructuredResult`
- `src/api/index.ts` — re-export new public types
- `src/core/llm/providers/IProvider.ts` — tighten `responseFormat` type
- `src/core/llm/providers/implementations/AnthropicProvider.ts` — forced tool-use branch
- `src/core/llm/providers/implementations/GeminiProvider.ts` — `responseSchema` branch
- `src/core/llm/providers/implementations/__tests__/OpenAIProvider.test.ts` — extend with json_schema passthrough test (existing test file)

**Read-only references:**
- `src/api/generateText.ts:338` — `_responseFormat` declaration
- `src/api/generateText.ts:931` — provider call passthrough
- `src/orchestration/compiler/SchemaLowering.ts:38` — `lowerZodToJsonSchema`

---

## Task 1: Provider-format adapter + tests

**Files:**
- Create: `src/core/llm/providers/structuredOutputFormat.ts`
- Create: `src/core/llm/providers/__tests__/structuredOutputFormat.test.ts`

- [ ] **Step 1.1: Implement `buildResponseFormat`**

```ts
// src/core/llm/providers/structuredOutputFormat.ts
import type { ZodType } from 'zod';
import { lowerZodToJsonSchema } from '../../../orchestration/compiler/SchemaLowering.js';

export interface BuildResponseFormatInput {
  provider: string;
  schema: ZodType;
  schemaName: string;
}

const NAME_RE = /[^a-zA-Z0-9_]/g;

export function buildResponseFormat(
  input: BuildResponseFormatInput,
): Record<string, unknown> {
  const jsonSchema = lowerZodToJsonSchema(input.schema);
  const schemaName = input.schemaName.replace(NAME_RE, '_').slice(0, 64) || 'response';

  switch (input.provider) {
    case 'openai':
      return {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema: jsonSchema },
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

- [ ] **Step 1.2: Tests**

```ts
// src/core/llm/providers/__tests__/structuredOutputFormat.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildResponseFormat } from '../structuredOutputFormat.js';

const schema = z.object({ a: z.string(), b: z.number() });

test('openai returns json_schema with strict=true and sanitized name', () => {
  const r = buildResponseFormat({ provider: 'openai', schema, schemaName: 'My.Schema' });
  assert.equal((r as any).type, 'json_schema');
  assert.equal((r as any).json_schema.name, 'My_Schema');
  assert.equal((r as any).json_schema.strict, true);
  assert.equal(typeof (r as any).json_schema.schema, 'object');
});

test('anthropic returns _agentosUseToolForStructuredOutput marker + tool shape', () => {
  const r = buildResponseFormat({ provider: 'anthropic', schema, schemaName: 'X' });
  assert.equal((r as any)._agentosUseToolForStructuredOutput, true);
  assert.equal((r as any).tool.name, 'X');
  assert.equal(typeof (r as any).tool.input_schema, 'object');
});

test('gemini returns json_object with _gemini.responseSchema', () => {
  const r = buildResponseFormat({ provider: 'gemini', schema, schemaName: 'X' });
  assert.equal((r as any).type, 'json_object');
  assert.equal(typeof (r as any)._gemini.responseSchema, 'object');
});

test('openrouter degrades to json_object', () => {
  const r = buildResponseFormat({ provider: 'openrouter', schema, schemaName: 'X' });
  assert.deepEqual(r, { type: 'json_object' });
});

test('unknown provider degrades to json_object', () => {
  const r = buildResponseFormat({ provider: 'unknown', schema, schemaName: 'X' });
  assert.deepEqual(r, { type: 'json_object' });
});

test('schemaName is sanitized: replaces non-word chars with underscore, truncates to 64', () => {
  const long = 'a'.repeat(80) + '!@#';
  const r = buildResponseFormat({ provider: 'openai', schema, schemaName: long });
  const n = (r as any).json_schema.name as string;
  assert.equal(n.length, 64);
  assert.match(n, /^[a-zA-Z0-9_]+$/);
});

test('empty/all-invalid schemaName falls back to "response"', () => {
  const r = buildResponseFormat({ provider: 'openai', schema, schemaName: '!!!' });
  assert.equal((r as any).json_schema.name, 'response');
});
```

- [ ] **Step 1.3: Run tests**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos
npx tsc --noEmit  # verify type check
npm test -- --grep "structuredOutputFormat" 2>&1 | tail -10
```

Expected: tsc clean. All 7 tests pass.

- [ ] **Step 1.4: Em-dash sweep + commit**

```bash
perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' \
  src/core/llm/providers/structuredOutputFormat.ts \
  src/core/llm/providers/__tests__/structuredOutputFormat.test.ts && echo clean
git add src/core/llm/providers/structuredOutputFormat.ts \
        src/core/llm/providers/__tests__/structuredOutputFormat.test.ts
git commit -m "feat(structured-output): provider-format adapter for session-aware schema enforcement

New thin adapter `buildResponseFormat` that maps a Zod schema + provider id
to the per-provider payload shape used by GenerateTextOptions._responseFormat.

Provider matrix (April 2026):
  - openai     → { type: 'json_schema', json_schema: { name, strict: true, schema } }
  - anthropic  → { _agentosUseToolForStructuredOutput: true, tool: { name, input_schema } }
  - gemini     → { type: 'json_object', _gemini: { responseSchema } }
  - openrouter → { type: 'json_object' } (degrades; OpenRouter has no schema enforcement)
  - default    → { type: 'json_object' } (best-effort for unknown providers)

Schema name sanitization: non-[a-zA-Z0-9_] chars → underscore, max 64 chars,
falls back to 'response' if all input chars were invalid. OpenAI's
json_schema.name and Anthropic's tool name both have charset constraints
this satisfies.

Pure adapter; no provider behavior changes in this commit. Per-provider
routing of the _agentosUseToolForStructuredOutput / _gemini fields lands
in the next two commits."
```

---

## Task 2: Tighten `IProvider.responseFormat` type

**Files:**
- Modify: `src/core/llm/providers/IProvider.ts`

- [ ] **Step 2.1: Update the type**

Open `src/core/llm/providers/IProvider.ts`. Find `responseFormat?:` (around line 137). Change from:

```ts
responseFormat?: { type: 'text' | 'json_object' | string };
```

to:

```ts
/**
 * Response-format constraint for the provider call. Shape is
 * provider-specific; the adapter at
 * `src/core/llm/providers/structuredOutputFormat.ts` builds the right
 * shape per provider given a Zod schema. Examples:
 *   - OpenAI:    { type: 'json_object' }
 *   - OpenAI:    { type: 'json_schema', json_schema: { name, strict, schema } }
 *   - Anthropic: { _agentosUseToolForStructuredOutput: true, tool: {...} }
 *   - Gemini:    { type: 'json_object', _gemini: { responseSchema } }
 */
responseFormat?:
  | { type: 'text' | 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } }
  | Record<string, unknown>;
```

- [ ] **Step 2.2: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors. The new union is a superset; existing callers compile.

- [ ] **Step 2.3: Em-dash sweep + commit**

```bash
perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' src/core/llm/providers/IProvider.ts && echo clean
git add src/core/llm/providers/IProvider.ts
git commit -m "chore(IProvider): tighten responseFormat type to admit json_schema shape

The previous union ({ type: 'text' | 'json_object' | string }) accepted
the json_schema shape via the catch-all string but didn't document or
type the json_schema sub-fields. Tightens to a discriminated union plus
a Record<string, unknown> escape hatch for provider-specific extras
(Anthropic _agentosUseToolForStructuredOutput, Gemini _gemini, etc.).

No behavior change. Existing { type: 'text' } and { type: 'json_object' }
calls compile unchanged."
```

---

## Task 3: AnthropicProvider forced tool-use

**Files:**
- Modify: `src/core/llm/providers/implementations/AnthropicProvider.ts`
- Create: `src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts`

- [ ] **Step 3.1: Add forced tool-use branch in request build**

Locate the existing request build around `tool_choice` setup (current line 848). Right after the `tool_choice` branch, add:

```ts
// Schema-driven structured output via forced tool_use. The provider-format
// adapter (structuredOutputFormat.ts) signals this mode by setting
// _agentosUseToolForStructuredOutput on responseFormat. We add the
// schema as a single tool and force the model to call it; the JSON-validated
// input shows up in the response's tool_use block.
const sf = options.responseFormat as
  | { _agentosUseToolForStructuredOutput?: boolean; tool?: { name: string; input_schema: Record<string, unknown> } }
  | undefined;
if (sf?._agentosUseToolForStructuredOutput && sf.tool) {
  // Tools disabled when schema is set (per spec §3). The schema tool
  // is the only tool; caller-provided tools are dropped by
  // AgentSession.send before reaching here. This is the provider-side
  // enforcement.
  payload.tools = [{ name: sf.tool.name, input_schema: sf.tool.input_schema }];
  payload.tool_choice = { type: 'tool', name: sf.tool.name };
}
```

- [ ] **Step 3.2: Add response-mapping branch**

Find the existing tool_use response-mapping logic (search for `tool_use` in the file). After mapping content blocks, when the structured-output mode was active and a matching tool_use block exists, set the response's `text` field to `JSON.stringify(matchingBlock.input)` so generateText callers see a JSON-string result. This keeps the API surface uniform across providers (everything looks like `result.text` is a JSON string).

```ts
// (in mapApiToCompletionResponse or equivalent, after content blocks
// are mapped to choices[].message.content)
if (structuredOutputName) {  // captured from the request-build step
  const toolBlock = apiResponse.content?.find(
    (b): b is { type: 'tool_use'; name: string; input: unknown } =>
      b.type === 'tool_use' && (b as any).name === structuredOutputName,
  );
  if (toolBlock) {
    // Surface the structured payload as text so callers using
    // result.text receive valid JSON; tool_use block remains in
    // choices[0].message.tool_calls for callers that prefer it.
    choice.message.content = JSON.stringify(toolBlock.input);
  }
}
```

The `structuredOutputName` is captured from `sf.tool.name` in the request-build step and threaded into the mapping function via closure or instance variable.

- [ ] **Step 3.3: Tests**

```ts
// src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../AnthropicProvider.js';

test('AnthropicProvider: _agentosUseToolForStructuredOutput adds forced tool + tool_choice', async () => {
  // Stub the underlying fetch / axios call to capture the payload sent.
  // (Use the existing test scaffolding pattern from AnthropicProvider tests.)
  // ... assert payload.tools[0].name === 'CommanderDecision'
  // ... assert payload.tool_choice === { type: 'tool', name: 'CommanderDecision' }
});

test('AnthropicProvider: response with matching tool_use block surfaces input as text', async () => {
  // Stub response with a tool_use content block named 'CommanderDecision'
  // and input = { decision: 'X', rationale: 'Y' }.
  // Assert result.choices[0].message.content === JSON.stringify({ decision: 'X', rationale: 'Y' }).
});
```

(Test bodies follow the pattern of existing AnthropicProvider tests — the plan-executor consults the existing test file shape and replicates its scaffolding.)

- [ ] **Step 3.4: Run tests + em-dash sweep + commit**

```bash
npx tsc --noEmit && \
  npm test -- --grep "AnthropicProvider" 2>&1 | tail -10 && \
  perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' \
    src/core/llm/providers/implementations/AnthropicProvider.ts \
    src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts && echo clean
git add src/core/llm/providers/implementations/AnthropicProvider.ts \
        src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts
git commit -m "feat(AnthropicProvider): forced tool-use for schema-enforced structured output

Anthropic doesn't have an OpenAI-style response_format with json_schema.
The equivalent is forced tool_use: declare a single tool whose input_schema
matches the desired output shape, then force tool_choice to that tool.
The model returns a tool_use block whose input is JSON-validated against
the schema by Anthropic's own enforcement.

The provider-format adapter signals this mode via
_agentosUseToolForStructuredOutput: true plus tool: { name, input_schema }.
The provider:
  - Adds the schema as a single forced tool to the payload
  - Sets tool_choice: { type: 'tool', name }
  - In response mapping, finds the matching tool_use block and surfaces
    its input as JSON-string content on the choice's message, so
    callers using result.text get valid JSON identical in shape to
    OpenAI's json_schema response

Existing tool-call flows (caller-provided tools, normal tool_choice)
are unchanged; the schema mode only triggers when the marker is set."
```

---

## Task 4: GeminiProvider responseSchema

**Files:**
- Modify: `src/core/llm/providers/implementations/GeminiProvider.ts`
- Create: `src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts`

- [ ] **Step 4.1: Extend the responseFormat → generationConfig branch**

Open `src/core/llm/providers/implementations/GeminiProvider.ts`. Find the existing branch (current line 732):

```ts
if (options.responseFormat?.type === 'json_object') {
  generationConfig.responseMimeType = 'application/json';
}
```

Extend to:

```ts
if (options.responseFormat?.type === 'json_object') {
  generationConfig.responseMimeType = 'application/json';
  const geminiExtra = (options.responseFormat as { _gemini?: { responseSchema?: Record<string, unknown> } })._gemini;
  if (geminiExtra?.responseSchema) {
    generationConfig.responseSchema = geminiExtra.responseSchema;
  }
}
```

- [ ] **Step 4.2: Tests**

```ts
// src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../GeminiProvider.js';

test('GeminiProvider: json_object + _gemini.responseSchema sets both responseMimeType and responseSchema', async () => {
  // Stub fetch, capture generationConfig in the payload.
  // Build options with responseFormat: { type: 'json_object', _gemini: { responseSchema: {...} } }.
  // Assert generationConfig.responseMimeType === 'application/json'.
  // Assert generationConfig.responseSchema is the passed schema.
});

test('GeminiProvider: bare json_object still works (no responseSchema)', async () => {
  // Backward-compat: responseFormat = { type: 'json_object' } (no _gemini).
  // Assert responseMimeType set, responseSchema NOT set.
});
```

- [ ] **Step 4.3: Run + commit**

```bash
npx tsc --noEmit && npm test -- --grep "GeminiProvider" 2>&1 | tail -10
perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' \
  src/core/llm/providers/implementations/GeminiProvider.ts \
  src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts && echo clean
git add src/core/llm/providers/implementations/GeminiProvider.ts \
        src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts
git commit -m "feat(GeminiProvider): responseSchema for schema-enforced structured output

Extends the existing responseFormat.type === 'json_object' branch to
also set generationConfig.responseSchema when _gemini.responseSchema
is present. Gemini enforces the schema via constrained decoding; the
returned text is already valid JSON conforming to the schema.

Backward compat: bare { type: 'json_object' } still works without the
_gemini extra and only sets responseMimeType (the existing behavior)."
```

---

## Task 5: OpenAIProvider passthrough test

**Files:**
- Modify: `src/core/llm/providers/implementations/__tests__/OpenAIProvider.test.ts` (or create the focused test if the existing file is too large)

- [ ] **Step 5.1: Verify existing passthrough still works**

OpenAIProvider already passes any `responseFormat` straight through to `payload.response_format` at line 662. No code change required. Add a test to lock the behavior so future refactors can't silently regress it:

```ts
test('OpenAIProvider: responseFormat with type=json_schema is passed verbatim to payload.response_format', async () => {
  // Stub fetch, capture payload.
  const rf = {
    type: 'json_schema',
    json_schema: { name: 'X', strict: true, schema: { type: 'object', properties: {} } },
  };
  // Call generateCompletion with options.responseFormat = rf.
  // Assert payload.response_format === rf.
});
```

- [ ] **Step 5.2: Run + commit**

```bash
npm test -- --grep "OpenAIProvider" 2>&1 | tail -10
git add src/core/llm/providers/implementations/__tests__/OpenAIProvider.test.ts
git commit -m "test(OpenAIProvider): lock json_schema responseFormat passthrough

Existing OpenAIProvider.generateCompletion line 662 already passes any
options.responseFormat straight to the OpenAI API as response_format.
No code change. Adds a regression test that pins the json_schema shape
so future refactors can't silently strip the structured-output payload."
```

---

## Task 6: AgentSession.send overload + structured execution path

**Files:**
- Modify: `src/api/agent.ts`
- Modify: `src/api/index.ts`
- Create: `src/api/__tests__/agent.session.send.structured.test.ts`

- [ ] **Step 6.1: Add new public types**

In `src/api/agent.ts` (above the `AgentSession` interface):

```ts
import type { ZodType, z } from 'zod';

export interface SessionSendOptions<S extends ZodType | undefined = undefined> {
  /**
   * Zod schema describing the expected shape of the assistant reply. When
   * present, agentos converts the schema to JSON Schema, routes through
   * the provider's native structured-output API, and returns a typed
   * .object field on the result. Tools are disabled for the duration of
   * a schema-aware call (see spec §3).
   */
  responseSchema?: S;
  /**
   * Display name for the schema in provider payloads (OpenAI's
   * json_schema.name, Anthropic's tool name). Defaults to 'response'.
   */
  schemaName?: string;
}

export interface SessionSendStructuredResult<T> extends GenerateTextResult {
  /** Zod-validated typed object. */
  object: T;
}
```

- [ ] **Step 6.2: Update the AgentSession interface with overload**

```ts
export interface AgentSession {
  id: string;
  send(input: MessageContent): Promise<GenerateTextResult>;
  send<S extends ZodType>(
    input: MessageContent,
    opts: SessionSendOptions<S> & { responseSchema: S },
  ): Promise<SessionSendStructuredResult<z.infer<S>>>;
  stream(input: MessageContent): StreamTextResult;
  messages(): Message[];
  usage(): Promise<AgentOSUsageAggregate>;
  clear(): void;
}
```

- [ ] **Step 6.3: Update the implementation in `agent.ts:501`**

Replace the existing `async send` method body with a single implementation that handles both branches:

```ts
async send(input: MessageContent, sendOpts?: SessionSendOptions<any>): Promise<any> {
  const textForMemory = typeof input === 'string' ? input : extractTextFromContent(input);
  const userMessage: Message = { role: 'user', content: input };
  const requestMessages = useMemory ? [...history, userMessage] : [userMessage];

  const responseFormat = sendOpts?.responseSchema
    ? buildResponseFormat({
        provider: resolveProviderForStructuredOutput(baseOpts),
        schema: sendOpts.responseSchema,
        schemaName: sendOpts.schemaName ?? 'response',
      })
    : undefined;

  // Tools are disabled for the duration of a schema-aware call (spec §3).
  // Forced tool_use on Anthropic uses the schema as the only tool; mixing
  // caller tools with the schema tool produces unpredictable model behavior.
  // Strip caller-provided tools/toolChoice from baseOpts when responseSchema
  // is set, with a console.warn so callers notice the override.
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

  // Validate + parse when a schema was supplied. Native enforcement
  // guarantees a valid shape on every successful response, so a
  // parse/validation failure here is a real provider bug rather
  // than retry-worthy. Throw with the rawText + Zod error attached.
  let object: unknown;
  if (sendOpts?.responseSchema) {
    try {
      const parsed = JSON.parse(result.text);
      const safe = sendOpts.responseSchema.safeParse(parsed);
      if (!safe.success) {
        throw new ObjectGenerationError(
          'session.send: provider-enforced JSON failed Zod validation',
          result.text,
          safe.error,
        );
      }
      object = safe.data;
    } catch (err) {
      if (err instanceof ObjectGenerationError) throw err;
      throw new ObjectGenerationError(
        `session.send: provider response is not valid JSON despite enforcement (${err instanceof Error ? err.message : String(err)})`,
        result.text,
      );
    }
  }

  if (useMemory) {
    history.push(userMessage);
    history.push({ role: 'assistant', content: result.text });
  }

  return object !== undefined
    ? ({ ...result, object } as SessionSendStructuredResult<unknown>)
    : result;
},
```

`resolveProviderForStructuredOutput(baseOpts)` is a local helper (top of file). It mirrors the provider-resolution rules used elsewhere in agentos (explicit `provider` wins; otherwise parse the `provider:model` head; otherwise default to `openai`). Trim + empty-check on the parsed head to avoid producing `''` from a malformed `':gpt-4o'` model string:

```ts
function resolveProviderForStructuredOutput(opts: Partial<GenerateTextOptions>): string {
  if (opts.provider) return opts.provider;
  if (typeof opts.model === 'string' && opts.model.includes(':')) {
    const head = opts.model.split(':', 1)[0]?.trim();
    if (head) return head;
  }
  return 'openai'; // existing default
}
```

`ObjectGenerationError` is imported from agentos's existing error module (used by `generateObject` already): `import { ObjectGenerationError } from './generateObject.js';`. The constructor signature is `(message: string, rawText: string, validationError?: Error)`.

`buildResponseFormat` import from Task 1: `import { buildResponseFormat } from '../core/llm/providers/structuredOutputFormat.js';`.

- [ ] **Step 6.4: Re-export new public types**

In `src/api/index.ts` add:

```ts
export type { SessionSendOptions, SessionSendStructuredResult } from './agent.js';
```

(Or wherever existing AgentSession types are re-exported — match the existing convention.)

- [ ] **Step 6.5: Tests**

```ts
// src/api/__tests__/agent.session.send.structured.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { agent } from '../agent.js';
// (Use the same stub-provider scaffolding the existing agent.session tests use.)

const SimpleSchema = z.object({ verdict: z.string(), confidence: z.number().min(0).max(1) });

test('session.send without responseSchema returns plain GenerateTextResult (regression guard)', async () => {
  const a = agent({ model: 'openai:gpt-4o-mini', /* stub fetch */ });
  const s = a.session();
  const r = await s.send('hello');
  assert.equal(typeof r.text, 'string');
  assert.equal('object' in r, false);
});

test('session.send with responseSchema returns typed object alongside text', async () => {
  // Stub generateText to return text='{"verdict":"yes","confidence":0.92}'.
  const a = agent({ model: 'openai:gpt-4o-mini', /* stub */ });
  const s = a.session();
  const r = await s.send('decide', { responseSchema: SimpleSchema });
  assert.equal(r.object.verdict, 'yes');
  assert.equal(r.object.confidence, 0.92);
  assert.equal(typeof r.text, 'string');
});

test('session memory survives a schema-aware send: messages() shows both turns', async () => {
  // After the structured send above, s.messages() includes user 'decide' and assistant raw JSON.
  // Verify the next send sees them as context (assert request payload includes prior messages).
});

test('schema validation failure throws ObjectGenerationError', async () => {
  // Stub generateText to return text='{"verdict":"yes"}' (missing confidence).
  // Assert thrown error is ObjectGenerationError with .zodError populated.
});

test('tools are not added when responseSchema is set', async () => {
  // Stub generateText, capture wrappedOpts. Verify no tools field
  // (or tools is empty) when responseSchema is in sendOpts and the
  // caller didn't explicitly pass tools.
});
```

- [ ] **Step 6.6: Run + em-dash sweep + commit**

```bash
npx tsc --noEmit && \
  npm test 2>&1 | grep -E "^(ok|tests|pass|fail|skipped)" | tail -10 && \
  perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' \
    src/api/agent.ts src/api/index.ts \
    src/api/__tests__/agent.session.send.structured.test.ts && echo clean
git add src/api/agent.ts src/api/index.ts src/api/__tests__/agent.session.send.structured.test.ts
git commit -m "feat(agent): session.send accepts responseSchema for typed structured output

Extends AgentSession.send with an optional second parameter:

  send<S extends ZodType>(
    input: MessageContent,
    opts: { responseSchema: S; schemaName?: string },
  ): Promise<GenerateTextResult & { object: z.infer<S> }>

When responseSchema is set:
  1. Zod schema → JSON Schema via lowerZodToJsonSchema
  2. Provider-specific payload via buildResponseFormat (Task 1)
  3. Native structured-output enforcement at the provider call
     (OpenAI json_schema, Anthropic forced tool_use, Gemini responseSchema)
  4. Response text is parsed as JSON, validated against the Zod schema,
     and returned as result.object
  5. Session memory updates the same as the text path: user input and
     assistant text both append to history; subsequent sends see them
  6. ObjectGenerationError thrown if provider returns schema-enforced
     JSON that still fails Zod validation (real bug, not retry-worthy)

Backward compat: send(input) without options behaves identically to
before. No changes to stream / messages / usage / clear.

This is the agentos primitive paracosm's sendAndValidate has been
emulating with a retry-with-feedback loop. paracosm migration to this
API lands as a separate paracosm-track commit."
```

---

## Task 7: Final verification (no commit)

- [ ] **Step 7.1: Full type check**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7.2: Full test suite**

```bash
npm test 2>&1 | grep -E "^(ok|tests|pass|fail|skipped)" | tail -5
```

Expected: existing-test-count + ~25 new tests, 0 fail.

- [ ] **Step 7.3: Commit history review**

```bash
git log --oneline 9a907337..HEAD
```

Expected: 6 commits in this order:
1. `feat(structured-output): provider-format adapter for session-aware schema enforcement`
2. `chore(IProvider): tighten responseFormat type to admit json_schema shape`
3. `feat(AnthropicProvider): forced tool-use for schema-enforced structured output`
4. `feat(GeminiProvider): responseSchema for schema-enforced structured output`
5. `test(OpenAIProvider): lock json_schema responseFormat passthrough`
6. `feat(agent): session.send accepts responseSchema for typed structured output`

- [ ] **Step 7.4: Em-dash sweep across all changed files**

```bash
perl -ne 'print "$ARGV:$.: $_" if /\x{2014}/' \
  src/core/llm/providers/structuredOutputFormat.ts \
  src/core/llm/providers/IProvider.ts \
  src/core/llm/providers/implementations/AnthropicProvider.ts \
  src/core/llm/providers/implementations/GeminiProvider.ts \
  src/api/agent.ts src/api/index.ts \
  src/core/llm/providers/__tests__/structuredOutputFormat.test.ts \
  src/api/__tests__/agent.session.send.structured.test.ts \
  src/core/llm/providers/implementations/__tests__/AnthropicProvider.structured.test.ts \
  src/core/llm/providers/implementations/__tests__/GeminiProvider.structured.test.ts \
  src/core/llm/providers/implementations/__tests__/OpenAIProvider.test.ts
```

Expected: no output.

- [ ] **Step 7.5: Manual smoke against the new API**

```ts
import { agent } from '@framers/agentos';
import { z } from 'zod';

const a = agent({ model: 'openai:gpt-4o' });
const s = a.session();
const { object } = await s.send('Decide whether to ship: yes/no with confidence 0-1', {
  responseSchema: z.object({ verdict: z.enum(['yes', 'no']), confidence: z.number() }),
});
console.log(object); // typed { verdict: 'yes' | 'no', confidence: number }
```

Run from a scratch script with a real `OPENAI_API_KEY`. Confirm typed object printed; no schema-fallback log lines emitted.

---

## Self-review

- §4.1 spec types → Task 6.1 implementation. Match.
- §4.2 spec impl → Task 6.3 implementation. Match.
- §4.3 spec adapter → Task 1 implementation. Match.
- §4.4 spec OpenAI passthrough → Task 5 (test only, code unchanged). Match.
- §4.5 spec Anthropic forced tool-use → Task 3 implementation. Match.
- §4.6 spec Gemini responseSchema → Task 4 implementation. Match.
- §4.7 spec tests → split across Tasks 1, 3, 4, 5, 6. Match.
- §5 spec risks → Task 6 throws on Zod failure (risk #1, #4); Task 1 sanitizes name (impl detail).
- §6 spec execution order → matches Task 1-6 numbering.

No placeholder strings; all `<TBD>` placeholders eliminated. Type names consistent across tasks: `SessionSendOptions`, `SessionSendStructuredResult`, `BuildResponseFormatInput`, `_agentosUseToolForStructuredOutput`.

---

## Execution handoff

Use `superpowers:executing-plans` to implement task-by-task. Per agentos repo convention (master branch only, push only on user request), commit per task per plan; push after Task 7 verification with explicit user approval.
