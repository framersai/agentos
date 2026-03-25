# High-Level API

AgentOS now exposes two public layers from the root package:

- High-level helpers: `generateText()`, `streamText()`, `generateImage()`, `agent()`
- Full runtime: `new AgentOS()` with `processRequest()`, personas, workflows, extensions, and chunk-level orchestration

Use the high-level API when you want the fastest path to text generation, streaming, and lightweight stateful sessions. Use `AgentOS` directly when you need the full runtime.

When AgentOS observability is enabled, these helper APIs also emit opt-in OTEL spans and turn metrics. `generateText()` and `streamText()` attach provider/model/token usage and aggregated cost when the provider returns it; `generateImage()` does the same for image-generation usage.

If you also want durable helper-level accounting, set `usageLedger.path`, set `usageLedger.enabled: true`, or export `AGENTOS_USAGE_LEDGER_PATH` / `WUNDERLAND_USAGE_LEDGER_PATH`. With `enabled: true`, helper usage lands in the shared home ledger at `~/.framers/usage-ledger.jsonl` unless you provide an explicit path.

## When to use which

| API | Best for | Tradeoff |
| --- | --- | --- |
| `generateText()` | One-shot text or tool-calling turns | No persistent session state |
| `streamText()` | Stream text or tool-calling results immediately | Stateless per call |
| `generateImage()` | Provider-agnostic image generation from a single prompt | Provider feature support varies |
| `agent()` | Lightweight multi-turn sessions with in-memory history | Does not replace the full AgentOS runtime |
| `AgentOS` | Personas, extensions, workflows, multi-agent orchestration, guardrails, HITL, runtime lifecycle | More setup, more control |

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

| Provider | Type | Text default | Image default | Embedding default | Env var |
|----------|------|-------------|---------------|-------------------|---------|
| `openai` | Cloud | `gpt-4o` | `gpt-image-1` | `text-embedding-3-small` | `OPENAI_API_KEY` |
| `anthropic` | Cloud | `claude-sonnet-4-20250514` | — | — | `ANTHROPIC_API_KEY` |
| `gemini` | Cloud | `gemini-2.5-flash` | — | — | `GEMINI_API_KEY` |
| `openrouter` | Cloud | `openai/gpt-4o` | — | — | `OPENROUTER_API_KEY` |
| `stability` | Cloud | — | `stable-diffusion-xl-1024-v1-0` | — | `STABILITY_API_KEY` |
| `replicate` | Cloud | — | `black-forest-labs/flux-1.1-pro` | — | `REPLICATE_API_TOKEN` |
| `ollama` | Local | `llama3.2` | `stable-diffusion` | `nomic-embed-text` | `OLLAMA_BASE_URL` |
| `stable-diffusion-local` | Local | — | `v1-5-pruned-emaonly` | — | `STABLE_DIFFUSION_LOCAL_BASE_URL` |

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

| Provider | Type | Default model | API key env var |
|---|---|---|---|
| `openai` | Cloud API | `gpt-image-1` | `OPENAI_API_KEY` |
| `stability` | Cloud API | `stable-diffusion-xl-1024-v1-0` | `STABILITY_API_KEY` |
| `replicate` | Cloud API | `black-forest-labs/flux-1.1-pro` | `REPLICATE_API_TOKEN` |
| `openrouter` | Cloud API | — | `OPENROUTER_API_KEY` |
| `ollama` | Local | `stable-diffusion` | None (uses `baseUrl`) |
| `stable-diffusion-local` | Local | `v1-5-pruned-emaonly` | None (uses `baseUrl`) |

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
import {
  generateImage,
  registerImageProviderFactory,
  type IImageProvider,
} from '@framers/agentos';

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

Runnable examples in the package source:

- `packages/agentos/examples/high-level-api.mjs`
- `packages/agentos/examples/generate-image.mjs`

## Full runtime: `AgentOS`

```ts
import { AgentOS, AgentOSResponseChunkType } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
await agent.initialize(await createTestAgentOSConfig());

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

## Guidance

- Show high-level examples first in README and landing guides.
- Keep low-level `AgentOS` examples in architecture, advanced usage, extensions, workflows, and runtime-control docs.
- Document both layers explicitly. They are complementary, not competing.
- Keep `generateImage()` provider-agnostic at the API boundary, but expose provider-specific knobs through `providerOptions` when needed.
- Do not force libraries like Wunderland to adopt `agent()` unless the helper reaches feature parity with their runtime needs.
