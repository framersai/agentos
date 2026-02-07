<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="80" />
</a>

# AgentOS

**Modular orchestration runtime for adaptive AI agents**

[![npm version](https://img.shields.io/npm/v/@framers/agentos?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![CI](https://img.shields.io/github/actions/workflow/status/framersai/agentos/ci.yml?style=flat-square&logo=github&label=CI)](https://github.com/framersai/agentos/actions)
[![codecov](https://codecov.io/gh/framersai/agentos/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
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

### ◆ Adaptive Intelligence
- **GMI Architecture** — Persistent agent identities with working memory
- **Dynamic Personas** — Contextual personality adaptation
- **Multi-model Support** — OpenAI, Anthropic, local models

</td>
<td width="50%">

### ◆ Streaming-First Runtime
- **Token-level streaming** — Real-time response delivery
- **Async generators** — Native TypeScript patterns
- **WebSocket & SSE** — Multiple transport protocols

</td>
</tr>
<tr>
<td width="50%">

### ◆ Tool Orchestration
- **Permission management** — Fine-grained access control
- **Dynamic registration** — Runtime tool discovery
- **Guardrails** — Safety constraints and validation

</td>
<td width="50%">

### ◆ RAG & Memory
- **Vector storage** — Semantic memory retrieval
- **SQL adapters** — SQLite, PostgreSQL support
- **Context optimization** — Automatic window management

</td>
</tr>
<tr>
<td width="50%">

### ◆ Multi-Agent Coordination
- **Agency system** — Agent hierarchies and teams
- **Message bus** — Inter-agent communication
- **Handoffs** — Context transfer between agents

</td>
<td width="50%">

### ◆ Human-in-the-Loop
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
import { AgentOS, AgentOSResponseChunkType } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

// Initialize (local/dev defaults)
const agent = new AgentOS();
await agent.initialize(await createTestAgentOSConfig());

// Process requests with streaming
for await (const chunk of agent.processRequest({
  userId: 'user-123',
  sessionId: 'session-123',
  textInput: 'Help me analyze this data',
})) {
  if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) {
    process.stdout.write(chunk.textDelta);
  }
}
```

### With Tools (Extension Packs)

```typescript
import {
  AgentOS,
  AgentOSResponseChunkType,
  EXTENSION_KIND_TOOL,
  type ExtensionManifest,
  type ExtensionPack,
  type ITool,
} from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const helloTool: ITool = {
  id: 'hello-tool',
  name: 'hello',
  displayName: 'Hello',
  description: 'Return a greeting.',
  category: 'utility',
  hasSideEffects: false,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  execute: async (args, _ctx) => {
    const name = typeof args.name === 'string' ? args.name : String(args.name);
    return { success: true, output: { text: `Hello, ${name}!` } };
  },
};

const manifest: ExtensionManifest = {
  packs: [
    {
      factory: async () =>
        ({
          name: 'local-tools',
          descriptors: [{ id: helloTool.id, kind: EXTENSION_KIND_TOOL, payload: helloTool }],
        }) satisfies ExtensionPack,
    },
  ],
};

const agent = new AgentOS();
const base = await createTestAgentOSConfig();
await agent.initialize({ ...base, extensionManifest: manifest });

// Tools are called automatically when the model decides to use them
for await (const chunk of agent.processRequest({
  userId: 'user-123',
  sessionId: 'session-123',
  textInput: 'Say hello to Ada.',
})) {
  if (chunk.type === AgentOSResponseChunkType.TEXT_DELTA) process.stdout.write(chunk.textDelta);
}
```

### Multiple Providers

```typescript
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
const base = await createTestAgentOSConfig();

await agent.initialize({
  ...base,
  modelProviderManagerConfig: {
    providers: [
      { providerId: 'openai', enabled: true, isDefault: true, config: { apiKey: process.env.OPENAI_API_KEY } },
      { providerId: 'openrouter', enabled: true, config: { apiKey: process.env.OPENROUTER_API_KEY } },
      { providerId: 'ollama', enabled: true, config: { baseUrl: 'http://localhost:11434' } },
    ],
  },
  gmiManagerConfig: {
    ...base.gmiManagerConfig,
    defaultGMIBaseConfigDefaults: {
      ...(base.gmiManagerConfig.defaultGMIBaseConfigDefaults ?? {}),
      defaultLlmProviderId: 'openai',
      defaultLlmModelId: 'gpt-4o',
    },
  },
});
```

### RAG (RetrievalAugmentor)

AgentOS supports embedding-based retrieval via `IRetrievalAugmentor` (vector RAG, optional GraphRAG). You can either:

- pass a ready augmentor via `AgentOSConfig.retrievalAugmentor`, or
- let AgentOS initialize it via `AgentOSConfig.ragConfig`

See `docs/RAG_MEMORY_CONFIGURATION.md` for full setup details.

```ts
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agentos = new AgentOS();
const base = await createTestAgentOSConfig();
await agentos.initialize({
  ...base,
  ragConfig: {
    embeddingManagerConfig: {
      embeddingModels: [
        { modelId: 'text-embedding-3-small', providerId: 'openai', dimension: 1536, isDefault: true },
      ],
    },
    vectorStoreManagerConfig: {
      managerId: 'rag-vsm',
      providers: [{ id: 'sql-store', type: 'sql', storage: { filePath: './data/agentos_vectors.db' } }],
      defaultProviderId: 'sql-store',
      defaultEmbeddingDimension: 1536,
    },
    dataSourceConfigs: [
      {
        dataSourceId: 'voice_conversation_summaries',
        displayName: 'Conversation Summaries',
        vectorStoreProviderId: 'sql-store',
        actualNameInProvider: 'voice_conversation_summaries',
        embeddingDimension: 1536,
      },
    ],
    retrievalAugmentorConfig: {
      defaultDataSourceId: 'voice_conversation_summaries',
      categoryBehaviors: [],
    },
  },
});
```

### Immutability & Provenance (Optional)

AgentOS includes an optional provenance system that can:
- enforce storage immutability policies (`mutable`, `revisioned`, `sealed`)
- record a signed, tamper-evident event ledger
- optionally anchor Merkle roots to external systems (WORM, Rekor, OpenTimestamps, Ethereum, Solana)

```typescript
import { profiles } from '@framers/agentos/provenance';
import { createProvenancePack } from '@framers/agentos/extensions/packs/provenance-pack';

// Pick a profile:
// - mutableDev(): normal app semantics, no signing
// - revisionedVerified(): edits allowed, but revisions/tombstones are tracked + signed
// - sealedAutonomous(): append-only storage policy for protected tables + signed ledger
const provenanceConfig = profiles.sealedAutonomous();

const provenancePack = createProvenancePack(
  provenanceConfig,
  storageAdapter,
  'agent-001',   // signing identity
  'agentos_',    // optional table prefix
);

// Add the pack to your extension manifest, then initialize AgentOS.
```

**Key rotation:** keep tool API keys out of the immutable spec (env vars or a secret store). Rotate keys and restart without changing the agent identity/history.

**Sealed conversation persistence:** when using `sealed` storage policy with SQL conversation persistence, set `ConversationManagerConfig.appendOnlyPersistence=true` so conversation history remains append-only (no UPDATE/DELETE/UPSERT on protected tables).

**Toolset pinning (recommended):** treat the enabled toolset as part of the sealed spec. Disable dynamic tool registration and (optionally) store a toolset manifest hash at seal time so you can verify you’re running the same tools/versions later.

**“Forgetting” memory in sealed mode:** avoid hard deletes. Prefer append-only **redaction/tombstone** events that remove items from retrieval while keeping an auditable trail.

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

### Core Concepts

| Guide | Description |
|-------|-------------|
| [Architecture](./docs/ARCHITECTURE.md) | System design and component overview |
| [Guardrails](./docs/GUARDRAILS_USAGE.md) | Safety controls and mid-stream intervention |
| [Extensions](./docs/RFC_EXTENSION_STANDARDS.md) | Extension system and standards |
| [Ecosystem](./docs/ECOSYSTEM.md) | Related repos and packages |

### Messaging Channels

| Guide | Description |
|-------|-------------|
| [Channel Types](./src/channels/types.ts) | `ChannelPlatform`, `ChannelMessage`, `MessageContent`, `ChannelCapability` |
| [IChannelAdapter](./src/channels/IChannelAdapter.ts) | Adapter interface for external messaging platforms |
| [ChannelRouter](./src/channels/ChannelRouter.ts) | Inbound/outbound message routing |

AgentOS v0.1.3+ introduces `EXTENSION_KIND_MESSAGING_CHANNEL` for external human-facing messaging platforms. Channel extensions register an `IChannelAdapter` that handles bidirectional messaging:

```typescript
import type { IChannelAdapter, ChannelMessage, MessageContent } from '@framers/agentos';

// Channel adapters are registered via extension packs:
// { id: 'telegramChannel', kind: 'messaging-channel', payload: adapter }
```

Supported platforms: `telegram`, `whatsapp`, `discord`, `slack`, `webchat`, `signal`, `imessage`, `google_chat`, `teams`, `matrix`, `zalo`, `email`, `sms`.

### Agent Features

| Guide | Description |
|-------|-------------|
| [Planning Engine](./docs/PLANNING_ENGINE.md) | Multi-step task planning and execution |
| [Human-in-the-Loop](./docs/HUMAN_IN_THE_LOOP.md) | Approval workflows and oversight |
| [Agent Communication](./docs/AGENT_COMMUNICATION.md) | Inter-agent messaging patterns |
| [Self-Building Agents](./docs/RECURSIVE_SELF_BUILDING_AGENTS.md) | Recursive agent construction |
| [Structured Output](./docs/STRUCTURED_OUTPUT.md) | JSON schema validation |
| [Evaluation Framework](./docs/EVALUATION_FRAMEWORK.md) | Testing and quality assurance |

### Storage & Memory

| Guide | Description |
|-------|-------------|
| [RAG Configuration](./docs/RAG_MEMORY_CONFIGURATION.md) | Memory and retrieval setup |
| [SQL Storage](./docs/SQL_STORAGE_QUICKSTART.md) | SQLite/PostgreSQL setup |
| [Client-Side Storage](./docs/CLIENT_SIDE_STORAGE.md) | Browser storage options |

### Operations

| Guide | Description |
|-------|-------------|
| [Cost Optimization](./docs/COST_OPTIMIZATION.md) | Token usage and cost management |
| [Observability](./docs/OBSERVABILITY.md) | OpenTelemetry spans and trace/log correlation (opt-in) |
| [Platform Support](./docs/PLATFORM_SUPPORT.md) | Supported platforms and environments |
| [Releasing](./docs/RELEASING.md) | How to publish new versions |
| [API Reference](./docs/api/index.html) | TypeDoc-generated API docs |
---

## Examples

### Structured Data Extraction

```typescript
import { AgentOS, StructuredOutputManager } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' }
});

// Extract typed data from unstructured text
const structured = new StructuredOutputManager({ llmProviderManager: agent.llmProviderManager });
const contact = await structured.generate({
  prompt: 'Extract: "Meeting with Sarah Chen (sarah@startup.io) on Jan 15 re: Series A"',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      date: { type: 'string' },
      topic: { type: 'string' }
    },
    required: ['name', 'email']
  },
  schemaName: 'ContactInfo'
});
// → { name: 'Sarah Chen', email: 'sarah@startup.io', date: 'Jan 15', topic: 'Series A' }
```

### Human-in-the-Loop Approvals

```typescript
import { HumanInteractionManager } from '@framers/agentos';

const hitl = new HumanInteractionManager({ defaultTimeoutMs: 300000 });

// Gate high-risk operations with human approval
const decision = await hitl.requestApproval({
  action: {
    type: 'database_mutation',
    description: 'Archive 50K inactive accounts older than 2 years',
    severity: 'high',
    metadata: { affectedRows: 50000, table: 'users' }
  },
  alternatives: [
    { action: 'soft_delete', description: 'Mark as inactive instead of archiving' },
    { action: 'export_first', description: 'Export to CSV before archiving' }
  ]
});

if (decision.approved) {
  await executeArchive();
} else if (decision.selectedAlternative) {
  await executeAlternative(decision.selectedAlternative);
}
```

### Autonomous Task Planning

```typescript
import { AgentOS, PlanningEngine } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' }
});

const planner = new PlanningEngine({ llmProvider: agent.llmProviderManager, strategy: 'react' });

// Decompose complex goals into executable steps with ReAct reasoning
const plan = await planner.generatePlan({
  goal: 'Migrate authentication from sessions to JWT',
  constraints: ['Zero downtime', 'Backwards compatible for 30 days', 'Audit logging required'],
  context: { currentStack: 'Express + Redis sessions', userCount: '50K' }
});

for await (const step of planner.executePlan(plan.id)) {
  console.log(`[${step.status}] ${step.action}`);
  if (step.requiresHumanApproval) {
    const approved = await promptUser(step.description);
    if (!approved) break;
  }
}
```

### Multi-Agent Collaboration

```typescript
import { AgentOS, AgencyRegistry, AgentCommunicationBus } from '@framers/agentos';

// Create specialized agents
const researcher = new AgentOS();
await researcher.initialize({ llmProvider: llmConfig, persona: 'Research analyst' });

const writer = new AgentOS();
await writer.initialize({ llmProvider: llmConfig, persona: 'Technical writer' });

// Register in agency with shared communication
const agency = new AgencyRegistry();
const bus = new AgentCommunicationBus();
agency.register('researcher', researcher, { bus });
agency.register('writer', writer, { bus });

// Agents coordinate via message passing
bus.on('research:complete', async ({ findings }) => {
  await writer.processRequest({
    message: `Write documentation based on: ${JSON.stringify(findings)}`
  });
});

await researcher.processRequest({ message: 'Analyze the authentication module' });
```

### Guardrails: Mid-Stream Decision Override

```typescript
import { AgentOS } from '@framers/agentos';
import { CostCeilingGuardrail } from './guardrails/CostCeilingGuardrail';

const costGuard = new CostCeilingGuardrail({
  maxCostUsd: 0.05,  // 5 cents per request
  inputTokenPricePer1k: 0.0001,
  outputTokenPricePer1k: 0.0002,
  budgetExceededText: 'Response exceeded cost ceiling. Please refine your request.'
});

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  guardrailService: costGuard
});

// Agent generates expensive response → guardrail intercepts → substitutes budget message
// Agents can "change their mind" before delivery based on cost, content policy, or quality checks
```

See [Guardrails Usage Guide](./docs/GUARDRAILS_USAGE.md) for complete documentation.

### Non-Streaming Response

```typescript
import { AgentOS } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' }
});

// Collect full response without streaming
const chunks = [];
for await (const chunk of agent.processRequest({ message: 'Explain OAuth 2.0 briefly' })) {
  if (chunk.type === 'content') {
    chunks.push(chunk.content);
  }
}
const fullResponse = chunks.join('');
```

### Mood-Adaptive Responses

```typescript
import { AgentOS, GMIMood } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' },
  persona: {
    name: 'Support Agent',
    moodAdaptation: {
      enabled: true,
      defaultMood: GMIMood.EMPATHETIC,
      allowedMoods: [GMIMood.EMPATHETIC, GMIMood.FOCUSED, GMIMood.ANALYTICAL],
      sensitivityFactor: 0.7,
      // Mood-specific prompt modifiers
      moodPrompts: {
        [GMIMood.EMPATHETIC]: 'Prioritize understanding and emotional support.',
        [GMIMood.FRUSTRATED]: 'Acknowledge difficulty, offer step-by-step guidance.',
        [GMIMood.ANALYTICAL]: 'Provide detailed technical explanations with examples.'
      }
    }
  }
});

// Agent automatically adapts tone based on conversation context
for await (const chunk of agent.processRequest({
  message: 'This is so frustrating, nothing works!'
})) {
  // Response adapts with empathetic tone, mood shifts to EMPATHETIC
}
```

### Contextual Prompt Adaptation

```typescript
import { AgentOS } from '@framers/agentos';

const agent = new AgentOS();
await agent.initialize({
  llmProvider: llmConfig,
  persona: {
    name: 'Adaptive Tutor',
    // Dynamic prompt elements injected based on runtime context
    contextualPromptElements: [
      {
        id: 'beginner-guidance',
        type: 'SYSTEM_INSTRUCTION_ADDON',
        content: 'Explain concepts simply, avoid jargon, use analogies.',
        criteria: { userSkillLevel: ['novice', 'beginner'] },
        priority: 10
      },
      {
        id: 'expert-mode',
        type: 'SYSTEM_INSTRUCTION_ADDON',
        content: 'Assume deep technical knowledge, be concise, skip basics.',
        criteria: { userSkillLevel: ['expert', 'advanced'] },
        priority: 10
      },
      {
        id: 'debugging-context',
        type: 'FEW_SHOT_EXAMPLE',
        content: { role: 'assistant', content: 'Let\'s trace through step by step...' },
        criteria: { taskHint: ['debugging', 'troubleshooting'] }
      }
    ],
    // Meta-prompts for self-reflection and planning
    metaPrompts: [
      {
        id: 'mid-conversation-check',
        trigger: 'every_n_turns',
        triggerConfig: { n: 5 },
        prompt: 'Assess: Is the user making progress? Should I adjust my approach?'
      }
    ]
  }
});

// Prompts automatically adapt based on user context and task
await agent.updateUserContext({ skillLevel: 'expert' });
for await (const chunk of agent.processRequest({ message: 'Explain monads' })) {
  // Uses expert-mode prompt element, skips beginner explanations
}
```

---

## Roadmap

| Version | Status | Features |
|---------|--------|----------|
| 0.1 | ✓ | Core runtime, GMI, streaming, tools, RAG |
| 0.2 | → | Knowledge graphs, marketplace, visual planning |
| 0.3 | ○ | Distributed agents, edge deployment |
| 1.0 | ○ | Production hardening, enterprise features |

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## Contributing

We welcome contributions. See our [Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md) for details.

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

```
feat:  New features → minor version bump
fix:   Bug fixes → patch version bump
docs:  Documentation only
BREAKING CHANGE: → major version bump
```

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

[Website](https://agentos.sh) · [Documentation](https://agentos.sh/docs) · [Twitter](https://twitter.com/framersai)

</div>
