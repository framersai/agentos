<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="80" />
</a>

# AgentOS

**Build autonomous AI agents with adaptive intelligence, cognitive memory, and emergent behaviors. Open-source TypeScript runtime.**

[![npm version](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/ci.yml?branch=master&style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-3%2C866%2B_passed-2ea043?style=flat-square&logo=vitest&logoColor=white)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/framersai/agentos/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](https://opensource.org/licenses/Apache-2.0)

[Website](https://agentos.sh) · [Documentation](https://docs.agentos.sh) · [npm](https://www.npmjs.com/package/@framers/agentos) · [GitHub](https://github.com/framersai/agentos)

</div>

---

## Overview

AgentOS is an open-source TypeScript runtime for building autonomous AI agents. Agents have personality traits that shape how they think, cognitive memory that determines what they remember, and emergent capabilities that let them forge new tools at runtime. The result is agents that adapt and improve without retraining.

Unlike frameworks that focus purely on LLM orchestration, AgentOS treats each agent as a **Generalized Mind Instance** (GMI) — a cognitive entity with its own identity, personality, memory lifecycle, and behavioral adaptation loop. This makes it particularly suited for long-running agents, multi-agent teams, and applications where agent consistency matters.

**What makes it different:**

| vs. | AgentOS differentiator |
|-----|------------------------|
| LangChain / LlamaIndex | Cognitive memory with 8 neuroscience-backed mechanisms, HEXACO personality modulation, runtime tool forging |
| Vercel AI SDK | Multi-agent teams with 6 strategies, full RAG pipeline with 7 vector backends, guardrail packs, voice/telephony |
| AutoGen / CrewAI | Unified orchestration layer (workflow DAGs, agent graphs, goal-driven missions), personality-driven edge routing |

**Ecosystem packages:**

| Package | Description |
|---------|-------------|
| [`@framers/agentos`](https://www.npmjs.com/package/@framers/agentos) | Core runtime -- agents, providers, memory, RAG, orchestration, guardrails |
| [`@framers/agentos-extensions`](https://www.npmjs.com/package/@framers/agentos-extensions) | Official extension registry (40+ extensions) |
| [`@framers/agentos-extensions-registry`](https://www.npmjs.com/package/@framers/agentos-extensions-registry) | Curated manifest builder for extension catalogs |
| [`@framers/agentos-skills`](https://www.npmjs.com/package/@framers/agentos-skills) | 80+ curated SKILL.md skill definitions |
| [`@framers/agentos-skills-registry`](https://www.npmjs.com/package/@framers/agentos-skills-registry) | Skills catalog SDK (query helpers + snapshot factories) |
| [`@framers/sql-storage-adapter`](https://www.npmjs.com/package/@framers/sql-storage-adapter) | Cross-platform SQL persistence (SQLite, sql.js, Postgres, IndexedDB) |

---

## Install

```bash
npm install @framers/agentos
```

Set any provider's API key:

```bash
export OPENAI_API_KEY=sk-...        # or ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, etc.
```

---

## Quick Start

### 1. Generate Text

AgentOS auto-detects which provider to use from your environment variables and maps each provider to a sensible default model (see [Default Models Per Provider](#default-models-per-provider) below):

```typescript
import { generateText } from '@framers/agentos';

// Zero config -- auto-detects provider from env vars, uses its default model
// Priority: OPENAI_API_KEY → ANTHROPIC_API_KEY → OPENROUTER_API_KEY → GEMINI → ...
const result = await generateText({
  prompt: 'Explain how TCP handshakes work in 3 bullets.',
});
console.log(result.text);

// Pin a provider -- uses that provider's default model (e.g. anthropic → claude-sonnet-4)
const pinned = await generateText({
  provider: 'anthropic',
  prompt: 'Compare TCP and UDP.',
});

// Full control -- explicit provider + model override
const custom = await generateText({
  provider: 'openai',
  model: 'gpt-4o-mini',        // override the default (gpt-4o)
  prompt: 'What is the capital of France?',
});
```

16 providers supported. Auto-fallback on 402/429/5xx — if the primary provider fails, the next available provider is tried automatically.

### 2. Streaming

```typescript
import { streamText } from '@framers/agentos';

const stream = streamText({
  provider: 'openai',
  prompt: 'Write a haiku about distributed systems.',
});

// Iterate token-by-token
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

// Or await the full result
const fullText = await stream.text;
const usage = await stream.usage;
console.log(`\n\nTokens used: ${usage.totalTokens}`);
```

### 3. Structured Output

Extract typed data from unstructured text with Zod validation:

```typescript
import { generateObject } from '@framers/agentos';
import { z } from 'zod';

const { object } = await generateObject({
  provider: 'gemini',
  schema: z.object({
    name: z.string(),
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    topics: z.array(z.string()),
  }),
  prompt: 'Analyze: "The new iPhone camera is incredible but the battery life is disappointing."',
});

console.log(object);
// { name: "iPhone Review", sentiment: "neutral", topics: ["camera", "battery"] }
```

Failed parses are automatically retried with error feedback so the model can self-correct.

### 4. Agent with Personality & Memory

This is the key differentiator. Agents have HEXACO personality traits that shape their communication style, and cognitive memory that determines what they retain:

```typescript
import { agent } from '@framers/agentos';

const tutor = agent({
  provider: 'anthropic',
  instructions: 'You are a patient computer science tutor.',
  personality: {
    openness: 0.9,           // creative, exploratory answers
    conscientiousness: 0.95, // thorough, well-structured
    agreeableness: 0.85,     // warm, encouraging tone
  },
  memory: {
    enabled: true,
    cognitive: true,         // Ebbinghaus decay, reconsolidation, involuntary recall
  },
  tools: [{
    name: 'run_code',
    description: 'Execute a code snippet and return output.',
    parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    execute: async ({ code }) => ({ success: true, output: `Ran: ${code}` }),
  }],
});

// Sessions maintain conversation history
const session = tutor.session('student-1');
const reply = await session.send('Explain recursion with an analogy.');
console.log(reply.text);

// Memory persists -- the agent remembers prior context
const followUp = await session.send('Can you expand on that?');
console.log(followUp.text);

// Export agent config for portability
const config = tutor.exportJSON();
```

### 5. Multimodal (Image, Video, Audio, OCR, Embeddings)

```typescript
import {
  generateImage,
  performOCR,
  embedText,
  generateVideo,
  generateMusic,
} from '@framers/agentos';

// Generate an image (supports OpenAI, Stability, Replicate, BFL, Fal)
const image = await generateImage({
  provider: 'openai',
  prompt: 'A cyberpunk cityscape at sunset, neon signs reflecting in rain puddles',
  size: '1024x1024',
});
console.log(image.images[0].url);

// OCR: extract text from images (progressive tiers: local -> cloud LLM)
const ocr = await performOCR({
  image: '/tmp/receipt.png',
  strategy: 'progressive', // tries fast local OCR first, falls back to cloud
});
console.log(ocr.text);

// Embeddings (OpenAI, Ollama, or any compatible provider)
const embedding = await embedText({
  provider: 'openai',
  input: ['Hello world', 'Goodbye world'],
  dimensions: 256,
});
console.log(embedding.embeddings[0].length); // 256

// Video generation
const video = await generateVideo({
  prompt: 'A timelapse of a flower blooming',
});

// Music generation
const music = await generateMusic({
  prompt: 'Lo-fi hip hop beat for studying',
});
```

### 6. Multi-Agent Teams

Coordinate specialized agents with built-in strategies:

```typescript
import { agency } from '@framers/agentos';

const team = agency({
  agents: {
    researcher: {
      instructions: 'Find relevant facts and data.',
      provider: 'anthropic',
    },
    writer: {
      instructions: 'Write a clear, engaging summary.',
      provider: 'openai',
    },
    reviewer: {
      instructions: 'Check for accuracy and suggest improvements.',
      provider: 'gemini',
      dependsOn: ['writer'], // runs after writer completes
    },
  },
  strategy: 'graph',          // dependency-based DAG execution
  memory: { shared: true },   // agents share context
});

const result = await team.generate('Compare TCP vs UDP for game networking.');
console.log(result.text);

// Streaming works too
const stream = team.stream('Explain QUIC protocol benefits.');
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

6 strategies: `sequential`, `parallel`, `debate`, `review-loop`, `hierarchical`, `graph`.

Auto-detection: when any agent declares `dependsOn`, strategy defaults to `graph`.

### 7. Orchestration (Workflows, Graphs, Missions)

Three authoring APIs that compile to one graph runtime. Choose based on how much control you need:

```typescript
import {
  workflow,
  AgentGraph,
  mission,
  gmiNode,
  toolNode,
  START,
  END,
} from '@framers/agentos/orchestration';
import { z } from 'zod';

// 1. workflow() -- deterministic DAG with typed I/O
const pipeline = workflow('content-pipeline')
  .input(z.object({ topic: z.string() }))
  .returns(z.object({ summary: z.string() }))
  .step('research', { tool: 'web_search' })
  .then('draft', { gmi: { instructions: 'Write a blog post from the research.' } })
  .then('review', { gmi: { instructions: 'Review for accuracy and tone.' } })
  .compile();

const result = await pipeline.invoke({ topic: 'WebAssembly in 2026' });

// 2. AgentGraph -- explicit nodes, edges, cycles, subgraphs
const graph = new AgentGraph({
  input: z.object({ topic: z.string() }),
  scratch: z.object({ draft: z.string().optional() }),
  artifacts: z.object({ summary: z.string().optional() }),
})
  .addNode('draft', gmiNode({ instructions: 'Draft a summary', executionMode: 'single_turn' }))
  .addNode('publish', toolNode('publish_report'))
  .addEdge(START, 'draft')
  .addEdge('draft', 'publish')
  .addEdge('publish', END)
  .compile();

await graph.invoke({ topic: 'quantum computing' });

// 3. mission() -- goal-driven, planner decides the steps
const researcher = mission('deep-research')
  .input(z.object({ topic: z.string() }))
  .goal('Research {topic} and produce a cited summary')
  .returns(z.object({ summary: z.string() }))
  .planner({ strategy: 'plan_and_execute', maxSteps: 8 })
  .compile();

// Preview the plan without executing
const preview = await researcher.explain({ topic: 'AI safety' });
console.log(preview.steps.map(s => s.id));
```

All three support persistent checkpointing for fault recovery and time-travel debugging.

See [`docs/orchestration/WORKFLOW_DSL.md`](./docs/orchestration/WORKFLOW_DSL.md), [`docs/architecture/AGENT_GRAPH.md`](./docs/architecture/AGENT_GRAPH.md), [`docs/orchestration/MISSION_API.md`](./docs/orchestration/MISSION_API.md).

### 8. Voice Pipeline

```typescript
import { agent } from '@framers/agentos';

const receptionist = agent({
  provider: 'openai',
  instructions: 'You are a friendly receptionist for a dental clinic.',
  voice: {
    tts: { provider: 'elevenlabs', voice: 'Rachel' },
    stt: { provider: 'deepgram' },
  },
});
```

Telephony providers: Twilio, Telnyx, Plivo. Speech: ElevenLabs, Deepgram, OpenAI Whisper, and more.

### 9. Guardrails

5-tier security with 6 guardrail packs:

```typescript
import { agent } from '@framers/agentos';

const secureBot = agent({
  provider: 'anthropic',
  instructions: 'You are a customer support agent.',
  security: { tier: 'strict' },
  guardrails: {
    input: ['pii-redaction', 'ml-classifiers'],    // block PII + detect injection
    output: ['grounding-guard', 'code-safety'],     // prevent hallucination + unsafe code
  },
});
```

5 security tiers: `dangerous` > `permissive` > `balanced` > `strict` > `paranoid`.

6 guardrail packs:
- **PII Redaction** -- four-tier detection (regex + NLP + NER + LLM)
- **ML Classifiers** -- toxicity, injection, jailbreak via ONNX BERT
- **Topicality** -- embedding-based topic enforcement + drift detection
- **Code Safety** -- OWASP Top 10 code scanning (25 regex rules)
- **Grounding Guard** -- RAG-source claim verification and hallucination detection
- **Content Policy Rewriter** -- 8 categories, LLM rewrite/block, 4 presets

### 10. Citation Verification

Verify claims in agent responses against sources using cosine similarity:

```typescript
import { CitationVerifier } from '@framers/agentos';

const verifier = new CitationVerifier({
  embedFn: async (texts) => embeddingManager.embedBatch(texts),
});

const result = await verifier.verify(
  "Tokyo has a population of 14 million. It is the capital of Japan.",
  [
    { content: "Tokyo proper has a population of approximately 14 million.", url: "https://example.com" },
    { content: "Tokyo is the capital and largest city of Japan.", url: "https://example.com/japan" },
  ]
);

console.log(result.summary);
// "2/2 claims verified (100%)"
console.log(result.claims[0]);
// { text: "Tokyo has a population of 14 million.", verdict: "supported", confidence: 0.87 }
```

On-demand tool for agents:

```typescript
// Agent can call verify_citations to check its own output
verify_citations({
  text: "The speed of light is 300,000 km/s.",
  webFallback: true,  // search web if sources don't match
})
```

Automatic during deep research — set `verifyCitations: true` in config:

```json
{ "queryRouter": { "verifyCitations": true } }
```

### Default Models Per Provider

When you specify `provider` without `model`, these defaults are used:

| Provider | Default Text Model | Default Image Model | Env Var |
|---|---|---|---|
| `openai` | gpt-4o | gpt-image-1 | `OPENAI_API_KEY` |
| `anthropic` | claude-sonnet-4 | -- | `ANTHROPIC_API_KEY` |
| `gemini` | gemini-2.5-flash | -- | `GEMINI_API_KEY` |
| `ollama` | llama3.2 | stable-diffusion | `OLLAMA_BASE_URL` |
| `groq` | llama-3.3-70b-versatile | -- | `GROQ_API_KEY` |
| `openrouter` | openai/gpt-4o | -- | `OPENROUTER_API_KEY` |
| `together` | Meta-Llama-3.1-70B | -- | `TOGETHER_API_KEY` |
| `mistral` | mistral-large-latest | -- | `MISTRAL_API_KEY` |
| `xai` | grok-2 | -- | `XAI_API_KEY` |
| `stability` | -- | stable-diffusion-xl | `STABILITY_API_KEY` |
| `replicate` | -- | flux-1.1-pro | `REPLICATE_API_TOKEN` |
| `bfl` | -- | flux-pro-1.1 | `BFL_API_KEY` |
| `fal` | -- | fal-ai/flux/dev | `FAL_API_KEY` |
| `claude-code-cli` | claude-sonnet-4 | -- | `claude` binary on PATH |
| `gemini-cli` | gemini-2.5-flash | -- | `gemini` binary on PATH |
| `stable-diffusion-local` | -- | v1-5-pruned-emaonly | `STABLE_DIFFUSION_LOCAL_BASE_URL` |

Auto-detection priority: OpenAI > Anthropic > OpenRouter > Gemini > Groq > Together > Mistral > xAI > claude-code-cli > gemini-cli > Ollama > image-only providers.

---

## Core Concepts

### GMI (Generalized Modular Intelligence)

Each agent is backed by a GMI instance -- the "brain" that manages working memory, persona overlays, context assembly, and the cognitive loop. A single runtime can manage multiple GMI instances via `GMIManager`.

GMI components: working memory (7 +/- 2 slots, Baddeley's model), context manager, persona overlay switching, adaptation manager (learning rate, style drift), and multi-layer memory (episodic, semantic, procedural, prospective).

See [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) for detailed diagrams and data flow.

### HEXACO Personality

Six personality dimensions modulate agent behavior at every level -- from memory retrieval to response style:

| Trait | High Value Effect | Low Value Effect |
|-------|-------------------|------------------|
| **Honesty-Humility** | Source skepticism, transparent reasoning | Confident assertions |
| **Emotionality** | Memory reconsolidation drift toward mood | Stable recall |
| **Extraversion** | Stronger feeling-of-knowing, verbose output | Reserved, concise output |
| **Agreeableness** | Emotion regulation during consolidation | Unfiltered expression |
| **Conscientiousness** | Retrieval-induced forgetting of irrelevant data | Broader recall |
| **Openness** | Involuntary recall, novelty-boosted encoding | Schema-conforming recall |

Personality traits are set at agent creation and can be adapted within bounded limits at runtime via `adapt_personality`.

### Cognitive Memory

8 neuroscience-backed mechanisms, all HEXACO personality-modulated:

| Mechanism | Effect | Citation |
|-----------|--------|----------|
| Reconsolidation | Retrieved memories drift toward current mood | [Nader, Schiller & LeDoux (2000)](https://doi.org/10.1038/35021052). *Nature*, 406, 722-726 |
| Retrieval-Induced Forgetting | Retrieving one memory suppresses similar competitors | [Anderson, Bjork & Bjork (1994)](https://doi.org/10.1037/0278-7393.20.5.1063). *JEP: Learning*, 20, 1063-1087 |
| Involuntary Recall | Random surfacing of old high-vividness memories | [Berntsen (1996)](https://doi.org/10.1002/(SICI)1099-0720(199610)10:5%3C435::AID-ACP395%3E3.0.CO;2-8). *Applied Cognitive Psychology*, 10, 435-454 |
| Metacognitive FOK | Feeling-of-knowing scoring for tip-of-tongue states | [Hart (1965)](https://doi.org/10.1037/h0022263). *JEPG*, 56, 208-216 |
| Temporal Gist Extraction | Old traces compressed to core assertions | [Reyna & Brainerd (1995)](https://doi.org/10.1006/drev.1995.1002). *Developmental Review*, 15, 3-47 |
| Schema Encoding | Novel input boosted, schema-matching encoded efficiently | [Bartlett (1932)](https://doi.org/10.1017/CBO9780511759185). *Remembering*. Cambridge University Press |
| Source Confidence Decay | Agent inferences decay faster than observations | [Johnson, Hashtroudi & Lindsay (1993)](https://doi.org/10.1037/0033-2909.114.1.3). *Psych. Bulletin*, 114, 3-28 |
| Emotion Regulation | Reappraisal + suppression during consolidation | [Gross (1998)](https://doi.org/10.1037/1089-2680.2.3.271). *Review of General Psychology*, 2, 271-299 |

**HEXACO Personality Modulation** -- each mechanism's intensity is governed by one or more HEXACO traits:

| HEXACO Trait | Mechanisms Modulated | Effect |
|--------------|---------------------|--------|
| Emotionality | Reconsolidation | Higher emotionality increases mood-congruent drift rate |
| Conscientiousness | Retrieval-Induced Forgetting | Higher conscientiousness strengthens suppression of irrelevant competitors |
| Openness | Involuntary Recall, Schema Encoding | Higher openness increases involuntary recall probability and novelty boost |
| Extraversion | Metacognitive FOK | Higher extraversion strengthens feeling-of-knowing confidence signals |
| Honesty-Humility | Source Confidence Decay | Higher honesty increases skepticism of agent-inferred sources |
| Agreeableness | Emotion Regulation | Higher agreeableness strengthens reappraisal during consolidation |

**Using cognitive mechanisms with `agent()`:**

```typescript
import { agent } from '@framers/agentos';

const researcher = agent({
  provider: 'anthropic',
  instructions: 'You are a thorough research analyst.',
  personality: {
    openness: 0.9,           // High openness -> more involuntary recall, stronger novelty bias
    conscientiousness: 0.85,  // High conscientiousness -> stronger RIF suppression
    emotionality: 0.6,       // Moderate -> moderate reconsolidation drift
  },
  memory: { enabled: true },
  cognitiveMechanisms: {
    // All 8 mechanisms enabled with defaults -- just pass {}
    // Or tune individual mechanisms:
    reconsolidation: { driftRate: 0.08 },
    involuntaryRecall: { probability: 0.12 },
    temporalGist: { ageThresholdDays: 30 },
  },
});
```

Pass `{}` for all defaults, or omit entirely to disable (zero overhead).

Memory is organized in a 4-tier hierarchy: `core/` (encoding, decay, working memory), `retrieval/` (composite scoring, graph, prospective), `pipeline/` (consolidation, observation, lifecycle), `io/` (ingestion, import/export).

See [`docs/memory/COGNITIVE_MECHANISMS.md`](./docs/memory/COGNITIVE_MECHANISMS.md) for API reference and 30+ APA citations.

### Multimodal RAG

Complete retrieval-augmented generation pipeline:

- **7 vector backends:** InMemory, SQL (SQLite/Postgres), HNSW, Qdrant, Neo4j, Postgres+pgvector, Pinecone
- **4 retrieval strategies:** keyword, vector, hybrid (RRF), HyDE (Hypothetical Document Embedding)
- **GraphRAG:** entity/relationship extraction, Louvain community detection, local + global search
- **4-tier scaling path:** SQLite (dev) > HNSW sidecar (auto at 1K vectors) > Postgres+pgvector > Qdrant/Pinecone
- **Document ingestion:** PDF, DOCX, HTML, Markdown, URL
- **One-command migration** between any two backends via `MigrationEngine`

See [`docs/memory/RAG_MEMORY_CONFIGURATION.md`](./docs/memory/RAG_MEMORY_CONFIGURATION.md) and [`docs/memory/MULTIMODAL_RAG.md`](./docs/memory/MULTIMODAL_RAG.md).

### Adaptive Intelligence & Metacognition

Agents don't just respond — they monitor their own performance and adapt their behavior in real-time.

**MetapromptExecutor** rewrites the agent's own system prompt mid-conversation based on detected patterns:

| Trigger | What happens | Example |
|---------|-------------|---------|
| **Frustration recovery** | Detects user frustration via SentimentTracker → simplifies language, offers alternatives | User asks same question 3x → agent acknowledges confusion and tries a different approach |
| **Confusion clarification** | Detects ambiguous query → asks targeted follow-up | Vague request → agent probes for specifics before acting |
| **Satisfaction reinforcement** | Detects positive feedback → reinforces successful patterns | User says "perfect" → agent remembers what worked |
| **Engagement boost** | Detects disengagement → adjusts tone, offers proactive suggestions | Short replies → agent becomes more concise and action-oriented |
| **Error recovery** | Detects tool failures → adjusts strategy | API call fails → agent switches to alternative approach |
| **Trait adjustment** | Bounded HEXACO mutation → personality evolves within limits | Agent becomes slightly more conscientious after repeated accuracy requests |

Three trigger modes: `turn_interval` (periodic self-reflection), `event_based` (driven by sentiment events), and `manual` (flags in working memory).

**PromptProfileRouter** selects prompt strategies based on task classification — a code question gets a different prompt structure than a creative writing request.

**Self-improvement** (opt-in, bounded):

```typescript
const adaptive = agent({
  provider: 'anthropic',
  instructions: 'You are a research analyst.',
  selfImprovement: {
    enabled: true,
    personality: {
      maxDeltaPerSession: 0.15,  // HEXACO traits can shift ±0.15 per session
      decayToBaseline: true,     // Drift back toward baseline during consolidation
    },
    skills: { enabled: true },   // Can enable/disable skills based on task
    selfEvaluation: {
      enabled: true,             // LLM-based self-scoring after each turn
      adjustParameters: true,    // Auto-tune temperature/top-p based on scores
    },
  },
});
```

See [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) for the full metacognition pipeline.

### Emergent Capabilities

Agents with `emergent: true` create new tools at runtime:

- **Runtime tool forging** via `forge_tool` — sandboxed JavaScript execution + LLM-as-judge safety evaluation
- **Dynamic skill management** via `manage_skills` — enable/disable skills based on task
- **Tiered promotion:** session (in-memory) → agent (persisted after 5+ uses with >0.8 confidence) → shared (HITL-approved)
- **Self-improving personality** — bounded HEXACO trait adaptation with Ebbinghaus decay

```typescript
const creative = agent({
  provider: 'openai',
  instructions: 'You solve problems creatively.',
  emergent: {
    enabled: true,
    toolForging: true,       // Can create new tools at runtime
    maxForgedTools: 10,      // Limit per session
    promotionThreshold: 0.8, // Confidence required for permanent promotion
  },
});

const session = creative.session('project');
await session.send('Parse this CSV and create a chart');
// Agent may forge a "csv_parser" tool if none exists,
// run it in a sandbox, and promote it if it works well.

console.log(session.forgedTools());
// [{ name: "csv_parser", forgedAt: "...", uses: 3, confidence: 0.92 }]
```

See [`docs/architecture/EMERGENT_CAPABILITIES.md`](./docs/architecture/EMERGENT_CAPABILITIES.md).

### Capability Discovery

3-tier semantic search that replaces static tool/skill dumps (~90% token reduction):

- **Tier 0:** Category summaries (~150 tokens, always included)
- **Tier 1:** Top-5 semantic matches (~200 tokens)
- **Tier 2:** Full schemas on demand (~1500 tokens)

The `discover_capabilities` meta-tool lets agents self-discover available tools, skills, and extensions at runtime.

---

## Architecture

```
+------------------------------------------------------------------+
|                        AgentOS Runtime                            |
|                                                                   |
|  +-----------+   +--------------+   +-----------+                |
|  | API Layer |-->| Orchestrator |-->|  Streaming |                |
|  +-----------+   +--------------+   +-----------+                |
|        |                |                                         |
|  +-----v----------------v-----+                                  |
|  |     GMI (Generalized        |     +------------------+        |
|  |     Modular Intelligence)   |---->| Tool Orchestrator |        |
|  |                             |     +------------------+        |
|  |  Working Memory  Persona    |     +------------------+        |
|  |  Context Mgr     Adaptation |---->| RAG Pipeline     |        |
|  |  Episodic  Semantic  Proc.  |     +------------------+        |
|  +-----------------------------+     +------------------+        |
|        |                        ---->| Planning Engine  |        |
|  +-----v-----+                       +------------------+        |
|  | LLM Providers (16)         |                                  |
|  | OpenAI  Anthropic  Gemini  |   +----------+  +----------+    |
|  | Ollama  Groq  OpenRouter   |   | Guardrails|  | Channels |    |
|  | Together Mistral xAI  ...  |   | (6 packs) |  | (37)     |    |
|  +----------------------------+   +----------+  +----------+    |
+------------------------------------------------------------------+
```

For the full architecture with data flow diagrams, request lifecycle, and layer breakdown, see [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md).

---

## Configuration

### Environment Variables

```bash
# LLM providers (set at least one)
OPENAI_API_KEY=sk-...                      # OpenAI (GPT-4o, GPT-4o-mini, o1, o3)
ANTHROPIC_API_KEY=sk-ant-...               # Anthropic (Claude Sonnet 4, Claude Haiku)
GEMINI_API_KEY=AIza...                     # Google Gemini (2.5 Flash, 2.0)
OPENROUTER_API_KEY=sk-or-...              # OpenRouter (200+ models, auto-routing)
GROQ_API_KEY=gsk_...                       # Groq (fast inference: Llama 3.3 70B)
TOGETHER_API_KEY=...                       # Together AI (Llama, Mixtral)
MISTRAL_API_KEY=...                        # Mistral (Mistral Large, Small)
XAI_API_KEY=xai-...                        # xAI (Grok-2)
OLLAMA_BASE_URL=http://localhost:11434     # Ollama (local models, no API key needed)

# Database (optional, defaults to in-memory)
DATABASE_URL=file:./data/agentos.db

# Observability (optional)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-agent

# Voice/Telephony (optional)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
```

### Multiple Providers

High-level helpers auto-detect from env vars -- no configuration object needed:

```typescript
import { generateText } from '@framers/agentos';

// Each call picks the right credentials automatically
await generateText({ provider: 'anthropic', prompt: 'Hello from Claude' });
await generateText({ provider: 'openai',    prompt: 'Hello from GPT' });
await generateText({ provider: 'gemini',    prompt: 'Hello from Gemini' });
await generateText({ provider: 'ollama',    prompt: 'Hello from Llama' });

// Omit provider -- auto-detects the first configured one
await generateText({ prompt: 'Hello from whichever provider is available' });
```

For the full runtime with explicit provider configuration, see [`docs/getting-started/HIGH_LEVEL_API.md`](./docs/getting-started/HIGH_LEVEL_API.md).

### Fallback Providers

```typescript
import { agent } from '@framers/agentos';

const resilient = agent({
  provider: 'anthropic',
  instructions: 'You are a helpful assistant.',
  fallbackProviders: [
    { provider: 'openai' },
    { provider: 'groq' },
  ],
  onFallback: (error, provider) => {
    console.warn(`Falling back to ${provider}: ${error.message}`);
  },
});
```

---

## API Quick Reference

### High-Level Functions

| Function | Description |
|----------|-------------|
| `generateText(opts)` | Single-call text generation with multi-step tool calling |
| `streamText(opts)` | Streaming text generation with async iterables |
| `generateObject(opts)` | Zod-validated structured output extraction |
| `streamObject(opts)` | Streaming structured output |
| `embedText(opts)` | Text embedding generation (single or batch) |
| `generateImage(opts)` | Image generation (OpenAI, Stability, Replicate, BFL, Fal) |
| `editImage(opts)` | Image editing/inpainting |
| `upscaleImage(opts)` | Image upscaling |
| `variateImage(opts)` | Image variations |
| `generateVideo(opts)` | Video generation |
| `analyzeVideo(opts)` | Video analysis and understanding |
| `detectScenes(opts)` | Scene detection in video |
| `generateMusic(opts)` | Music generation |
| `generateSFX(opts)` | Sound effect generation |
| `performOCR(opts)` | Text extraction from images (progressive tiers) |
| `agent(opts)` | Stateful agent with personality, memory, and sessions |
| `agency(opts)` | Multi-agent team with strategy-based coordination |
| `hitl(opts)` | Human-in-the-loop approval handler |

### Orchestration Builders

| Builder | Import Path | Description |
|---------|-------------|-------------|
| `workflow(name)` | `@framers/agentos/orchestration` | Deterministic DAG with typed steps |
| `AgentGraph` | `@framers/agentos/orchestration` | Explicit graph with cycles, subgraphs |
| `mission(name)` | `@framers/agentos/orchestration` | Goal-driven, planner decides steps |

### Core Types

```typescript
import type {
  AgentOSInput,           // Full runtime input structure
  AgentOSResponse,        // Streaming response chunk
  ITool,                  // Tool interface (id, name, inputSchema, execute)
  ToolExecutionResult,    // Tool result (success, output, error)
  AgentOptions,           // agent() configuration
  AgencyOptions,          // agency() configuration
  GenerateTextOptions,    // generateText() / streamText() options
  GenerateImageOptions,   // generateImage() options
  GenerateObjectOptions,  // generateObject() options
  EmbedTextOptions,       // embedText() options
  ExtensionDescriptor,    // Extension pack descriptor
  IGuardrailService,      // Guardrail interface
  IChannelAdapter,        // Channel adapter interface
} from '@framers/agentos';
```

### Full Runtime

The `AgentOS` class provides the full-featured runtime with GMI management, extension loading, and streaming:

```typescript
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

---

## Package Exports

AgentOS provides 112 export paths for fine-grained imports:

```typescript
// Main entry -- all public types and classes
import { AgentOS, generateText, streamText, agent, agency } from '@framers/agentos';

// Configuration
import { createAgentOSConfig, createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

// Orchestration (workflow, graph, mission builders)
import { workflow, AgentGraph, mission, START, END } from '@framers/agentos/orchestration';

// Safety primitives
import { CircuitBreaker, CostGuard, StuckDetector } from '@framers/agentos/safety/runtime';

// Guardrails
import { GuardrailAction, ParallelGuardrailDispatcher } from '@framers/agentos/safety/guardrails';

// RAG and GraphRAG
import { VectorStoreManager, EmbeddingManager, RetrievalAugmentor } from '@framers/agentos/rag';
import { GraphRAGEngine } from '@framers/agentos/rag/graphrag';

// Skills
import { SkillRegistry, SkillLoader } from '@framers/agentos/skills';

// Tools
import type { ITool, ToolExecutionResult } from '@framers/agentos/core/tools';

// HITL
import type { IHumanInteractionManager } from '@framers/agentos/orchestration/hitl';

// Deep imports via wildcard (up to 4 levels)
import { SomeType } from '@framers/agentos/safety/runtime/CircuitBreaker';
```

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| [`ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) | Full system architecture, data flow diagrams, layer breakdown |
| [`HIGH_LEVEL_API.md`](./docs/getting-started/HIGH_LEVEL_API.md) | `generateText`, `streamText`, `generateObject`, `agent` reference |
| [`AGENCY_API.md`](./docs/orchestration/AGENCY_API.md) | `agency()` -- all strategies, HITL, guardrails, RAG, nested agencies |
| [`UNIFIED_ORCHESTRATION.md`](./docs/orchestration/UNIFIED_ORCHESTRATION.md) | Orchestration layer overview (workflow, graph, mission) |
| [`WORKFLOW_DSL.md`](./docs/orchestration/WORKFLOW_DSL.md) | `workflow()` DSL reference |
| [`AGENT_GRAPH.md`](./docs/architecture/AGENT_GRAPH.md) | `AgentGraph` builder reference |
| [`MISSION_API.md`](./docs/orchestration/MISSION_API.md) | `mission()` goal-driven orchestration |
| [`CHECKPOINTING.md`](./docs/orchestration/CHECKPOINTING.md) | Persistent checkpointing and fault recovery |
| [`COGNITIVE_MECHANISMS.md`](./docs/memory/COGNITIVE_MECHANISMS.md) | 8 cognitive memory mechanisms, 30+ APA citations |
| [`RAG_MEMORY_CONFIGURATION.md`](./docs/memory/RAG_MEMORY_CONFIGURATION.md) | Vector store setup, embedding models, data sources |
| [`MULTIMODAL_RAG.md`](./docs/memory/MULTIMODAL_RAG.md) | Image, audio, and document RAG pipelines |
| [`MEMORY_SCALING.md`](./docs/memory/MEMORY_SCALING.md) | 4-tier vector storage scaling path |
| [`GUARDRAILS_USAGE.md`](./docs/safety/GUARDRAILS_USAGE.md) | Guardrail implementation patterns |
| [`SAFETY_PRIMITIVES.md`](./docs/safety/SAFETY_PRIMITIVES.md) | Circuit breaker, cost guard, stuck detection |
| [`HUMAN_IN_THE_LOOP.md`](./docs/safety/HUMAN_IN_THE_LOOP.md) | Approval workflows, clarification, escalation |
| [`PLANNING_ENGINE.md`](./docs/orchestration/PLANNING_ENGINE.md) | ReAct reasoning, task planning |
| [`STRUCTURED_OUTPUT.md`](./docs/orchestration/STRUCTURED_OUTPUT.md) | JSON schema validation, entity extraction |
| [`AGENT_COMMUNICATION.md`](./docs/architecture/AGENT_COMMUNICATION.md) | Inter-agent messaging and handoffs |
| [`PLATFORM_SUPPORT.md`](./docs/architecture/PLATFORM_SUPPORT.md) | 37 channel platform capabilities |
| [`OBSERVABILITY.md`](./docs/observability/OBSERVABILITY.md) | OpenTelemetry setup, tracing, metrics |
| [`COST_OPTIMIZATION.md`](./docs/safety/COST_OPTIMIZATION.md) | Token usage, caching, model routing |
| [`SKILLS.md`](./docs/extensions/SKILLS.md) | SKILL.md format, skill authoring guide |
| [`EMERGENT_CAPABILITIES.md`](./docs/architecture/EMERGENT_CAPABILITIES.md) | Runtime tool forging, tiered promotion |
| [`SQL_STORAGE_QUICKSTART.md`](./docs/getting-started/SQL_STORAGE_QUICKSTART.md) | SQLite/Postgres setup |
| [`ECOSYSTEM.md`](./docs/architecture/ECOSYSTEM.md) | Extension ecosystem and official packs |

---

## Contributing

```bash
git clone https://github.com/framersai/agentos.git
cd agentos
pnpm install
pnpm run build
pnpm run test
```

| Script | Purpose |
|--------|---------|
| `pnpm run build` | Clean, compile TypeScript, resolve aliases, fix ESM imports |
| `pnpm run typecheck` | Type-check without emitting |
| `pnpm run lint` | Strip non-breaking spaces + ESLint |
| `pnpm run test` | Run vitest test suite |
| `pnpm run dev:test` | Run vitest in watch mode |
| `pnpm run docs` | Generate TypeDoc API documentation |

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:` (minor), `fix:` (patch), `BREAKING CHANGE:` (major).

See the [Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md) for details.

---

## License

[Apache 2.0](./LICENSE) -- [Frame.dev](https://frame.dev)

<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="40" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://frame.dev">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/frame-logo-green-no-tagline.svg" alt="Frame.dev" height="40" />
</a>

**Built by [Frame.dev](https://frame.dev)**

</div>
