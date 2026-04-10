<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-no-tagline-transparent-2x.png" alt="AgentOS — TypeScript AI Agent Framework" height="100" />
</a>

<br />

**Open-source TypeScript runtime for autonomous AI agents with cognitive memory, HEXACO personality, and emergent tool forging.**

[![npm](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/ci.yml?branch=master&style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-3%2C866%2B_passed-2ea043?style=flat-square&logo=vitest&logoColor=white)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/framersai/agentos/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](https://opensource.org/licenses/Apache-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=flat-square&logo=discord)](https://discord.gg/VXXC4SJMKh)

[Website](https://agentos.sh) · [Docs](https://docs.agentos.sh) · [npm](https://www.npmjs.com/package/@framers/agentos) · [GitHub](https://github.com/framersai/agentos) · [Discord](https://discord.gg/VXXC4SJMKh) · [Blog](https://docs.agentos.sh/blog)

</div>

---

## What is AgentOS?

AgentOS is a TypeScript runtime for building AI agents that remember, adapt, and create new tools at runtime. Each agent is a **Generalized Mind Instance** (GMI) with its own personality, memory lifecycle, and behavioral adaptation loop.

### Why AgentOS over alternatives?

| vs. | AgentOS differentiator |
|-----|------------------------|
| **LangChain / LangGraph** | Cognitive memory (8 neuroscience-backed mechanisms), HEXACO personality, runtime tool forging |
| **Vercel AI SDK** | Multi-agent teams (6 strategies), full RAG pipeline (7 vector backends), guardrails, voice/telephony |
| **CrewAI / Mastra** | Unified orchestration (workflow DAGs + agent graphs + goal-driven missions), personality-driven routing |

> **Full comparison:** [AgentOS vs LangGraph vs CrewAI vs Mastra](https://docs.agentos.sh/blog/agentos-vs-langgraph-vs-crewai)

---

## Install

```bash
npm install @framers/agentos
```

### Configure API Keys

```bash
# Environment variables (recommended for production)
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...

# Key rotation — comma-separated keys auto-rotate with quota detection
export OPENAI_API_KEY=sk-key1,sk-key2,sk-key3
```

```typescript
// Or pass apiKey inline (multi-tenant apps, tests, dynamic config)
await generateText({ provider: 'openai', apiKey: 'sk-...', prompt: '...' });
```

All high-level functions accept `apiKey` and `baseUrl` parameters.

---

## Quick Start

### Generate Text

```typescript
import { generateText } from '@framers/agentos';

// Auto-detect provider from env vars
const { text } = await generateText({
  prompt: 'Explain TCP handshakes in 3 bullets.',
});

// Pin a provider
const { text: claude } = await generateText({
  provider: 'anthropic',
  prompt: 'Compare TCP and UDP.',
});
```

16 providers. Auto-fallback on 402/429/5xx.

### Streaming

```typescript
import { streamText } from '@framers/agentos';

const stream = streamText({ provider: 'openai', prompt: 'Write a haiku.' });
for await (const chunk of stream.textStream) process.stdout.write(chunk);
```

### Structured Output

```typescript
import { generateObject } from '@framers/agentos';
import { z } from 'zod';

const { object } = await generateObject({
  provider: 'gemini',
  schema: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    topics: z.array(z.string()),
  }),
  prompt: 'Analyze: "Great camera but disappointing battery."',
});
```

### Create an Agent

```typescript
import { agent } from '@framers/agentos';

const bot = agent({ provider: 'anthropic', instructions: 'You are a helpful assistant.' });
const reply = await bot.session('demo').send('What is 2+2?');
console.log(reply.text);
```

### Agent with Personality & Memory

```typescript
const tutor = agent({
  provider: 'anthropic',
  instructions: 'You are a patient CS tutor.',
  personality: {
    openness: 0.9,
    conscientiousness: 0.95,
    agreeableness: 0.85,
  },
  memory: { enabled: true, cognitive: true },
});

const session = tutor.session('student-1');
await session.send('Explain recursion with an analogy.');
await session.send('Can you expand on that?'); // remembers context
```

### Multi-Agent Teams

```typescript
import { agency } from '@framers/agentos';

const team = agency({
  strategy: 'graph',
  agents: {
    researcher: { provider: 'anthropic', instructions: 'Find relevant facts.' },
    writer:     { provider: 'openai', instructions: 'Write a clear summary.', dependsOn: ['researcher'] },
    reviewer:   { provider: 'gemini', instructions: 'Check accuracy.', dependsOn: ['writer'] },
  },
});

const result = await team.generate('Compare TCP vs UDP for game networking.');
```

6 strategies: `sequential` · `parallel` · `debate` · `review-loop` · `hierarchical` · `graph`

### Multimodal

```typescript
import { generateImage, generateVideo, generateMusic, performOCR, embedText } from '@framers/agentos';

const image = await generateImage({ provider: 'openai', prompt: 'Neon cityscape at sunset' });
const video = await generateVideo({ prompt: 'Drone over misty forest' });
const music = await generateMusic({ prompt: 'Lo-fi hip hop beat' });
const ocr   = await performOCR({ image: './receipt.png', strategy: 'progressive' });
const embed = await embedText({ provider: 'openai', input: ['hello', 'world'] });
```

### Orchestration

Three authoring APIs, one graph runtime:

```typescript
import { workflow, AgentGraph, mission } from '@framers/agentos/orchestration';

// 1. workflow() — deterministic DAG
const pipe = workflow('content').step('research', { tool: 'web_search' }).then('draft', { gmi: { instructions: '...' } }).compile();

// 2. AgentGraph — cycles, subgraphs
const graph = new AgentGraph('review').addNode('draft', gmiNode({...})).addNode('review', judgeNode({...})).addEdge('draft','review').compile();

// 3. mission() — goal-driven, planner decides steps
const m = mission('research').goal('Research {topic}').planner({ strategy: 'adaptive' }).compile();
```

---

## Key Features

| Category | Highlights |
|----------|-----------|
| **LLM Providers** | 16 providers: OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Together, Mistral, xAI, Claude CLI, Gemini CLI, + 5 image/video |
| **Cognitive Memory** | 8 neuroscience-backed mechanisms (reconsolidation, RIF, involuntary recall, FOK, gist extraction, schema encoding, source decay, emotion regulation) |
| **HEXACO Personality** | 6 traits modulate memory, retrieval bias, response style — agents have consistent identity |
| **RAG Pipeline** | 7 vector backends (InMemory, SQL, HNSW, Qdrant, Neo4j, pgvector, Pinecone) · 4 retrieval strategies · GraphRAG |
| **Multi-Agent Teams** | 6 coordination strategies · shared memory · inter-agent messaging · HITL approval gates |
| **Orchestration** | `workflow()` DAGs · `AgentGraph` cycles/subgraphs · `mission()` goal-driven planning · persistent checkpointing |
| **Guardrails** | 5 security tiers · 6 packs (PII redaction, ML classifiers, topicality, code safety, grounding, content policy) |
| **Emergent Capabilities** | Runtime tool forging · dynamic skill management · tiered promotion (session → agent → shared) |
| **Voice & Telephony** | ElevenLabs, Deepgram, OpenAI Whisper · Twilio, Telnyx, Plivo |
| **Channels** | 37 platform adapters (Telegram, Discord, Slack, WhatsApp, webchat, and more) |
| **Structured Output** | Zod-validated JSON extraction with retry · provider-native structured output |
| **Observability** | OpenTelemetry traces/metrics · usage ledger · cost guard · circuit breaker |

---

## Default Models Per Provider

| Provider | Text Model | Image Model | Env Var |
|---|---|---|---|
| `openai` | gpt-4o | gpt-image-1 | `OPENAI_API_KEY` |
| `anthropic` | claude-sonnet-4 | — | `ANTHROPIC_API_KEY` |
| `gemini` | gemini-2.5-flash | — | `GEMINI_API_KEY` |
| `groq` | llama-3.3-70b | — | `GROQ_API_KEY` |
| `ollama` | llama3.2 | stable-diffusion | `OLLAMA_BASE_URL` |
| `openrouter` | openai/gpt-4o | — | `OPENROUTER_API_KEY` |
| `together` | Llama-3.1-70B | — | `TOGETHER_API_KEY` |
| `mistral` | mistral-large | — | `MISTRAL_API_KEY` |
| `xai` | grok-2 | — | `XAI_API_KEY` |
| `stability` | — | stable-diffusion-xl | `STABILITY_API_KEY` |
| `replicate` | — | flux-1.1-pro | `REPLICATE_API_TOKEN` |
| `bfl` | — | flux-pro-1.1 | `BFL_API_KEY` |
| `fal` | — | fal-ai/flux/dev | `FAL_API_KEY` |
| `claude-code-cli` | claude-sonnet-4 | — | `claude` on PATH |
| `gemini-cli` | gemini-2.5-flash | — | `gemini` on PATH |

Auto-detection: OpenAI → Anthropic → OpenRouter → Gemini → Groq → Together → Mistral → xAI → CLI → Ollama

---

## API Reference

### High-Level Functions

| Function | Description |
|----------|-------------|
| `generateText()` | Text generation with multi-step tool calling |
| `streamText()` | Streaming text with async iterables |
| `generateObject()` | Zod-validated structured output |
| `streamObject()` | Streaming structured output |
| `generateImage()` | Image generation (7 providers, character consistency) |
| `generateVideo()` | Video generation |
| `generateMusic()` / `generateSFX()` | Audio generation |
| `performOCR()` | Text extraction from images |
| `embedText()` | Embedding generation |
| `agent()` | Stateful agent with personality, memory, sessions |
| `agency()` | Multi-agent teams with strategy coordination |

### Orchestration

| Builder | Description |
|---------|-------------|
| `workflow(name)` | Deterministic DAG with typed steps |
| `AgentGraph` | Explicit graph with cycles, subgraphs |
| `mission(name)` | Goal-driven, planner decides steps |

Full API reference: [docs.agentos.sh/api](https://docs.agentos.sh/api)

---

## Ecosystem

| Package | Description |
|---------|-------------|
| [`@framers/agentos`](https://www.npmjs.com/package/@framers/agentos) | Core runtime — agents, providers, memory, RAG, orchestration, guardrails |
| [`@framers/agentos-extensions`](https://www.npmjs.com/package/@framers/agentos-extensions) | 100+ extensions and templates |
| [`@framers/agentos-extensions-registry`](https://www.npmjs.com/package/@framers/agentos-extensions-registry) | Curated manifest builder |
| [`@framers/agentos-skills`](https://www.npmjs.com/package/@framers/agentos-skills) | 88 curated SKILL.md definitions |
| [`@framers/agentos-skills-registry`](https://www.npmjs.com/package/@framers/agentos-skills-registry) | Skills catalog SDK |
| [`@framers/sql-storage-adapter`](https://www.npmjs.com/package/@framers/sql-storage-adapter) | SQL persistence (SQLite, Postgres, IndexedDB) |

---

## Documentation

| Guide | Topic |
|-------|-------|
| [Architecture](./docs/architecture/ARCHITECTURE.md) | System design, data flow, layer breakdown |
| [High-Level API](./docs/getting-started/HIGH_LEVEL_API.md) | `generateText`, `agent`, `agency` reference |
| [Orchestration](./docs/orchestration/UNIFIED_ORCHESTRATION.md) | Workflows, graphs, missions |
| [Cognitive Memory](./docs/memory/COGNITIVE_MECHANISMS.md) | 8 mechanisms, 30+ APA citations |
| [RAG Configuration](./docs/memory/RAG_MEMORY_CONFIGURATION.md) | Vector stores, embeddings, data sources |
| [Guardrails](./docs/safety/GUARDRAILS_USAGE.md) | 5 tiers, 6 packs |
| [Human-in-the-Loop](./docs/safety/HUMAN_IN_THE_LOOP.md) | Approval workflows, escalation |
| [Emergent Capabilities](./docs/architecture/EMERGENT_CAPABILITIES.md) | Runtime tool forging |
| [Channels & Platforms](./docs/architecture/PLATFORM_SUPPORT.md) | 37 platform adapters |
| [Voice Pipeline](./docs/features/VOICE_PIPELINE.md) | TTS, STT, telephony |

Full documentation: [docs.agentos.sh](https://docs.agentos.sh)

---

## Contributing

```bash
git clone https://github.com/framersai/agentos.git && cd agentos
pnpm install && pnpm build && pnpm test
```

We use [Conventional Commits](https://www.conventionalcommits.org/). See the [Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md).

---

## Community

- **Discord:** [discord.gg/VXXC4SJMKh](https://discord.gg/VXXC4SJMKh)
- **GitHub Issues:** [github.com/framersai/agentos/issues](https://github.com/framersai/agentos/issues)
- **Blog:** [docs.agentos.sh/blog](https://docs.agentos.sh/blog)
- **Wilds.ai:** [wilds.ai](https://wilds.ai) — AI game worlds powered by AgentOS

---

## License

[Apache 2.0](./LICENSE)

<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="40" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://frame.dev">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/frame-logo-green-no-tagline.svg" alt="Frame.dev" height="40" />
</a>

**Built by [Manic Agency LLC](https://manic.agency) · [Frame.dev](https://frame.dev) · [Wilds.ai](https://wilds.ai)**

</div>
