<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-no-tagline-transparent-2x.png" alt="AgentOS — TypeScript AI Agent Framework with Cognitive Memory" height="100" />
</a>

<br />

# **AgentOS** — Open-Source TypeScript AI Agent Runtime with Cognitive Memory, HEXACO Personality, and Runtime Tool Forging

**85.6% on LongMemEval-S** at $0.0090/correct · **70.2% on LongMemEval-M** (first open-source library above 65% on the 1.5M-token variant) · 16 LLM providers · 8 neuroscience-backed memory mechanisms · MIT-friendly Apache 2.0

[![npm](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/ci.yml?branch=master&style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-3%2C866%2B_passed-2ea043?style=flat-square&logo=vitest&logoColor=white)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/framersai/agentos/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](https://opensource.org/licenses/Apache-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=flat-square&logo=discord)](https://wilds.ai/discord)

[**Benchmarks**](https://docs.agentos.sh/benchmarks) · [Website](https://agentos.sh) · [Docs](https://docs.agentos.sh) · [npm](https://www.npmjs.com/package/@framers/agentos) · [Discord](https://wilds.ai/discord) · [Blog](https://docs.agentos.sh/blog)

</div>

---

## Install

```bash
npm install @framers/agentos
```

```typescript
import { agent } from '@framers/agentos';

const tutor = agent({
  provider: 'anthropic',
  instructions: 'You are a patient CS tutor.',
  personality: { openness: 0.9, conscientiousness: 0.95 },
  memory: { types: ['episodic', 'semantic'], working: { enabled: true } },
});

const session = tutor.session('student-1');
await session.send('Explain recursion with an analogy.');
await session.send('Can you expand on that?'); // remembers context
```

[Full quickstart](https://docs.agentos.sh/getting-started) · [Examples cookbook](https://docs.agentos.sh/getting-started/examples) · [API reference](https://docs.agentos.sh/api)

---

## Memory Benchmarks at Matched Reader

Same `gpt-4o` reader, same dataset, same `gpt-4o-2024-08-06` judge across every row. Cross-provider configurations are excluded because they cannot be reproduced from public methodology disclosures.

### LongMemEval-S (115K tokens, 50 sessions)

| System (gpt-4o reader) | Accuracy | $/correct | p50 latency | Source |
|---|---:|---:|---:|---|
| EmergenceMem Internal | 86.0% | not published | 5,650 ms | [emergence.ai](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag) |
| **🚀 AgentOS canonical-hybrid + reader-router** | **85.6%** | **$0.0090** | **3,558 ms** | [post](https://docs.agentos.sh/blog/2026/04/28/reader-router-pareto-win) |
| Mastra OM gpt-4o (gemini-flash observer) | 84.23% | not published | not published | [mastra.ai](https://mastra.ai/research/observational-memory) |
| Supermemory gpt-4o | 81.6% | not published | not published | [supermemory.ai](https://supermemory.ai/research/) |
| EmergenceMem Simple Fast (rerun in agentos-bench) | 80.6% | $0.0586 | 3,703 ms | [adapter](https://github.com/framersai/agentos-bench/blob/master/vendors/emergence-simple-fast/) |
| Zep self / independent reproduction | 71.2% / 63.8% | not published | not published | [self](https://blog.getzep.com/state-of-the-art-agent-memory/) / [arXiv](https://arxiv.org/abs/2512.13564) |

**+1.4 points above Mastra OM gpt-4o (84.23%) at the matched reader.** AgentOS at 85.6% is the highest published number from an open-source library that ships an end-to-end agent runtime around its memory system. EmergenceMem Internal posts 86.0% (0.4 above us). AgentOS p50 latency 3,558 ms vs EmergenceMem's published median 5,650 ms.

**Cost at scale**: $0.0090 per memory-grounded answer = $9 per 1,000 RAG calls. A chatbot averaging 5 RAG calls per conversation across 1,000 conversations costs ~$45.

### LongMemEval-M (1.5M tokens, 500 sessions)

The harder variant. M's haystacks exceed every production context window. Most vendors stop at S because raw long-context fits there.

| System | Accuracy | License | Source |
|---|---:|---|---|
| AgentBrain | 71.7% | closed-source SaaS | [github.com/AgentBrainHQ](https://github.com/AgentBrainHQ) |
| **🚀 AgentOS** (sem-embed + reader-router + top-K=5) | **70.2%** | **Apache-2.0** | [post](https://docs.agentos.sh/blog/2026/04/29/longmemeval-m-70-with-topk5) |
| LongMemEval paper academic baseline | 65.7% | open repo | [Wu et al., ICLR 2025](https://arxiv.org/abs/2410.10813) |
| Mem0 v3, Mastra, Hindsight, Zep, EmergenceMem, Supermemory, Letta, others | not published | various | reports S only |

**+4.5 points above the LongMemEval paper's strongest published M result (65.7%).** AgentOS is the first open-source library on the public record above 65% on the M variant. The closest published number is AgentBrain's 71.7% from their closed-source SaaS.

> **[Full benchmarks page →](https://docs.agentos.sh/benchmarks)** · **[Reproducible run JSONs →](https://github.com/framersai/agentos-bench/tree/master/results/runs)** · **[Methodology audit →](https://docs.agentos.sh/blog/2026/04/24/memory-benchmark-transparency-audit)**

---

## 📄 Technical Whitepaper · Coming Soon

The full architecture and benchmark methodology, written for engineers and researchers who want a citable PDF instead of scrolling docs. Cognitive memory pipeline, classifier-driven dispatch, HEXACO personality modulation, runtime tool forging, full LongMemEval-S/M and LOCOMO benchmark methodology with confidence interval math, judge-FPR probes, per-stage retention metrics, and reproducibility recipes.

| Covers | What's inside |
|---|---|
| **Architecture** | Generalized Mind Instances, IngestRouter / MemoryRouter / ReadRouter, 8 cognitive mechanisms with primary-source citations |
| **Benchmarks** | LongMemEval-S 85.6%, LongMemEval-M 70.2%, vendor landscape, confidence interval methodology, judge FPR probes, full transparency stack |
| **Reproducibility** | Per-case run JSONs at `--seed 42`, single-CLI reproduction, Apache-2.0 bench at [github.com/framersai/agentos-bench](https://github.com/framersai/agentos-bench) |

**[Notify me when it drops →](mailto:team@frame.dev?subject=AgentOS%20Whitepaper%20Notify)** · **[Read the benchmarks now →](https://docs.agentos.sh/benchmarks)** · **[Discord](https://wilds.ai/discord)**

---

## Classifier-Driven Memory Pipeline

Most memory libraries retrieve on every query. AgentOS gates memory through three LLM-as-judge classifiers in a single shared pass, so trivial queries skip retrieval entirely and the rest get the right architecture and reader per category.

```
User query
    │
    ▼ Stage 1: QueryClassifier (gpt-5-mini, ~$0.0001/query)
    │    T0=none ─────► answer from context, skip retrieval
    │    T1+=needs memory
    ▼ Stage 2: MemoryRouter      → canonical-hybrid · OM-v10 · OM-v11
    ▼ Stage 3: ReaderRouter      → gpt-4o (TR/SSU) · gpt-5-mini (SSA/SSP/KU/MS)
    ▼
Grounded answer
```

Stages 2 and 3 reuse the Stage 1 classification, so the full pipeline costs **one classifier call per query**, not three. **The T0 / no-memory gate is the novel piece**: removing retrieval entirely for greetings and small talk saves the embedding + rerank + reader cost on a substantial fraction of typical agent traffic.

| Primitive | Source | Decision |
|---|---|---|
| `QueryClassifier` | [`@framers/agentos/query-router`](https://docs.agentos.sh/features/query-routing) | T0/none vs T1/simple vs T2/moderate vs T3/complex |
| `MemoryRouter` | [`@framers/agentos/memory-router`](https://docs.agentos.sh/features/memory-router) | canonical-hybrid vs observational-memory-v10 vs v11 |
| `ReaderRouter` | [`@framers/agentos/memory-router`](https://docs.agentos.sh/features/memory-router) | gpt-4o vs gpt-5-mini per category |

[Cognitive Pipeline docs →](https://docs.agentos.sh/features/cognitive-pipeline) · [Architecture deep dive →](https://docs.agentos.sh/blog/2026/04/10/cognitive-memory-architecture-deep-dive) · [Beyond RAG →](https://docs.agentos.sh/blog/2026/03/31/cognitive-memory-beyond-rag)

---

## Why AgentOS

| vs. | AgentOS differentiator |
|---|---|
| **LangChain / LangGraph** | Cognitive memory ([8 neuroscience-backed mechanisms](https://docs.agentos.sh/features/cognitive-memory)), HEXACO personality, runtime tool forging |
| **Vercel AI SDK** | Multi-agent teams (6 strategies), 7 vector backends, [guardrails](https://docs.agentos.sh/features/guardrails-architecture), voice/telephony |
| **CrewAI / Mastra** | Unified orchestration (DAGs + graphs + missions), personality-driven routing, **published reproducible numbers on LongMemEval-S (85.6%) and LongMemEval-M (70.2%) with full methodology disclosure** |

[Full framework comparison →](https://docs.agentos.sh/blog/2026/02/20/agentos-vs-langgraph-vs-crewai)

---

## Key Features

| Category | Highlights |
|---|---|
| **LLM Providers** | 16: OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Together, Mistral, xAI, Claude/Gemini CLI, + 5 image/video |
| **Cognitive Memory** | 8 mechanisms: reconsolidation, retrieval-induced forgetting, involuntary recall, FOK, gist extraction, schema encoding, source decay, emotion regulation |
| **HEXACO Personality** | 6 traits modulate memory, retrieval bias, response style |
| **RAG Pipeline** | 7 vector backends · 4 retrieval strategies · GraphRAG · HyDE · Cohere rerank-v3.5 |
| **Multi-Agent Teams** | 6 coordination strategies · shared memory · inter-agent messaging · HITL gates |
| **Orchestration** | `workflow()` DAGs · `AgentGraph` cycles · `mission()` goal-driven planning · checkpointing |
| **Guardrails** | 5 security tiers · 6 packs (PII, ML classifiers, topicality, code safety, grounding, content policy) |
| **Emergent Capabilities** | Runtime tool forging · 4 self-improvement tools · tiered promotion · skill export |
| **Voice & Telephony** | ElevenLabs, Deepgram, Whisper · Twilio, Telnyx, Plivo |
| **Channels** | 37 platform adapters (Telegram, Discord, Slack, WhatsApp, webchat, ...) |
| **Observability** | OpenTelemetry · usage ledger · cost guard · circuit breaker |

---

## Multi-Agent in 6 Lines

```typescript
import { agency } from '@framers/agentos';

const team = agency({
  strategy: 'graph',
  agents: {
    researcher: { provider: 'anthropic', instructions: 'Find relevant facts.' },
    writer:     { provider: 'openai',    instructions: 'Summarize clearly.',  dependsOn: ['researcher'] },
    reviewer:   { provider: 'gemini',    instructions: 'Check accuracy.',     dependsOn: ['writer'] },
  },
});

const result = await team.generate('Compare TCP vs UDP for game networking.');
```

Strategies: `sequential` · `parallel` · `debate` · `review-loop` · `hierarchical` · `graph`. [Multi-agent docs →](https://docs.agentos.sh/features/multi-agent)

---

## See It In Action

### 🌀 Paracosm — AI Agent Swarm Simulation

Define any scenario as JSON. Run it with AI commanders that have different HEXACO personalities. Same starting conditions, different decisions, divergent civilizations. Built on AgentOS.

```bash
npm install paracosm
```

[Live Demo](https://paracosm.agentos.sh/sim) · [GitHub](https://github.com/framersai/paracosm) · [npm](https://www.npmjs.com/package/paracosm)

---

## Configure API Keys

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...

# Comma-separated keys auto-rotate with quota detection
export OPENAI_API_KEY=sk-key1,sk-key2,sk-key3
```

Or pass `apiKey` inline on any call. Auto-detection order: OpenAI → Anthropic → OpenRouter → Gemini → Groq → Together → Mistral → xAI → CLI → Ollama. [Default models per provider →](https://docs.agentos.sh/architecture/llm-providers)

---

## API Surfaces

- **`agent()`**: lightweight stateful agent. Prompts, sessions, personality, hooks, tools, memory.
- **`agency()`**: multi-agent teams + full runtime. Emergent tooling, guardrails, RAG, voice, channels, HITL.
- **`generateText()` / `streamText()` / `generateObject()` / `generateImage()` / `generateVideo()` / `generateMusic()` / `performOCR()` / `embedText()`**: low-level multi-modal helpers with native tool calling.
- **`workflow()` / `AgentGraph` / `mission()`**: three orchestration authoring APIs over one graph runtime.

[Full API reference →](https://docs.agentos.sh/api) · [High-Level API guide →](https://docs.agentos.sh/getting-started/high-level-api)

---

## Ecosystem

| Package | Description |
|---|---|
| [`@framers/agentos`](https://www.npmjs.com/package/@framers/agentos) | Core runtime |
| [`@framers/agentos-extensions`](https://www.npmjs.com/package/@framers/agentos-extensions) | 100+ extensions and templates |
| [`@framers/agentos-skills`](https://www.npmjs.com/package/@framers/agentos-skills) | 88 curated SKILL.md definitions |
| [`@framers/agentos-bench`](https://github.com/framersai/agentos-bench) | Open benchmark harness with 95% confidence intervals, judge-FPR probes, per-case run JSONs |
| [`@framers/sql-storage-adapter`](https://www.npmjs.com/package/@framers/sql-storage-adapter) | SQL persistence (SQLite, Postgres, IndexedDB) |
| [paracosm](https://www.npmjs.com/package/paracosm) | AI agent swarm simulation engine |

---

## Documentation & Community

- **[Benchmarks](https://docs.agentos.sh/benchmarks)**: matched-reader SOTA tables, 95% confidence intervals, methodology audit
- **[Architecture](https://docs.agentos.sh/architecture/system-architecture)**: system design, layer breakdown
- **[Cognitive Memory](https://docs.agentos.sh/features/cognitive-memory)**: 8 mechanisms with 30+ APA citations
- **[RAG Configuration](https://docs.agentos.sh/features/rag-memory-configuration)**: vector stores, embeddings, sources
- **[Guardrails](https://docs.agentos.sh/features/guardrails-architecture)**: 5 tiers, 6 packs
- **[Voice Pipeline](https://docs.agentos.sh/features/voice-pipeline)**: TTS, STT, telephony
- **[Blog](https://docs.agentos.sh/blog)**: engineering posts, benchmark publications, transparency audits
- **[Discord](https://wilds.ai/discord)** · **[GitHub Issues](https://github.com/framersai/agentos/issues)** · **[Wilds.ai](https://wilds.ai)** (AI game worlds powered by AgentOS)

---

## Contributing

```bash
git clone https://github.com/framersai/agentos.git && cd agentos
pnpm install && pnpm build && pnpm test
```

[Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md) · We use [Conventional Commits](https://www.conventionalcommits.org/).

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
