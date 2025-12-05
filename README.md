<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="80" />
</a>

# AgentOS

**Modular orchestration runtime for adaptive AI agents**

[![npm version](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/agentos-ci.yml?style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](https://opensource.org/licenses/Apache-2.0)

[Website](https://agentos.sh) · [Documentation](https://agentos.sh/docs) · [npm](https://www.npmjs.com/package/@framers/agentos) · [GitHub](https://github.com/framersai/agentos)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Documentation](#documentation)
- [Examples](#examples)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

AgentOS is a TypeScript-first orchestration runtime for building **adaptive, emergent AI agents**. Unlike traditional agent frameworks that treat agents as stateless functions, AgentOS introduces **Generalized Mind Instances (GMIs)** — context-aware entities that learn, evolve, and maintain coherent personalities across interactions.

```bash
npm install @framers/agentos
```

---

## Features

<table>
<tr>
<td width="50%">

### 🧠 Adaptive Intelligence
- **GMI Architecture** — Persistent agent identities with working memory
- **Dynamic Personas** — Contextual personality adaptation
- **Multi-model Support** — OpenAI, Anthropic, local models

</td>
<td width="50%">

### ⚡ Streaming-First Runtime
- **Token-level streaming** — Real-time response delivery
- **Async generators** — Native TypeScript patterns
- **WebSocket & SSE** — Multiple transport protocols

</td>
</tr>
<tr>
<td width="50%">

### 🔧 Tool Orchestration
- **Permission management** — Fine-grained access control
- **Dynamic registration** — Runtime tool discovery
- **Guardrails** — Safety constraints and validation

</td>
<td width="50%">

### 📚 RAG & Memory
- **Vector storage** — Semantic memory retrieval
- **SQL adapters** — SQLite, PostgreSQL support
- **Context optimization** — Automatic window management

</td>
</tr>
<tr>
<td width="50%">

### 🤝 Multi-Agent Coordination
- **Agency system** — Agent hierarchies and teams
- **Message bus** — Inter-agent communication
- **Handoffs** — Context transfer between agents

</td>
<td width="50%">

### 🛡️ Human-in-the-Loop
- **Approval workflows** — High-risk action gates
- **Clarification requests** — Ambiguity resolution
- **Escalation handling** — Human takeover paths

</td>
</tr>
</table>

---

## Installation

```bash
# npm
npm install @framers/agentos

# pnpm
pnpm add @framers/agentos

# yarn
yarn add @framers/agentos
```

**Requirements:** Node.js 18+ · TypeScript 5.0+

---

## Quick Start

```typescript
import { AgentOS } from '@framers/agentos';

// Initialize
const agent = new AgentOS();
await agent.initialize({
  llmProvider: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o'
  }
});

// Process requests with streaming
for await (const chunk of agent.processRequest({
  message: 'Help me analyze this data',
  context: { userId: 'user-123' }
})) {
  if (chunk.type === 'content') {
    process.stdout.write(chunk.content);
  }
}
```

### With Tools

```typescript
import { AgentOS, ToolDescriptor } from '@framers/agentos';

const searchTool: ToolDescriptor = {
  name: 'web_search',
  description: 'Search the web for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' }
    },
    required: ['query']
  },
  execute: async ({ query }) => {
    // Your search implementation
    return { results: await performSearch(query) };
  }
};

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { /* ... */ },
  tools: [searchTool]
});
```

### With Memory

```typescript
import { AgentOS, SqlStorageAdapter } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { /* ... */ },
  memory: {
    adapter: new SqlStorageAdapter({ dialect: 'sqlite', database: './agent.db' }),
    enableRAG: true,
    embeddingModel: 'text-embedding-3-small'
  }
});
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentOS Runtime                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Request   │  │   Prompt    │  │  Streaming  │              │
│  │   Router    │→ │   Engine    │→ │   Manager   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         ↓                ↓                ↓                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    GMI Manager                           │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │    │
│  │  │ Working │  │ Context │  │ Persona │  │Learning │    │    │
│  │  │ Memory  │  │ Manager │  │ Overlay │  │ Module  │    │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│         ↓                ↓                ↓                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    Tool     │  │    RAG      │  │  Planning   │              │
│  │Orchestrator │  │   Memory    │  │   Engine    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         ↓                ↓                ↓                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              LLM Provider Manager                        │    │
│  │     OpenAI  │  Anthropic  │  Azure  │  Local Models     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture](./docs/ARCHITECTURE.md) | System design and component overview |
| [Planning Engine](./docs/PLANNING_ENGINE.md) | Multi-step task planning and execution |
| [Human-in-the-Loop](./docs/HUMAN_IN_THE_LOOP.md) | Approval workflows and oversight |
| [Agent Communication](./docs/AGENT_COMMUNICATION.md) | Inter-agent messaging patterns |
| [RAG Configuration](./docs/RAG_MEMORY_CONFIGURATION.md) | Memory and retrieval setup |
| [Structured Output](./docs/STRUCTURED_OUTPUT.md) | JSON schema validation |
| [Evaluation Framework](./docs/EVALUATION_FRAMEWORK.md) | Testing and quality assurance |
| [API Reference](./docs/api/index.html) | TypeDoc-generated API docs |

---

## Examples

### Multi-Agent Agency

```typescript
import { AgentOS, Agency } from '@framers/agentos';

const researcher = new AgentOS({ persona: 'researcher' });
const writer = new AgentOS({ persona: 'writer' });
const editor = new AgentOS({ persona: 'editor' });

const agency = new Agency({
  agents: [researcher, writer, editor],
  workflow: 'sequential'
});

const result = await agency.execute({
  task: 'Write a blog post about AI agents',
  steps: ['research', 'draft', 'edit']
});
```

### Planning Engine

```typescript
import { AgentOS, PlanningEngine } from '@framers/agentos';

const agent = new AgentOS();
const planner = new PlanningEngine(agent);

const plan = await planner.createPlan({
  goal: 'Deploy a new feature to production',
  constraints: ['Must pass all tests', 'Requires approval']
});

for await (const step of planner.execute(plan)) {
  console.log(`Step ${step.index}: ${step.status}`);
}
```

---

## Roadmap

| Version | Features |
|---------|----------|
| **0.1** ✅ | Core runtime, GMI, streaming, tools, RAG |
| **0.2** | Knowledge graphs, marketplace, visual planning |
| **0.3** | Distributed agents, edge deployment |
| **1.0** | Production hardening, enterprise features |

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md) for details.

```bash
# Clone and setup
git clone https://github.com/framersai/agentos.git
cd agentos
pnpm install

# Development
pnpm run build    # Build the package
pnpm run test     # Run tests
pnpm run docs     # Generate documentation
```

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New features → minor version bump
- `fix:` Bug fixes → patch version bump
- `docs:` Documentation only
- `BREAKING CHANGE:` → major version bump

---

## License

[Apache 2.0](./LICENSE) © [Framers](https://frame.dev)

---

<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="40" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://frame.dev">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/logos/frame-logo.svg" alt="Frame.dev" height="40" />
</a>

**Built by [Frame.dev](https://frame.dev)** · [@framersai](https://github.com/framersai)

[Website](https://agentos.sh) · [Documentation](https://agentos.sh/docs) · [Twitter](https://twitter.com/framersai) · [Discord](https://discord.gg/framersai)

</div>
