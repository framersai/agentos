<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-no-tagline-transparent-2x.png" alt="AgentOS — TypeScript AI Agent Framework with Cognitive Memory" height="100" />
</a>

<br />

# **AgentOS** — Open-Source TypeScript AI Agent Runtime with Cognitive Memory, HEXACO Personality, and Runtime Tool Forging

**85.6% on LongMemEval-S** at $0.0090/correct, +1.4 above Mastra OM gpt-4o (84.23%) · **70.2% on LongMemEval-M** (1.5M-token variant), the only open-source library on the public record above 65% on M with publicly reproducible methodology · 16 LLM providers · 8 neuroscience-backed memory mechanisms · Apache-2.0

[![npm](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/ci.yml?branch=master&style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-3%2C866%2B_passed-2ea043?style=flat-square&logo=vitest&logoColor=white)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/framersai/agentos/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](https://opensource.org/licenses/Apache-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=flat-square&logo=discord)](https://wilds.ai/discord)

[**Benchmarks**](https://github.com/framersai/agentos-bench/blob/master/results/LEADERBOARD.md) · [Website](https://agentos.sh) · [Docs](https://docs.agentos.sh) · [npm](https://www.npmjs.com/package/@framers/agentos) · [Discord](https://wilds.ai/discord) · [Blog](https://docs.agentos.sh/blog)

</div>

---

AgentOS is an open-source TypeScript runtime for AI agents that adapt, remember, and collaborate. The runtime carries the parts of an agent that should outlive a single chat completion: persistent [cognitive memory](https://docs.agentos.sh/features/cognitive-memory) grounded in published cognitive-science literature, optional [HEXACO personality](https://docs.agentos.sh/features/cognitive-memory-guide) modeling, runtime tool forging in a hardened sandbox, [six multi-agent orchestration strategies](https://docs.agentos.sh/features/multi-agent-collaboration), [streaming guardrails](https://docs.agentos.sh/features/guardrails-architecture), a [voice pipeline](https://docs.agentos.sh/features/voice-pipeline), and one dispatch interface across 21 LLM providers. Apache-2.0.

On benchmarks: **85.6% on LongMemEval-S** at $0.0090 per correct answer (gpt-4o reader, +1.4 points above Mastra's published 84.23%); **70.2% on LongMemEval-M** (1.5M-token haystacks, 500 sessions per question), the only open-source library on the public record above 65% on M with publicly reproducible methodology. Per-case run JSONs and single-CLI reproduction ship in [agentos-bench](https://github.com/framersai/agentos-bench).

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

## Emergent Design

> "So we and our elaborately evolving computers may meet each other halfway."
>
> — Philip K. Dick, *The Android and the Human*, 1972

Three things accumulate inside an AgentOS session:

1. **Memory.** What was said, what was decided, what was retrieved.
2. **Tool surface.** Starts at whatever was registered. Can grow mid-decision when an agent forges a new function and the judge approves it.
3. **Personality** (optional). A HEXACO trait vector that biases retrieval, specialist routing, and decision-making.

Behavior in turn six is a function of all three carried forward from turns one through five: which memories got reinforced, which forged tools entered the catalog, which trait values weighted which evidence. Each of those is configurable and observable. None of the three crosses into "emergent agent" on its own; the composition is the interesting part.

### Runtime Tool Forging

When an agent encounters a sub-task that no available tool covers, it generates a TypeScript function with a Zod-described input and output schema. A separate LLM call evaluates the forged function against the agent's stated intent and either approves or rejects it. Approved functions execute in a hardened `node:vm` sandbox (default 5-second wall clock, 128 MB nominal memory budget reported as a heap-delta heuristic, not preemptively enforced — preemptive memory limits via [`isolated-vm`](https://github.com/laverdet/isolated-vm) are queued for the hosted multi-tenant tier). The sandbox always bans `eval`, `Function`, `require`, dynamic `import`, `process`, `child_process`, and destructive `fs.*`. `fetch`, `fs.readFile`, and `crypto` are allowlist-only opt-ins; the default allowlist is empty, so the default execution environment has no network, no filesystem, and no crypto unless the host explicitly grants them per-tool. Approved tools are added to a discoverable index keyed by name and signature, and subsequent turns invoke them via `call_forged_tool(name, args)`. A first-time forge costs full LLM tokens; reuse costs tens of tokens. Total cost per turn flattens once a session has accumulated a handful of approved tools.

The path the runtime supports: an agent forges a tool mid-decision, the judge approves it, that turn invokes it, and a few turns later a different specialist agent in the same session invokes the same tool because the index made it findable. Neither side is scripted; the runtime makes the tool discoverable and the agents find it on their own.

### HEXACO Personality (optional)

Personality is opt-in. The runtime behaves identically with or without a trait vector, and most production deployments do not pass one.

```ts
// Personality-neutral (most production agents)
const support = agent({
  provider: 'openai',
  instructions: 'Resolve customer tickets.',
  memory: { types: ['episodic', 'semantic'] },
});

// Opt-in HEXACO (when persona consistency across sessions matters)
const coach = agent({
  provider: 'openai',
  instructions: "Long-running career coach. Hold the user accountable to their stated goals across weekly check-ins; flag drift, push back on excuses, escalate when goals shift.",
  personality: {
    conscientiousness: 0.9,    // won't let goals drift between sessions
    honestyHumility: 0.85,     // won't tell the user what they want to hear
    emotionality: 0.3,         // stays steady when the user is reactive
  },
  memory: { types: ['episodic', 'semantic'] },
});
```

When a vector is supplied, the kernel weights retrieval, specialist routing, and tool selection by the trait values. Same agent, same prompt, same tools: a high-Openness leader and a high-Conscientiousness leader produce measurably different decision sequences. The bias lives in the kernel, not in the prompt; prompt-only personality dissolves under context pressure while kernel-encoded bias persists. The vector remains editable, inspectable, and removable on consent.

---

## Memory Benchmarks

`gpt-4o` reader, `gpt-4o-2024-08-06` judge, full N=500 across every row. Cross-provider numbers are excluded from the tables because their public methodology disclosures don't admit reproduction.

### LongMemEval-S (115K tokens, 50 sessions)

| System | Accuracy | $/correct | p50 latency |
|---|---:|---:|---:|
| EmergenceMem Internal | 86.0% | not published | 5,650 ms |
| **AgentOS** (canonical-hybrid + reader-router) | **85.6%** | **$0.0090** | **3,558 ms** |
| Mastra OM gpt-4o (gemini-flash observer) | 84.23% | not published | not published |
| Supermemory gpt-4o | 81.6% | not published | not published |
| EmergenceMem Simple Fast (rerun in agentos-bench) | 80.6% | $0.0586 | 3,703 ms |
| Zep (self / independent reproduction) | 71.2% / 63.8% | not published | not published |

+1.4 points above Mastra OM. EmergenceMem Internal posts 86.0% (0.4 above) but doesn't publish per-case results or a reproducible CLI; among open-source libraries with single-CLI reproduction at `gpt-4o`, 85.6% is the highest publicly reproducible number located. p50 latency 3,558 ms vs EmergenceMem's published median 5,650 ms.

Cross-provider numbers omitted from the table (different reader and/or undisclosed judge): Mastra OM 94.87% (gpt-5-mini + gemini-2.5-flash observer), agentmemory 96.2% (Claude Opus 4.6), MemMachine 93.0% (GPT-5-mini), Hindsight 91.4% (unspecified backbone).

### LongMemEval-M (1.5M tokens, 500 sessions)

M's haystacks exceed every production context window; most vendors only publish on S.

| System | Accuracy | License |
|---|---:|---|
| LongMemEval paper, GPT-4o round Top-10 (paper's best) | 72.0% | open repo |
| AgentBrain | 71.7% | closed-source SaaS |
| LongMemEval paper, GPT-4o session Top-5 | 71.4% | open repo |
| **AgentOS** (sem-embed + reader-router + Top-5) | **70.2%** | **Apache-2.0** |
| LongMemEval paper, GPT-4o round Top-5 | 65.7% | open repo |
| Mem0 v3, Mastra, Hindsight, Zep, EmergenceMem, Supermemory, Letta | not published | — |

At matched Top-5 retrieval, +4.5 above the round-level paper baseline (65.7%) and 1.2 below the session-level (71.4%); the paper's overall strongest GPT-4o result is 72.0% at Top-10. Of open-source libraries with publicly reproducible runs, AgentOS is the only one above 65% on M.

> **[Full leaderboard →](https://github.com/framersai/agentos-bench/blob/master/results/LEADERBOARD.md)** · **[Run JSONs →](https://github.com/framersai/agentos-bench/tree/master/results/runs)** · **[Transparency audit →](https://agentos.sh/en/blog/memory-benchmark-transparency-audit/)** · **[LongMemEval paper](https://arxiv.org/abs/2410.10813)** (Wu et al., ICLR 2025, Table 3)

The transparency audit covers what the headline numbers above don't. LOCOMO's answer key has a [6.4% ground-truth error rate per Penfield Labs](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) (capping any system's possible score at ~93.6%) and LOCOMO's default LLM judge accepts 62.81% of intentionally wrong answers — so any LOCOMO score gap below ~6 pp is inside the judge's noise floor. LongMemEval-S is partly a context-window test because 115K tokens fits in every modern reader. The audit post documents the Mem0-vs-Zep gaming case study, lists which vendors disclose which methodology dimensions (judge model, dataset version, per-case results, single-CLI reproduction), and explains the agentos-bench transparency stack: bootstrap 95% CIs at 10k Mulberry32 resamples (seed 42), per-benchmark judge-FPR probes (LongMemEval-S 1% [0%, 3%], LongMemEval-M 2% [0%, 5%], LOCOMO 0% [0%, 0%]), per-case run JSONs, single-CLI reproduction.

---

## 📄 Technical Whitepaper · Coming Soon

The full architecture and benchmark methodology, written for engineers and researchers who want a citable PDF instead of scrolling docs. Cognitive memory pipeline, classifier-driven dispatch, HEXACO personality modulation, runtime tool forging, full LongMemEval-S/M and LOCOMO benchmark methodology with confidence interval math, judge-FPR probes, per-stage retention metrics, and reproducibility recipes.

| Covers | What's inside |
|---|---|
| **Architecture** | Generalized Mind Instances, IngestRouter / MemoryRouter / ReadRouter, 8 cognitive mechanisms with primary-source citations |
| **Benchmarks** | LongMemEval-S 85.6%, LongMemEval-M 70.2%, vendor landscape, confidence interval methodology, judge FPR probes, full transparency stack |
| **Reproducibility** | Per-case run JSONs at `--seed 42`, single-CLI reproduction, Apache-2.0 bench at [github.com/framersai/agentos-bench](https://github.com/framersai/agentos-bench) |

**[Notify me when it drops →](mailto:team@frame.dev?subject=AgentOS%20Whitepaper%20Notify)** · **[Read the benchmarks now →](https://github.com/framersai/agentos-bench/blob/master/results/LEADERBOARD.md)** · **[Discord](https://wilds.ai/discord)**

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

Provider fallback is an explicit opt-in via `agent({ fallbackProviders: [...] })` (or `buildFallbackChain()` for programmatic chains). Defaults to off — the runtime never silently retries against a different provider unless you configured a chain.

[Full API reference →](https://docs.agentos.sh/api) · [High-Level API guide →](https://docs.agentos.sh/getting-started/high-level-api)

---

## Ecosystem

| Package | Role |
|---|---|
| [`@framers/agentos`](https://www.npmjs.com/package/@framers/agentos) | Core runtime: GMI agents, cognitive memory, multi-agent orchestration, guardrails, voice, 21 LLM providers. Apache 2.0. |
| [`@framers/agentos-extensions`](https://www.npmjs.com/package/@framers/agentos-extensions) | 100+ first-party extensions and templates: channel adapters, tool packs, integrations, guardrail packs. |
| [`@framers/agentos-extensions-registry`](https://www.npmjs.com/package/@framers/agentos-extensions-registry) | The discovery + auto-loader layer for the extensions catalog. Consumers wire this in to make curated extension packs available without packaging the entire extensions tree as a dependency. Separating the registry layer from the content layer lets a host pull the index without pulling the implementations. |
| [`@framers/agentos-skills`](https://www.npmjs.com/package/@framers/agentos-skills) | 88 curated SKILL.md skills covering common tasks. |
| [`@framers/agentos-skills-registry`](https://www.npmjs.com/package/@framers/agentos-skills-registry) | The discovery + auto-loader layer for the skills catalog. Same split as the extensions registry: a host imports this when it wants the curated skill index without bundling the full skills tree. Registries also serve community-contributed packs once they're vetted. |
| [`@framers/agentos-bench`](https://github.com/framersai/agentos-bench) | Open benchmark harness. Bootstrap 95% CIs at 10k resamples, judge false-positive-rate probes per benchmark, per-case run JSONs at fixed seed. MIT-licensed (the rest of AgentOS is Apache 2.0). |
| [`@framers/sql-storage-adapter`](https://www.npmjs.com/package/@framers/sql-storage-adapter) | Cross-platform SQL persistence: SQLite (better-sqlite3 + sql.js for browsers), Postgres, IndexedDB, Capacitor SQLite. |
| [`paracosm`](https://www.npmjs.com/package/paracosm) | AI agent swarm simulation engine that uses AgentOS as its substrate. |

**Extensions and skills auto-load at startup.** The runtime walks each registry plus any user-supplied paths, resolves each pack's `createExtensionPack(context)` factory or SKILL.md frontmatter, and registers tools, guardrails, channels, and skills without manual wiring. Capability gating and HITL approval gates apply to side-effecting installs. See [extensions architecture](https://docs.agentos.sh/architecture/extension-loading) for the full loading model.

---

## Documentation & Community

- **[Benchmarks](https://github.com/framersai/agentos-bench/blob/master/results/LEADERBOARD.md)**: benchmark tables, 95% confidence intervals, methodology audit
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
