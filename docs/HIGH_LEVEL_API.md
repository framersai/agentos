# High-Level API

AgentOS now exposes two public layers from the root package:

- High-level helpers: `generateText()`, `streamText()`, `generateImage()`, `agent()`
- Full runtime: `new AgentOS()` with `processRequest()`, personas, workflows, extensions, and chunk-level orchestration

Use the high-level API when you want the fastest path to text generation, streaming, and lightweight stateful sessions. Use `AgentOS` directly when you need the full runtime.

When AgentOS observability is enabled, these helper APIs also emit opt-in OTEL spans and turn metrics. `generateText()` and `streamText()` attach provider/model/token usage and aggregated cost when the provider returns it; `generateImage()` does the same for image-generation usage.

If you also want durable helper-level accounting, set `usageLedger.path`, set `usageLedger.enabled: true`, or export `AGENTOS_USAGE_LEDGER_PATH` / `WUNDERLAND_USAGE_LEDGER_PATH`. With `enabled: true`, helper usage lands in the shared home ledger at `~/.framers/usage-ledger.jsonl` unless you provide an explicit path.

## When to use which

| API               | Best for                                                                                        | Tradeoff                                  |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `generateText()`  | One-shot text or tool-calling turns                                                             | No persistent session state               |
| `streamText()`    | Stream text or tool-calling results immediately                                                 | Stateless per call                        |
| `generateImage()` | Provider-agnostic image generation from a single prompt                                         | Provider feature support varies           |
| `agent()`         | Lightweight multi-turn sessions with in-memory history                                          | Does not replace the full AgentOS runtime |
| `AgentOS`         | Personas, extensions, workflows, multi-agent orchestration, guardrails, HITL, runtime lifecycle | More setup, more control                  |

## Provider Resolution

### Calling Styles

AgentOS supports three styles for specifying provider and model. **Provider-first is recommended:**

```ts
// 1. Provider-first (recommended) — AgentOS picks the best default model
await generateText({ provider: 'openai', prompt: '...' });

// 2. Provider + explicit model — full control
await generateText({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', prompt: '...' });

// 3. Legacy colon format — backwards compatible, still works
await generateText({ model: 'openai:gpt-4o', prompt: '...' });
```

### Provider Defaults

When you supply `provider` without an explicit `model`, AgentOS resolves the default model
for the requested task automatically:

| Provider                 | Type  | Text default               | Image default                    | Embedding default        | Env var                           |
| ------------------------ | ----- | -------------------------- | -------------------------------- | ------------------------ | --------------------------------- |
| `openai`                 | Cloud | `gpt-4o`                   | `gpt-image-1`                    | `text-embedding-3-small` | `OPENAI_API_KEY`                  |
| `anthropic`              | Cloud | `claude-sonnet-4-20250514` | —                                | —                        | `ANTHROPIC_API_KEY`               |
| `gemini`                 | Cloud | `gemini-2.5-flash`         | —                                | —                        | `GEMINI_API_KEY`                  |
| `openrouter`             | Cloud | `openai/gpt-4o`            | —                                | —                        | `OPENROUTER_API_KEY`              |
| `stability`              | Cloud | —                          | `stable-diffusion-xl-1024-v1-0`  | —                        | `STABILITY_API_KEY`               |
| `replicate`              | Cloud | —                          | `black-forest-labs/flux-1.1-pro` | —                        | `REPLICATE_API_TOKEN`             |
| `ollama`                 | Local | `llama3.2`                 | `stable-diffusion`               | `nomic-embed-text`       | `OLLAMA_BASE_URL`                 |
| `stable-diffusion-local` | Local | —                          | `v1-5-pruned-emaonly`            | —                        | `STABLE_DIFFUSION_LOCAL_BASE_URL` |

When neither `provider` nor `model` is given, the first set API key env var is used
(`OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → `OPENROUTER_API_KEY` → `GEMINI_API_KEY` → `OLLAMA_BASE_URL`).

### Local Providers

Local providers don't require API keys — just a `baseUrl` (or the corresponding env var):

```ts
// Ollama — runs any GGUF model locally
await generateText({
  provider: 'ollama',
  model: 'llama3.2',
  prompt: 'Explain quantum entanglement simply.',
  baseUrl: 'http://localhost:11434', // or set OLLAMA_BASE_URL
});

// Anthropic fallback: if ANTHROPIC_API_KEY is unset but OPENROUTER_API_KEY is set,
// AgentOS automatically routes anthropic requests through OpenRouter.
```

## `generateText()`

```ts
import { generateText } from '@framers/agentos';

// Provider-first (recommended): AgentOS picks the default model for the provider.
const { text, usage } = await generateText({
  provider: 'openai',
  prompt: 'Summarize the TCP three-way handshake in 3 bullets.',
});

console.log(text);
console.log(usage.totalTokens);

// Legacy format — still supported:
// const { text } = await generateText({ model: 'openai:gpt-4.1-mini', prompt: '...' });
```

`generateText({ tools })` and `streamText({ tools })` now accept three useful
forms:

- A named high-level tool map
- An `ExternalToolRegistry` (`Record`, `Map`, or iterable)
- A prompt-only `ToolDefinitionForLLM[]`

External registries are exposed to the model and executed when called.
Prompt-only `ToolDefinitionForLLM[]` are exposed to the model too, but if the
model calls one without an executor attached, AgentOS returns an explicit tool
error instead of silently no-oping.

The same `tools` forms now work on `agent({ tools })` and `agency({ tools })`.
When an agency-level tool set is combined with per-agent tools, AgentOS
normalizes both sides first and then merges by tool name, with the per-agent
tool winning on collisions.

Persist helper usage for later inspection:

```ts
import { generateText, getRecordedAgentOSUsage } from '@framers/agentos';

await generateText({
  provider: 'openai',
  prompt: 'Summarize QUIC in one sentence.',
  usageLedger: {
    enabled: true,
    sessionId: 'demo-session',
  },
});

const totals = await getRecordedAgentOSUsage({ enabled: true, sessionId: 'demo-session' });
console.log(totals.totalTokens);
```

## `streamText()`

```ts
import { streamText } from '@framers/agentos';

const result = streamText({
  provider: 'openai',
  prompt: 'Stream a short explanation of how TLS differs from TCP.',
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}

console.log(await result.text);
```

## `generateImage()`

```ts
import { generateImage } from '@framers/agentos';

// Provider-first: resolves to gpt-image-1 by default for openai.
const result = await generateImage({
  provider: 'openai',
  prompt: 'A cinematic neon city skyline reflected in rain at night.',
  outputFormat: 'png',
});

console.log(result.provider);
console.log(result.images[0]?.mimeType);
```

### Built-in Image Providers

| Provider                 | Type      | Default model                    | API key env var       |
| ------------------------ | --------- | -------------------------------- | --------------------- |
| `openai`                 | Cloud API | `gpt-image-1`                    | `OPENAI_API_KEY`      |
| `stability`              | Cloud API | `stable-diffusion-xl-1024-v1-0`  | `STABILITY_API_KEY`   |
| `replicate`              | Cloud API | `black-forest-labs/flux-1.1-pro` | `REPLICATE_API_TOKEN` |
| `openrouter`             | Cloud API | —                                | `OPENROUTER_API_KEY`  |
| `ollama`                 | Local     | `stable-diffusion`               | None (uses `baseUrl`) |
| `stable-diffusion-local` | Local     | `v1-5-pruned-emaonly`            | None (uses `baseUrl`) |

### Provider-Specific Options

Use the common options for the simple path, then drop down to namespaced
`providerOptions` when you need provider-native controls:

```ts
import { generateImage } from '@framers/agentos';

const poster = await generateImage({
  provider: 'stability',
  model: 'stable-image-core',
  prompt: 'An art deco travel poster for a moon colony',
  negativePrompt: 'text, watermark',
  providerOptions: {
    stability: {
      stylePreset: 'illustration',
      seed: 42,
      cfgScale: 8,
    },
  },
});

console.log(poster.images[0]?.mimeType);
```

Replicate and OpenRouter work the same way:

```ts
const replicateResult = await generateImage({
  provider: 'replicate',
  model: 'black-forest-labs/flux-schnell',
  prompt: 'A product photo of a titanium watch on black stone',
  aspectRatio: '16:9',
  providerOptions: {
    replicate: {
      outputQuality: 90,
      input: {
        go_fast: true,
      },
    },
  },
});
```

### Local Image Generation

Run Stable Diffusion locally without any API key:

```ts
// Via Ollama (if your Ollama install has a stable-diffusion model)
const local = await generateImage({
  provider: 'ollama',
  model: 'stable-diffusion',
  prompt: 'A watercolor landscape of rolling hills',
  baseUrl: 'http://localhost:11434', // or set OLLAMA_BASE_URL
});

// Via local Stable Diffusion WebUI (Automatic1111 / ComfyUI)
const sdLocal = await generateImage({
  provider: 'stable-diffusion-local',
  model: 'v1-5-pruned-emaonly',
  prompt: 'A brutalist house in fog',
  baseUrl: 'http://localhost:7860', // or set STABLE_DIFFUSION_LOCAL_BASE_URL
});
```

### Custom Image Provider

Register a provider factory for backends not covered by the built-ins:

```ts
import { generateImage, registerImageProviderFactory, type IImageProvider } from '@framers/agentos';

class ComfyUIProvider implements IImageProvider {
  providerId = 'comfyui';
  isInitialized = false;
  defaultModelId = 'sdxl';

  async initialize() {
    this.isInitialized = true;
  }

  async generateImage(request) {
    return {
      created: Math.floor(Date.now() / 1000),
      modelId: request.modelId,
      providerId: this.providerId,
      images: [{ url: 'https://example.invalid/image.png' }],
      usage: { totalImages: 1 },
    };
  }
}

registerImageProviderFactory('comfyui', () => new ComfyUIProvider());

await generateImage({
  provider: 'comfyui',
  model: 'sdxl',
  prompt: 'A brutalist house in fog',
});
```

## `agent()`

```ts
import { agent } from '@framers/agentos';

const researcher = agent({
  provider: 'openai',
  instructions: 'You are a concise research assistant.',
  maxSteps: 4,
});

const session = researcher.session('demo');

const first = await session.send('What is QUIC?');
console.log(first.text);

const second = await session.send('Compare it to TCP.');
console.log(second.text);

console.log(await session.usage());
```

`agent({ tools })` accepts the same three forms as `generateText({ tools })`
and `streamText({ tools })`: named tool maps, `ExternalToolRegistry`
(`Record`, `Map`, or iterable), and prompt-only `ToolDefinitionForLLM[]`.

Runnable examples in the package source:

- `packages/agentos/examples/high-level-api.mjs`
- `packages/agentos/examples/generate-image.mjs`
- `packages/agentos/examples/agentos-config-tools.mjs`

## Full runtime: `AgentOS`

```ts
import { AgentOS, AgentOSResponseChunkType } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
await agent.initialize(
  await createTestAgentOSConfig({
    tools: {
      open_profile: {
        description: 'Load a saved profile record by ID.',
        inputSchema: {
          type: 'object',
          properties: { profileId: { type: 'string' } },
          required: ['profileId'],
        },
        execute: async ({ profileId }) => ({
          success: true,
          output: { profile: { id: profileId, preferredTheme: 'solarized' } },
        }),
      },
    },
  })
);

for await (const chunk of agent.processRequest({
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'Explain how TCP handshakes work',
})) {
  if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
    process.stdout.write(chunk.textDelta);
  }
}
```

`AgentOSConfig.tools` now accepts the same three forms as the high-level
helpers: named tool maps, `ExternalToolRegistry` (`Record`, `Map`, or
iterable), and prompt-only `ToolDefinitionForLLM[]`. AgentOS normalizes those
inputs during `initialize(...)` and registers them into the shared
`ToolOrchestrator`, so direct `processRequest()` turns can plan against and
execute them without helper wrappers. If a config-registered tool collides with
an extension or pack tool name, the config tool wins at registration time.

If those external tool calls are AgentOS-registered tools, prefer
`processRequestWithRegisteredTools(...)`. It executes the registered tools with
the correct live-turn `ToolExecutionContext` and resumes the stream for you:

```ts
import {
  AgentOS,
  AgentOSResponseChunkType,
  processRequestWithRegisteredTools,
} from '@framers/agentos';

for await (const chunk of processRequestWithRegisteredTools(agent, {
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'Search memory for my preferences',
})) {
  if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
    process.stdout.write(chunk.textDelta);
  }
}
```

If a live turn can mix AgentOS-registered tools with a stable host-managed tool
map, either configure `externalTools` once on `AgentOS.initialize(...)` or pass
`externalTools` to `processRequestWithRegisteredTools(...)`. It can be a
record, `Map`, or iterable of tool-like executors, and only missing tool names
will run through that host registry. Per-call `externalTools` override the
configured registry by tool name. Use `externalTools` for helper-level fallback
execution; use `AgentOSConfig.tools` when the tool should be permanently
registered and prompt-visible on direct runtime turns too.
If an `externalTools` entry also provides `description` and `inputSchema`, the
helper temporarily registers a proxy tool so the model can see and plan against
it during the turn. Execution-only entries without prompt metadata still work
for fallback execution, but they are not visible to the model up front.

If you need fully dynamic routing instead of a fixed tool map, keep using
`fallbackExternalToolHandler`.

For custom host-managed tools, keep using `processRequestWithExternalTools(...)`
and provide your own execution callback.

If you are building a lower-level/custom GMI path and only need prompt-visible
host tool schemas, configure `AgentOSConfig.externalTools` and call
`agent.listExternalToolsForLLM()`. That returns only the prompt-aware host
tools. You can turn those into raw OpenAI-style function schemas with
`formatToolDefinitionsForOpenAI(...)` or directly from the registry with
`formatExternalToolsForOpenAI(...)`.

`processRequestWithExternalTools(...)` is the simplest path while the same
AgentOS runtime stays alive. For restart-safe external tool execution, AgentOS
also persists actionable external pauses into the conversation metadata. A fresh
runtime can recover the pending request with
`getPendingExternalToolRequest(conversationId, userId)` and continue on a new
stream with `resumeExternalToolRequest(...)`:

If the pending tool calls are AgentOS-registered tools, prefer
`resumeExternalToolRequestWithRegisteredTools(...)`. It executes the registered
tools with the correct resume-time `ToolExecutionContext` and then resumes the
stream for you.

```ts
import { resumeExternalToolRequestWithRegisteredTools } from '@framers/agentos';

const pending = await agent.getPendingExternalToolRequest('conv-1', 'user-1');

if (pending) {
  for await (const chunk of resumeExternalToolRequestWithRegisteredTools(agent, pending, {
    organizationId: 'org-123',
  })) {
    if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
      process.stdout.write(chunk.textDelta);
    }
  }
}
```

If a persisted pause can mix AgentOS-registered tools with a stable
host-managed tool map, either configure `externalTools` once on
`AgentOS.initialize(...)` or pass `externalTools` to
`resumeExternalToolRequestWithRegisteredTools(...)`. The helper will execute
the registered tool calls itself and only delegate missing tool names to that
host registry before resuming the stream. Per-call `externalTools` override the
configured registry by tool name.
Prompt-aware entries with `description` and `inputSchema` are also registered
temporarily during the resumed stream so follow-up model calls can plan against
the same host tools.

If you need fully dynamic routing instead of a fixed tool map, keep using
`fallbackExternalToolHandler`.

For custom host-managed tools that are not registered in AgentOS, keep using
`resumeExternalToolRequest(...)` directly and supply your own tool results.

This recovery path assumes the conversation store is still available after the
original process exits.

## Guidance

- Show high-level examples first in README and landing guides.
- Keep low-level `AgentOS` examples in architecture, advanced usage, extensions, workflows, and runtime-control docs.
- Document both layers explicitly. They are complementary, not competing.
- Keep `generateImage()` provider-agnostic at the API boundary, but expose provider-specific knobs through `providerOptions` when needed.
- Do not force libraries like Wunderland to adopt `agent()` unless the helper reaches feature parity with their runtime needs.
