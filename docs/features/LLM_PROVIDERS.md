# LLM Providers — Multi-Provider Configuration & Routing

> Configure and switch between 11 LLM providers (including 2 CLI-based) with automatic detection, fallback, and cost-aware routing.

---

## Table of Contents

1. [Overview](#overview)
2. [Provider Matrix](#provider-matrix)
3. [Quick Start](#quick-start)
4. [Auto-Detection Order](#auto-detection-order)
5. [Provider Configuration](#provider-configuration)
6. [Fallback Behavior](#fallback-behavior)
7. [Cost Tiers](#cost-tiers)
8. [Provider Details](#provider-details)
   - [OpenAI](#openai)
   - [Anthropic](#anthropic)
   - [Google Gemini](#google-gemini)
   - [Groq](#groq)
   - [Together AI](#together-ai)
   - [Mistral AI](#mistral-ai)
   - [xAI (Grok)](#xai-grok)
   - [OpenRouter](#openrouter)
   - [Ollama](#ollama)
9. [Programmatic Configuration](#programmatic-configuration)
10. [Adding a Custom Provider](#adding-a-custom-provider)
11. [Provider Capabilities Detail](#provider-capabilities-detail)
12. [Related Documentation](#related-documentation)

---

## Overview

AgentOS abstracts LLM access behind a unified `LLMProviderManager` interface.
You configure providers via environment variables, and AgentOS handles model
selection, streaming, tool calling, retries, and fallback routing.

**Key features:**

- **11 providers** supported out of the box (9 API-key + 2 CLI-based)
- **CLI providers**: Use your Claude Max or Google account subscription via local CLI — no API key needed
- **Auto-detection**: Set an API key or install a CLI and the provider is available
- **Fallback**: Automatic retry with alternate providers on failure
- **Cost-aware routing**: Route requests to cheaper models when quality allows
- **Streaming**: All providers support streaming with a unified async iterator
- **Tool calling**: Unified function/tool calling across providers that support it

---

## Provider Matrix

| Provider | Env Var | Default Model | Streaming | Tool Calling | Vision | Embedding | Cost Tier |
|----------|---------|---------------|-----------|--------------|--------|-----------|-----------|
| **OpenAI** | `OPENAI_API_KEY` | `gpt-4o` | Yes | Yes | Yes | Yes | $$$ |
| **Anthropic** | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | Yes | Yes | Yes | No | $$$ |
| **Gemini** | `GEMINI_API_KEY` | `gemini-2.5-flash` | Yes | Yes | Yes | Yes | $$ |
| **Groq** | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Yes | Yes | No | No | $ |
| **Together** | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Yes | Yes | No | Yes | $ |
| **Mistral** | `MISTRAL_API_KEY` | `mistral-large-latest` | Yes | Yes | No | Yes | $$ |
| **xAI** | `XAI_API_KEY` | `grok-2` | Yes | Yes | Yes | No | $$ |
| **OpenRouter** | `OPENROUTER_API_KEY` | `openai/gpt-4o` | Yes | Yes | Yes* | Yes* | Varies |
| **Ollama** | `OLLAMA_BASE_URL` | `llama3.2` | Yes | Partial | Model-dep. | Yes | Free |
| **Claude Code CLI** | _(PATH detection)_ | `claude-sonnet-4-20250514` | Yes | Yes | Yes | No | Free* |
| **Gemini CLI** | _(PATH detection)_ | `gemini-2.5-flash` | Yes | Partial** | Yes | No | Free* |

*CLI providers use your existing subscription — $0 per token.
**Gemini CLI tool calling uses XML prompt-based parsing (less reliable than native API tool calling).

> **Gemini CLI ToS Warning**: Google's Gemini CLI ToS may prohibit third-party subprocess invocation with OAuth auth. Use `gemini` with API key for production. See [CLI Providers](./CLI_PROVIDERS.md) for details.

*OpenRouter capabilities depend on the underlying model selected.

---

## Quick Start

### Option 1: Environment Variable (Simplest)

Set one API key and start using AgentOS:

```bash
export OPENAI_API_KEY=sk-...
```

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent();  // Auto-detects OpenAI
const response = await agent.chat('Hello, world!');
```

### Option 2: Programmatic

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent({
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-20250514',
});
```

---

## Auto-Detection Order

When no provider is explicitly configured, AgentOS checks for API keys in this
order and uses the first one found:

1. `OPENROUTER_API_KEY` → OpenRouter
2. `OPENAI_API_KEY` → OpenAI
3. `ANTHROPIC_API_KEY` → Anthropic
4. `GEMINI_API_KEY` → Google Gemini
5. `GROQ_API_KEY` → Groq
6. `TOGETHER_API_KEY` → Together AI
7. `MISTRAL_API_KEY` → Mistral
8. `XAI_API_KEY` → xAI
9. `which claude` → Claude Code CLI (PATH detection — no API key, uses Max subscription)
10. `which gemini` → Gemini CLI (PATH detection — no API key, uses Google account)
11. `OLLAMA_BASE_URL` → Ollama

You can override auto-detection by setting `llmProvider` explicitly in your
configuration or passing `--provider <name>` to CLI commands.

---

## Provider Configuration

Each provider is configured via environment variables. You can set them in
your shell or `.env` file:

```bash
# .env

# Primary provider
OPENAI_API_KEY=sk-...

# Fallback provider
OPENROUTER_API_KEY=sk-or-...

# Local provider (no API key needed)
OLLAMA_BASE_URL=http://localhost:11434
```

### Per-Agent Override

Individual agents can use different providers via `agent.config.json`:

```json
{
  "llmProvider": "anthropic",
  "llmModel": "claude-sonnet-4-20250514",
  "llmAuthMethod": "api-key"
}
```

---

## Fallback Behavior

AgentOS supports automatic fallback when a provider request fails:

```
Primary Provider (e.g., Anthropic)
  ↓ fails (rate limit, timeout, error)
OpenRouter Fallback (if OPENROUTER_API_KEY is set)
  ↓ fails
Ollama Local Fallback (if OLLAMA_BASE_URL is set)
  ↓ fails
Error returned to caller
```

### Configuring Fallback

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent({
  llmProvider: 'anthropic',
  llmFallback: ['openrouter', 'ollama'],  // Ordered fallback chain
  llmFallbackModel: {
    openrouter: 'anthropic/claude-sonnet-4-20250514',
    ollama: 'llama3.2',
  },
});
```

### OpenRouter as Universal Fallback

Setting `OPENROUTER_API_KEY` automatically enables it as a fallback for any
primary provider. OpenRouter routes to 200+ models across all major providers.

```bash
# Primary: Anthropic. Fallback: OpenRouter (automatic)
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...
```

---

## Cost Tiers

AgentOS tracks token usage and cost across all providers:

| Tier | Providers | Approximate Cost (1M tokens) |
|------|-----------|------------------------------|
| **$** (Budget) | Groq, Together, Ollama (free) | $0.00–$0.60 |
| **$$** (Standard) | Gemini, Mistral, xAI, OpenRouter (varies) | $0.50–$3.00 |
| **$$$** (Premium) | OpenAI, Anthropic | $3.00–$15.00 |

### Cost-Aware Routing

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent({
  costOptimization: {
    enabled: true,
    maxCostPerTurn: 0.05,          // USD budget per turn
    preferCheaperModels: true,     // Route simple queries to cheaper models
    premiumModelThreshold: 0.7,    // Complexity score threshold for premium models
  },
});
```

See [Cost Optimization](./COST_OPTIMIZATION.md) for the full guide.

---

## Provider Details

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `gpt-4o` | 128K | Yes | Yes | Best all-around |
| `gpt-4o-mini` | 128K | Yes | Yes | Fast, cheap |
| `o1` | 200K | Yes | Yes | Reasoning model |
| `o3-mini` | 200K | No | Yes | Fast reasoning |
| `gpt-image-1` | — | — | — | Image generation only |

**OAuth support:** Use your ChatGPT subscription instead of an API key via the device code flow. See [OAuth Auth](./OAUTH_AUTH.md) for details.

### Anthropic

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `claude-opus-4-20250514` | 200K | Yes | Yes | Most capable |
| `claude-sonnet-4-20250514` | 200K | Yes | Yes | Best value |
| `claude-haiku-3-5-20241022` | 200K | Yes | Yes | Fastest |

### Google Gemini

```bash
export GEMINI_API_KEY=AIza...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `gemini-2.5-pro` | 1M | Yes | Yes | Largest context |
| `gemini-2.5-flash` | 1M | Yes | Yes | Fast, large context |
| `gemini-2.0-flash` | 1M | Yes | Yes | Previous gen |

### Groq

```bash
export GROQ_API_KEY=gsk_...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `llama-3.3-70b-versatile` | 128K | No | Yes | Best Groq model |
| `llama-3.1-8b-instant` | 128K | No | Yes | Ultra-fast |
| `mixtral-8x7b-32768` | 32K | No | Yes | Mixtral on Groq |

Groq provides extremely fast inference (~500 tok/s) via custom LPU hardware.

### Together AI

```bash
export TOGETHER_API_KEY=...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `meta-llama/Llama-3.3-70B-Instruct-Turbo` | 128K | No | Yes | Default |
| `meta-llama/Llama-3.1-405B-Instruct-Turbo` | 128K | No | Yes | Largest open model |
| `mistralai/Mixtral-8x22B-Instruct-v0.1` | 64K | No | Yes | Mixtral |

### Mistral AI

```bash
export MISTRAL_API_KEY=...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `mistral-large-latest` | 128K | No | Yes | Best Mistral model |
| `codestral-latest` | 32K | No | Yes | Code-optimized |
| `mistral-small-latest` | 32K | No | Yes | Fast, cheap |

### xAI (Grok)

```bash
export XAI_API_KEY=xai-...
```

| Model | Context | Vision | Tool Calling | Notes |
|-------|---------|--------|-------------|-------|
| `grok-2` | 128K | Yes | Yes | Default |
| `grok-2-mini` | 128K | No | Yes | Faster |

### OpenRouter

```bash
export OPENROUTER_API_KEY=sk-or-...
```

OpenRouter is a multi-provider proxy that routes to 200+ models. Specify the
model using the `provider/model` format:

```typescript
const agent = await createAgent({
  llmProvider: 'openrouter',
  llmModel: 'anthropic/claude-sonnet-4-20250514',
});
```

Popular OpenRouter models:
- `openai/gpt-4o`
- `anthropic/claude-sonnet-4-20250514`
- `google/gemini-2.5-flash`
- `meta-llama/llama-3.3-70b-instruct`

### Ollama

```bash
export OLLAMA_BASE_URL=http://localhost:11434
```

Run any open model locally. No API key, no cost, full privacy.

```bash
# Pull models manually
ollama pull llama3.2
ollama pull codellama
ollama pull dolphin-mixtral
```

| Model | Parameters | Context | Tool Calling | Notes |
|-------|-----------|---------|-------------|-------|
| `llama3.2` | 3B/8B | 128K | Partial | General-purpose |
| `codellama` | 7B/13B/34B | 16K | No | Code-optimized |
| `dolphin-mixtral` | 8x7B | 32K | No | Uncensored |
| `mistral` | 7B | 32K | Partial | Fast |
| `phi3` | 3.8B | 128K | No | Small, fast |

---

## Programmatic Configuration

### LLMProviderConfig

```typescript
import { createAgent, type LLMProviderConfig } from '@framers/agentos';

const providerConfig: LLMProviderConfig = {
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-20250514',
  baseUrl: undefined,              // Custom base URL (optional)
  extraHeaders: {                  // Additional headers (optional)
    'X-Custom-Header': 'value',
  },
};

const agent = await createAgent({
  llmProvider: 'anthropic',
  llmProviderConfig: providerConfig,
});
```

### Switching Providers at Runtime

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent({
  llmProvider: 'openai',
});

// Switch to Anthropic for a specific request
const response = await agent.chat('Complex analysis task', {
  provider: 'anthropic',
  model: 'claude-opus-4-20250514',
});
```

---

## Adding a Custom Provider

Implement the `ILLMProvider` interface to add a custom LLM provider:

```typescript
import { registerLLMProvider, type ILLMProvider } from '@framers/agentos';

const myProvider: ILLMProvider = {
  id: 'my-provider',
  name: 'My Custom LLM',

  models: [
    { id: 'my-model-v1', contextWindow: 32768, supportsTool: true, supportsVision: false },
  ],

  async chat(messages, options) {
    const response = await fetch('https://my-llm.com/v1/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MY_LLM_KEY}` },
      body: JSON.stringify({ messages, model: options.model }),
    });
    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens },
    };
  },

  async *stream(messages, options) {
    // Implement SSE streaming
    // yield { type: 'text_delta', content: '...' }
  },
};

registerLLMProvider(myProvider);
```

---

## Provider Capabilities Detail

### Tool Calling Support

| Provider | Parallel Tools | Structured Output | Tool Choice | Notes |
|----------|---------------|-------------------|-------------|-------|
| OpenAI | Yes | Yes (strict mode) | `auto/none/required/specific` | Gold standard |
| Anthropic | Yes | Yes | `auto/any/specific` | Strong tool use |
| Gemini | Yes | Yes | `auto/none/any` | Good support |
| Groq | Yes | Partial | `auto/none` | Fast but basic |
| Together | Yes | No | `auto/none` | Model-dependent |
| Mistral | Yes | No | `auto/none/any` | Good support |
| xAI | Yes | No | `auto/none` | Basic tool use |
| OpenRouter | Model-dependent | Model-dependent | Model-dependent | Pass-through |
| Ollama | Partial | No | `auto/none` | Model-dependent |

### Embedding Support

| Provider | Models | Dimensions | Batch Size |
|----------|--------|-----------|------------|
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` | 256–3072 | 2048 |
| Gemini | `text-embedding-004` | 768 | 2048 |
| Together | `togethercomputer/m2-bert-80M-*` | 768 | 512 |
| Mistral | `mistral-embed` | 1024 | 512 |
| Ollama | `nomic-embed-text`, `mxbai-embed-large` | 768–1024 | 512 |

---

## Related Documentation

- [Getting Started](./GETTING_STARTED.md) — Initial setup and configuration
- [Cost Optimization](./COST_OPTIMIZATION.md) — Budget management and routing
- [Architecture](./ARCHITECTURE.md) — System architecture overview
- [Structured Output](./STRUCTURED_OUTPUT.md) — JSON schema enforcement per provider
