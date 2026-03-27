# Getting Started with AgentOS

> Your fastest path from zero to a running AI agent — one line, three lines, or five, depending on how much you need.

---

## Table of Contents

1. [Installation](#installation)
2. [Environment Setup](#environment-setup)
3. [Level 1 — Single Text Generation](#level-1--single-text-generation)
4. [Level 2 — Stateful Agent Session](#level-2--stateful-agent-session)
5. [Level 3 — Multi-Agent Agency](#level-3--multi-agent-agency)
6. [First End-to-End Example](#first-end-to-end-example)
7. [What's Next](#whats-next)

---

## Installation

```bash
npm install @framers/agentos
```

TypeScript is strongly recommended. AgentOS ships full `.d.ts` types and expects
`"moduleResolution": "bundler"` or `"node16"` in your `tsconfig.json`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

---

## Environment Setup

Set at least one provider API key. AgentOS auto-detects the first key it finds:

```bash
# Cloud providers (pick one or more)
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
export OPENROUTER_API_KEY=sk-or-...

# Local providers (no key required, just a running server)
export OLLAMA_BASE_URL=http://localhost:11434
export STABLE_DIFFUSION_LOCAL_BASE_URL=http://localhost:7860
```

Provider resolution order when no `provider` or `model` is specified:
`OPENROUTER_API_KEY` → `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → `GEMINI_API_KEY` → `which claude` → `which gemini` → `OLLAMA_BASE_URL`

---

## Level 1 — Single Text Generation

One call, no state, no setup:

```typescript
import { generateText } from '@framers/agentos';

const { text } = await generateText({
  provider: 'openai',
  prompt: 'Explain the TCP three-way handshake in three bullet points.',
});

console.log(text);
```

Streaming version:

```typescript
import { streamText } from '@framers/agentos';

const stream = streamText({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  prompt: 'Write a haiku about distributed systems.',
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

---

## Level 2 — Stateful Agent Session

Three lines to create a multi-turn assistant that remembers context:

```typescript
import { agent } from '@framers/agentos';

const assistant = agent({
  provider: 'openai',
  instructions: 'You are a helpful coding assistant.',
});
const session = assistant.session('my-session');
const reply = await session.send('What is a closure in JavaScript?');

console.log(reply.text);

// Follow-up retains context:
const followUp = await session.send('Show me a practical example.');
console.log(followUp.text);
```

---

## Level 3 — Multi-Agent Agency

Five lines to orchestrate a team of specialized agents:

```typescript
import { agency } from '@framers/agentos';

const team = agency({
  provider: 'openai',
  strategy: 'sequential',
  agents: {
    researcher: { instructions: 'Find key facts about the topic.' },
    writer: { instructions: 'Synthesize the facts into a clear summary.' },
    reviewer: { instructions: 'Check for accuracy and suggest improvements.' },
  },
});

const result = await team.generate('Explain how large language models work.');
console.log(result.text);
```

---

## First End-to-End Example

This complete example uses tools, streaming, and a basic session:

```typescript
import { agent, generateText } from '@framers/agentos';

// ── Step 1: One-shot text generation ───────────────────────────────────────
const { text: summary } = await generateText({
  provider: 'openai',
  prompt: 'Summarise AgentOS in one sentence.',
});
console.log('Summary:', summary);

// ── Step 2: Stateful session with tool-enabled agent ───────────────────────
const coder = agent({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  instructions: 'You are an expert TypeScript developer.',
  maxSteps: 4,
});

const session = coder.session('quickstart');

const { text: explanation } = await session.send(
  'How do I debounce a function in TypeScript? Show a typed example.'
);
console.log('\nDebounce explanation:\n', explanation);

const { text: followUp } = await session.send('Now make it cancel-able with an AbortSignal.');
console.log('\nCancellable version:\n', followUp);

// ── Step 3: Check usage ─────────────────────────────────────────────────────
const usage = await session.usage();
console.log('\nUsage:', usage);
```

Run it:

```bash
npx tsx getting-started.ts
```

Expected output:

```
Summary: AgentOS is a modular orchestration runtime for adaptive AI agents.

Debounce explanation:
  function debounce<T extends (...args: unknown[]) => void>(
    fn: T, delay: number
  ): T { ... }

Cancellable version:
  function debounce<T extends (...args: unknown[]) => void>(
    fn: T, delay: number, signal?: AbortSignal
  ): T { ... }

Usage: { inputTokens: 312, outputTokens: 487, totalTokens: 799, estimatedCost: 0.00024 }
```

---

## What's Next

| Topic                                             | Guide                                        |
| ------------------------------------------------- | -------------------------------------------- |
| Graph pipelines, workflows, missions              | [ORCHESTRATION.md](./ORCHESTRATION.md)       |
| Deploy agents to 37 channels                      | [CHANNELS.md](./CHANNELS.md)                 |
| Publish to social platforms                       | [SOCIAL_POSTING.md](./SOCIAL_POSTING.md)     |
| Audit trails and tamper evidence                  | [PROVENANCE.md](./PROVENANCE.md)             |
| Episodic, semantic, procedural memory             | [COGNITIVE_MEMORY.md](./COGNITIVE_MEMORY.md) |
| Testing and benchmarking agents                   | [EVALUATION.md](./EVALUATION.md)             |
| Token-efficient capability discovery              | [DISCOVERY.md](./DISCOVERY.md)               |
| Image generation across 5 providers               | [IMAGE_GENERATION.md](./IMAGE_GENERATION.md) |
| Practical cookbook examples                       | [EXAMPLES.md](./EXAMPLES.md)                 |
| Runtime-configured tools and full `AgentOS` setup | [HIGH_LEVEL_API.md](./HIGH_LEVEL_API.md)     |
| Full API hierarchy                                | [AGENCY_API.md](./AGENCY_API.md)             |
| Architecture overview                             | [ARCHITECTURE.md](./ARCHITECTURE.md)         |
