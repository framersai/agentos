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

[Website](https://agentos.sh) · [Documentation](https://docs.agentos.sh) · [npm](https://www.npmjs.com/package/@framers/agentos) · [GitHub](https://github.com/framersai/agentos)

</div>

---

## Quick Start

```bash
npm install @framers/agentos
```

**Requirements:** Node.js 18+ · TypeScript 5.0+

### Streaming Chat

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

### Adding Tools

Tools are registered via extension packs and called automatically by the model:

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

const weatherTool: ITool = {
  id: 'get-weather',
  name: 'get_weather',
  displayName: 'Get Weather',
  description: 'Returns current weather for a city.',
  category: 'utility',
  hasSideEffects: false,
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
  execute: async (args) => ({
    success: true,
    output: { text: `Weather in ${args.city}: 22°C, partly cloudy` },
  }),
};

const manifest: ExtensionManifest = {
  packs: [{
    factory: async () => ({
      name: 'my-tools',
      descriptors: [{ id: weatherTool.id, kind: EXTENSION_KIND_TOOL, payload: weatherTool }],
    } satisfies ExtensionPack),
  }],
};

const agent = new AgentOS();
const config = await createTestAgentOSConfig();
await agent.initialize({ ...config, extensionManifest: manifest });

for await (const chunk of agent.processRequest({
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'What is the weather in Tokyo?',
})) {
  switch (chunk.type) {
    case AgentOSResponseChunkType.TEXT_DELTA:
      process.stdout.write(chunk.textDelta);
      break;
    case AgentOSResponseChunkType.TOOL_CALL_REQUEST:
      console.log('Tool calls:', chunk.toolCalls);
      break;
    case AgentOSResponseChunkType.TOOL_RESULT_EMISSION:
      console.log('Tool result:', chunk.toolResult);
      break;
  }
}
```

---

## Features

### LLM Providers
- **Multi-provider** — OpenAI, Anthropic, Azure, Google, Ollama, OpenRouter, and more
- **Model switching** — Change providers/models per request via `ProcessingOptions`
- **Streaming-first** — Token-level async generator responses with backpressure

### Tools & Extensions
- **Extension packs** — Register tools, guardrails, workflows, personas, and channel adapters
- **12 extension kinds** — `tool`, `guardrail`, `workflow`, `persona`, `messaging-channel`, `planning-strategy`, `hitl-handler`, `memory-provider`, and more
- **Permission management** — Fine-grained tool access control per user/role
- **Dynamic registration** — Add/remove tools at runtime

### Agent Intelligence
- **Persistent agents (GMIs)** — Working memory, persona adaptation, learning across sessions
- **Contextual prompting** — Dynamic prompt elements selected by user context and task
- **Mood adaptation** — Tone shifts based on conversation sentiment

### Planning & Human-in-the-Loop
- **Task planning** — Multi-step plan generation with ReAct reasoning
- **Approval workflows** — Gate high-risk actions with human review
- **Clarification requests** — Agents ask for missing information
- **Escalation** — Automatic handoff to human operators

### Multi-Agent Coordination
- **Agency registry** — Register and manage agent teams
- **Communication bus** — Inter-agent message passing and handoffs
- **Shared memory** — Agency-level memory with vector search

### Memory & RAG
- **Vector retrieval** — Embedding-based semantic search (SQL-backed)
- **Conversation persistence** — Rolling summaries and long-term memory
- **Multiple data sources** — Configure separate vector stores per domain

### Safety & Guardrails
- **Input/output guardrails** — Block, modify, or escalate based on content
- **Cost ceiling** — Per-request token budget enforcement
- **Cross-agent guardrails** — Monitor agent-to-agent interactions
- **Circuit breaker** — Automatic backoff on provider failures

### Structured Output
- **JSON schema validation** — Extract typed data from unstructured text
- **Parallel function calls** — Multiple tool invocations in one turn
- **Entity extraction** — Named entity recognition with schema constraints

### Messaging Channels
- **13+ platforms** — Telegram, WhatsApp, Discord, Slack, Signal, Teams, Matrix, and more
- **Bidirectional adapters** — Unified `IChannelAdapter` interface for all platforms
- **Channel routing** — Inbound/outbound message routing with `ChannelRouter`

### Operations
- **OpenTelemetry** — Opt-in tracing, metrics, and structured logging
- **Provenance** — Optional immutability policies, signed event ledger, external anchoring
- **Cost tracking** — Token usage monitoring and optimization

---

## Configuration

### Development (Quick Start)

`createTestAgentOSConfig()` provides sensible defaults for local development:

```typescript
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
await agent.initialize(await createTestAgentOSConfig());
```

### Production

`createAgentOSConfig()` reads from environment variables:

```bash
# Required
DATABASE_URL=file:./data/agentos.db

# LLM Providers (at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OLLAMA_BASE_URL=http://localhost:11434
```

```typescript
import { AgentOS } from '@framers/agentos';
import { createAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
await agent.initialize(await createAgentOSConfig());
```

### Multiple Providers

Configure multiple LLM providers with fallback:

```typescript
const agent = new AgentOS();
const config = await createTestAgentOSConfig();

await agent.initialize({
  ...config,
  modelProviderManagerConfig: {
    providers: [
      { providerId: 'openai', enabled: true, isDefault: true, config: { apiKey: process.env.OPENAI_API_KEY } },
      { providerId: 'anthropic', enabled: true, config: { apiKey: process.env.ANTHROPIC_API_KEY } },
      { providerId: 'ollama', enabled: true, config: { baseUrl: 'http://localhost:11434' } },
    ],
  },
  gmiManagerConfig: {
    ...config.gmiManagerConfig,
    defaultGMIBaseConfigDefaults: {
      ...(config.gmiManagerConfig.defaultGMIBaseConfigDefaults ?? {}),
      defaultLlmProviderId: 'openai',
      defaultLlmModelId: 'gpt-4o',
    },
  },
});

// Override per request:
for await (const chunk of agent.processRequest({
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'Hello',
  options: { preferredProviderId: 'anthropic', preferredModelId: 'claude-sonnet-4-5-20250929' },
})) { /* ... */ }
```

---

## Examples

### Multi-Agent Collaboration

```typescript
import { AgentOS, AgencyRegistry, AgentCommunicationBus } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const config = await createTestAgentOSConfig();

const researcher = new AgentOS();
await researcher.initialize(config);

const writer = new AgentOS();
await writer.initialize(config);

const agency = new AgencyRegistry();
const bus = new AgentCommunicationBus();
agency.register('researcher', researcher, { bus });
agency.register('writer', writer, { bus });

// Agents coordinate via message passing
bus.on('research:complete', async ({ findings }) => {
  for await (const chunk of writer.processRequest({
    userId: 'system',
    sessionId: 'collab-1',
    textInput: `Write documentation based on: ${JSON.stringify(findings)}`,
  })) { /* handle chunks */ }
});

for await (const chunk of researcher.processRequest({
  userId: 'system',
  sessionId: 'collab-1',
  textInput: 'Analyze the authentication module',
})) { /* handle chunks */ }
```

### Human-in-the-Loop Approvals

```typescript
import { HumanInteractionManager } from '@framers/agentos';

const hitl = new HumanInteractionManager({ defaultTimeoutMs: 300_000 });

const decision = await hitl.requestApproval({
  action: {
    type: 'database_mutation',
    description: 'Archive 50K inactive accounts older than 2 years',
    severity: 'high',
    metadata: { affectedRows: 50_000, table: 'users' },
  },
  alternatives: [
    { action: 'soft_delete', description: 'Mark as inactive instead' },
    { action: 'export_first', description: 'Export to CSV before archiving' },
  ],
});

if (decision.approved) {
  await executeArchive();
} else if (decision.selectedAlternative) {
  await executeAlternative(decision.selectedAlternative);
}
```

### Structured Data Extraction

```typescript
import { AgentOS, StructuredOutputManager } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
await agent.initialize(await createTestAgentOSConfig());

const structured = new StructuredOutputManager({
  llmProviderManager: agent.llmProviderManager,
});

const contact = await structured.generate({
  prompt: 'Extract: "Meeting with Sarah Chen (sarah@startup.io) on Jan 15 re: Series A"',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      date: { type: 'string' },
      topic: { type: 'string' },
    },
    required: ['name', 'email'],
  },
  schemaName: 'ContactInfo',
});
// → { name: 'Sarah Chen', email: 'sarah@startup.io', date: 'Jan 15', topic: 'Series A' }
```

### RAG Memory

```typescript
import { AgentOS } from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const agent = new AgentOS();
const config = await createTestAgentOSConfig();

await agent.initialize({
  ...config,
  ragConfig: {
    embeddingManagerConfig: {
      embeddingModels: [
        { modelId: 'text-embedding-3-small', providerId: 'openai', dimension: 1536, isDefault: true },
      ],
    },
    vectorStoreManagerConfig: {
      managerId: 'rag-vsm',
      providers: [{ id: 'sql-store', type: 'sql', storage: { filePath: './data/vectors.db' } }],
      defaultProviderId: 'sql-store',
      defaultEmbeddingDimension: 1536,
    },
    dataSourceConfigs: [{
      dataSourceId: 'conversations',
      displayName: 'Conversation Memory',
      vectorStoreProviderId: 'sql-store',
      actualNameInProvider: 'conversations',
      embeddingDimension: 1536,
    }],
    retrievalAugmentorConfig: {
      defaultDataSourceId: 'conversations',
      categoryBehaviors: [],
    },
  },
});

// Agent now retrieves relevant context from vector memory before responding
```

### Guardrails

```typescript
import {
  AgentOS,
  type IGuardrailService,
  type GuardrailContext,
  GuardrailAction,
} from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

// Guardrails intercept responses before delivery
const costGuard: IGuardrailService = {
  async evaluateOutput(context: GuardrailContext) {
    const tokens = context.usage?.totalTokens ?? 0;
    if (tokens > 10_000) {
      return {
        action: GuardrailAction.MODIFY,
        modifiedContent: 'Response exceeded token budget. Please ask a more specific question.',
        reason: `Token count ${tokens} exceeds limit`,
      };
    }
    return { action: GuardrailAction.ALLOW };
  },
};

const agent = new AgentOS();
const config = await createTestAgentOSConfig();
await agent.initialize({ ...config, guardrailService: costGuard });
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentOS Runtime                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Request    │  │   Prompt    │  │  Streaming   │            │
│  │   Router     │→ │   Engine    │→ │   Manager    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         ↓                ↓                ↓                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    GMI Manager                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │   │
│  │  │ Working  │  │ Context │  │ Persona │  │Learning │   │   │
│  │  │ Memory   │  │ Manager │  │ Overlay │  │ Module  │   │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│         ↓                ↓                ↓                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │    Tool      │  │    RAG      │  │  Planning    │            │
│  │Orchestrator  │  │   Memory    │  │   Engine     │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│         ↓                ↓                ↓                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              LLM Provider Manager                       │   │
│  │     OpenAI  │  Anthropic  │  Azure  │  Ollama  │  ...   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Documentation

Full documentation at **[docs.agentos.sh](https://docs.agentos.sh)**

| Topic | Description |
|-------|-------------|
| [System Architecture](https://docs.agentos.sh/docs/architecture/system-architecture) | Core design and component internals |
| [Planning Engine](https://docs.agentos.sh/docs/features/planning-engine) | Multi-step task planning and execution |
| [Human-in-the-Loop](https://docs.agentos.sh/docs/features/human-in-the-loop) | Approval workflows and oversight |
| [Guardrails](https://docs.agentos.sh/docs/features/guardrails) | Safety constraints and content filtering |
| [RAG Memory](https://docs.agentos.sh/docs/features/rag-memory) | Vector storage and retrieval configuration |
| [Extensions](https://docs.agentos.sh/docs/extensions/overview) | Extension system, official extensions catalog |
| [Structured Output](https://docs.agentos.sh/docs/features/structured-output) | JSON schema validation and entity extraction |
| [Agent Communication](https://docs.agentos.sh/docs/features/agent-communication) | Inter-agent messaging and handoffs |
| [Observability](https://docs.agentos.sh/docs/architecture/observability) | OpenTelemetry traces, metrics, and logging |
| [Cost Optimization](https://docs.agentos.sh/docs/features/cost-optimization) | Token usage monitoring and caching |
| [API Reference](https://docs.agentos.sh/docs/api/) | Auto-generated TypeDoc API docs |

---

## Contributing

```bash
git clone https://github.com/framersai/agentos.git
cd agentos
pnpm install
pnpm run build
pnpm run test
```

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:` (minor), `fix:` (patch), `BREAKING CHANGE:` (major).

See the [Contributing Guide](https://github.com/framersai/agentos/blob/master/CONTRIBUTING.md) for details.

---

## License

[Apache 2.0](./LICENSE) — [Frame.dev](https://frame.dev)

<div align="center">

<a href="https://agentos.sh">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/agentos-primary-transparent-2x.png" alt="AgentOS" height="40" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://frame.dev">
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/logos/frame-logo.svg" alt="Frame.dev" height="40" />
</a>

**Built by [Frame.dev](https://frame.dev)** · [@framersai](https://github.com/framersai)

</div>
