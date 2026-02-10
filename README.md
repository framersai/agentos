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

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [System Architecture](#system-architecture)
  - [Architecture Diagram](#architecture-diagram)
  - [Request Lifecycle](#request-lifecycle)
  - [Layer Breakdown](#layer-breakdown)
- [Core Modules](#core-modules)
  - [API Layer](#api-layer)
  - [Cognitive Substrate (GMI)](#cognitive-substrate-gmi)
  - [LLM Provider Management](#llm-provider-management)
  - [Tool System](#tool-system)
  - [Extension System](#extension-system)
  - [Planning Engine](#planning-engine)
  - [Conversation Management](#conversation-management)
  - [RAG (Retrieval Augmented Generation)](#rag-retrieval-augmented-generation)
  - [Safety and Guardrails](#safety-and-guardrails)
  - [Human-in-the-Loop (HITL)](#human-in-the-loop-hitl)
  - [Channels System](#channels-system)
  - [Voice and Telephony](#voice-and-telephony)
  - [Workflows](#workflows)
  - [Multi-Agent Coordination](#multi-agent-coordination)
  - [Observability](#observability)
  - [Skills](#skills)
  - [Structured Output](#structured-output)
- [Configuration](#configuration)
  - [Development (Quick Start)](#development-quick-start)
  - [Production](#production)
  - [Multiple Providers](#multiple-providers)
  - [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
  - [AgentOS Class](#agentos-class)
  - [IAgentOS Interface](#iagentos-interface)
  - [AgentOSInput](#agentosinput)
  - [AgentOSResponse Streaming](#agentosresponse-streaming)
  - [ITool Interface](#itool-interface)
  - [ExtensionDescriptor](#extensiondescriptor)
  - [IGuardrailService](#iguardrailservice)
  - [IHumanInteractionManager](#ihumaninteractionmanager)
- [Usage Examples](#usage-examples)
  - [Streaming Chat](#streaming-chat)
  - [Adding Tools](#adding-tools)
  - [Multi-Agent Collaboration](#multi-agent-collaboration)
  - [Human-in-the-Loop Approvals](#human-in-the-loop-approvals)
  - [Structured Data Extraction](#structured-data-extraction)
  - [RAG Memory](#rag-memory)
  - [Custom Guardrails](#custom-guardrails)
  - [Channel Adapters](#channel-adapters)
  - [Voice Calls](#voice-calls)
- [Package Exports](#package-exports)
- [Internal Documentation](#internal-documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

`@framers/agentos` is a TypeScript-first AI agent orchestration library that provides a complete runtime for building, deploying, and managing adaptive AI agents. It handles the full lifecycle from prompt construction through tool execution, safety evaluation, and streaming response delivery.

**Key facts:**

| Property | Value |
|----------|-------|
| Package | `@framers/agentos` |
| Version | `0.1.21` |
| Language | TypeScript 5.4+ / Node.js 18+ |
| Source files | 260+ TypeScript files across 25 top-level directories |
| Export paths | 112 package.json export entries |
| License | Apache 2.0 |

**Runtime dependencies:**

| Dependency | Purpose |
|------------|---------|
| `@opentelemetry/api` | Distributed tracing and metrics |
| `ajv` + `ajv-formats` | JSON Schema validation for tool I/O |
| `axios` | HTTP client for LLM provider APIs |
| `lru-cache` | High-performance caching (dedup, embeddings, cost tracking) |
| `natural` | NLP utilities (tokenization, stemming, sentiment) |
| `pino` | Structured JSON logging |
| `uuid` | Unique identifier generation |
| `yaml` | YAML config parsing (agent configs, skill definitions) |

**Optional peer dependencies:**

| Peer Dependency | Purpose |
|-----------------|---------|
| `@framers/sql-storage-adapter` | SQL-backed vector store and persistence |
| `graphology` + `graphology-communities-louvain` | GraphRAG community detection |
| `hnswlib-node` | HNSW-based approximate nearest neighbor search |

---

## Quick Start

```bash
npm install @framers/agentos
```

**Requirements:** Node.js 18+ and TypeScript 5.0+

### Minimal Example

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

## System Architecture

### Architecture Diagram

```
+===================================================================+
|                       AgentOS Runtime                              |
+===================================================================+
|                                                                    |
|  +---------------------+     +----------------------+              |
|  |    AgentOS (API)    |---->| AgentOSOrchestrator  |              |
|  |  (Service Facade)   |     |  (Delegation Hub)    |              |
|  +---------------------+     +----------+-----------+              |
|           |                              |                         |
|           v                              v                         |
|  +------------------+          +-------------------+               |
|  | StreamingManager |          |   PromptEngine    |               |
|  | (Async Gen Mgmt) |          | (Dynamic Prompts) |               |
|  +------------------+          +-------------------+               |
|           |                              |                         |
|           +----------+-------------------+                         |
|                      |                                             |
|                      v                                             |
|  +=========================================================+      |
|  |                  GMI Manager                             |      |
|  |  (Generalized Modular Intelligence Lifecycle)            |      |
|  |                                                          |      |
|  |  +-----------+  +-----------+  +-----------+  +-------+  |      |
|  |  | Working   |  |  Context  |  |  Persona  |  |Learning| |      |
|  |  | Memory    |  |  Manager  |  |  Overlay  |  | Module | |      |
|  |  +-----------+  +-----------+  +-----------+  +-------+  |      |
|  |                                                          |      |
|  |  +-----------+  +-----------+  +-----------+             |      |
|  |  | Episodic  |  | Semantic  |  |Procedural |             |      |
|  |  | Memory    |  |  Memory   |  |  Memory   |             |      |
|  |  +-----------+  +-----------+  +-----------+             |      |
|  +=========================================================+      |
|           |              |              |                          |
|           v              v              v                          |
|  +--------------+  +----------+  +--------------+  +-----------+  |
|  |    Tool      |  |   RAG    |  |   Planning   |  | Workflow  |  |
|  | Orchestrator |  |  Memory  |  |    Engine     |  |  Engine   |  |
|  +--------------+  +----------+  +--------------+  +-----------+  |
|      |    |             |              |                           |
|      |    |             v              v                           |
|      |    |       +-----------+  +-----------+                    |
|      |    |       | Embedding |  |   ReAct    |                   |
|      |    |       |  Manager  |  |  Reasoner  |                   |
|      |    |       +-----------+  +-----------+                    |
|      |    |             |                                          |
|      v    v             v                                          |
|  +=========================================================+      |
|  |            LLM Provider Manager                          |      |
|  |                                                          |      |
|  |   +--------+ +----------+ +-------+ +--------+ +------+ |      |
|  |   | OpenAI | |Anthropic | | Azure | | Ollama | |OpenR.| |      |
|  |   +--------+ +----------+ +-------+ +--------+ +------+ |      |
|  +=========================================================+      |
|                                                                    |
|  +---------+  +----------+  +----------+  +-----------+            |
|  |Guardrail|  | Circuit  |  |   Cost   |  |   Stuck   |           |
|  | Service |  | Breaker  |  |  Guard   |  | Detector  |           |
|  +---------+  +----------+  +----------+  +-----------+            |
|                                                                    |
|  +-------------------+  +-------------------+  +----------------+  |
|  | Extension Manager |  | Channel Router    |  | Call Manager   |  |
|  | (12+ kinds)       |  | (20 platforms)    |  | (Voice/Tel.)   |  |
|  +-------------------+  +-------------------+  +----------------+  |
|                                                                    |
|  +-------------------+  +-------------------+  +----------------+  |
|  |  Observability    |  |   HITL Manager    |  | Skill Registry |  |
|  |  (OpenTelemetry)  |  | (Approval/Escal.) |  | (SKILL.md)     |  |
|  +-------------------+  +-------------------+  +----------------+  |
|                                                                    |
+====================================================================+
```

### Request Lifecycle

A single `processRequest()` call flows through these stages:

```
User Input (AgentOSInput)
    |
    v
[1] Input Guardrails ---- evaluateInput() ----> BLOCK / SANITIZE / ALLOW
    |
    v
[2] Context Assembly ----- ConversationManager + RAG retrieval
    |
    v
[3] Prompt Construction -- PromptEngine builds system + contextual elements
    |
    v
[4] GMI Processing ------- Working memory, persona overlay, adaptation
    |
    v
[5] LLM Call ------------- AIModelProviderManager dispatches to provider
    |                      (with circuit breaker + cost guard)
    v
[6] Tool Execution? ------ ToolOrchestrator validates, executes, loops back to [5]
    |                      (with ToolExecutionGuard + permission checks)
    v
[7] Output Guardrails ---- evaluateOutput() ----> BLOCK / SANITIZE / ALLOW
    |
    v
[8] Streaming Response --- AsyncGenerator<AgentOSResponse> yields chunks
    |
    v
[9] Post-Processing ------ Memory persistence, cost aggregation, telemetry
```

### Layer Breakdown

AgentOS is organized into six architectural layers:

| Layer | Directory | Purpose |
|-------|-----------|---------|
| **API** | `src/api/` | Public-facing facade, input/output types, orchestrator |
| **Cognitive** | `src/cognitive_substrate/` | GMI instances, persona overlays, multi-layer memory |
| **Core** | `src/core/` | 28 subdirectories: LLM, tools, safety, guardrails, planning, workflows, HITL, observability, etc. |
| **Integration** | `src/channels/`, `src/voice/`, `src/extensions/` | External platform adapters, telephony, plugin system |
| **Intelligence** | `src/rag/`, `src/skills/` | RAG pipeline, GraphRAG, skill loading |
| **Infrastructure** | `src/config/`, `src/logging/`, `src/utils/`, `src/types/` | Configuration, structured logging, shared utilities |

---

## Core Modules

### API Layer

**Location:** `src/api/`

The API layer is the primary entry point for all interactions with AgentOS.

| File | Role |
|------|------|
| `AgentOS.ts` | Main service facade (1000+ lines). Implements `IAgentOS`. Initializes all subsystems and delegates to the orchestrator. |
| `AgentOSOrchestrator.ts` | Delegation hub. Coordinates GMI processing, tool execution, guardrail evaluation, and streaming assembly. Streaming-first design using async generators. |
| `interfaces/IAgentOS.ts` | Core contract defining `initialize()`, `processRequest()`, `handleToolResult()`, workflow management, persona listing, and conversation history retrieval. |
| `types/AgentOSInput.ts` | Unified input structure: text, vision, audio, persona selection, user API keys, feedback, workflow/agency invocations, and processing options. |
| `types/AgentOSResponse.ts` | Streaming output: 11 chunk types covering text deltas, tool calls, progress, errors, workflows, agency updates, and provenance events. |

**Response chunk types:**

```typescript
enum AgentOSResponseChunkType {
  TEXT_DELTA           // Incremental text tokens
  SYSTEM_PROGRESS      // Internal processing updates
  TOOL_CALL_REQUEST    // Agent requests tool execution
  TOOL_RESULT_EMISSION // Tool execution result
  UI_COMMAND           // Client-side UI directives
  FINAL_RESPONSE       // Aggregated final response
  ERROR                // Error information
  METADATA_UPDATE      // Session/context metadata changes
  WORKFLOW_UPDATE      // Workflow progress notifications
  AGENCY_UPDATE        // Multi-agent coordination events
  PROVENANCE_EVENT     // Immutability/audit trail events
}
```

---

### Cognitive Substrate (GMI)

**Location:** `src/cognitive_substrate/`

The Generalized Modular Intelligence (GMI) is the core agent instance -- the "brain" of each agent. A single AgentOS runtime can manage multiple GMI instances via `GMIManager`.

```
+================================================================+
|                         GMI Instance                            |
|                                                                 |
|  +-------------------+     +----------------------------+       |
|  | PersonaOverlay    |     |       Context Manager      |       |
|  | Manager           |     | (Dynamic prompt elements,  |       |
|  | (Personality      |     |  user context, session)    |       |
|  |  switching)       |     +----------------------------+       |
|  +-------------------+                                          |
|                                                                 |
|  +-------------------+     +----------------------------+       |
|  | Working Memory    |     |    Adaptation Manager      |       |
|  | (Current session  |     | (Learning rate, style      |       |
|  |  state, tool ctx) |     |  drift, tone adaptation)   |       |
|  +-------------------+     +----------------------------+       |
|                                                                 |
|  +-----------------------------------------------------------+ |
|  |                  Multi-Layer Memory                        | |
|  |  +----------+  +----------+  +-----------+  +-----------+ | |
|  |  | Episodic |  | Semantic |  | Procedural|  | Long-Term | | |
|  |  | (Events) |  | (Facts)  |  | (Skills)  |  | (Archive) | | |
|  |  +----------+  +----------+  +-----------+  +-----------+ | |
|  +-----------------------------------------------------------+ |
+================================================================+
```

**Key components:**

- **GMI.ts** -- Core agent instance (2000+ lines). Manages the complete cognitive loop: context assembly, prompt construction, LLM invocation, tool handling, and response generation.
- **GMIManager.ts** -- Lifecycle manager for multiple GMI instances. Handles creation, pooling, configuration, and teardown.
- **IGMI.ts** -- Interface contract for GMI implementations.
- **PersonaOverlayManager** -- Enables dynamic personality switching at runtime. Ships with 5+ built-in personas:
  - `Researcher` -- Analytical, citation-heavy responses
  - `Generalist` -- Balanced, conversational
  - `Atlas` -- Navigation and spatial reasoning
  - `Default Assistant` -- General-purpose helpful assistant
- **Memory subsystem** (`memory/`) -- Four-layer memory architecture:
  - **Working memory** -- Current session state, active tool context, conversation buffer
  - **Episodic memory** -- Timestamped events and interactions
  - **Semantic memory** -- Extracted facts, entity relationships, domain knowledge
  - **Procedural memory** -- Learned skills, patterns, and execution strategies

---

### LLM Provider Management

**Location:** `src/core/llm/`

The LLM layer abstracts multiple AI model providers behind a unified interface.

```
+-----------------------------------------------------------+
|              AIModelProviderManager                         |
|  (Provider registry, routing, fallback, model switching)   |
+-----------------------------------------------------------+
        |              |              |              |
        v              v              v              v
+----------+   +----------+   +----------+   +----------+
|  OpenAI  |   |  Ollama  |   | OpenRouter|  | (Custom) |
| Provider |   | Provider |   | Provider  |  | Provider |
+----------+   +----------+   +----------+   +----------+
    |                |              |
    v                v              v
 gpt-4o         llama3.2      claude-3.5
 gpt-4o-mini    mistral       gemini-pro
 o1-preview     codellama     command-r+
```

**Provider implementations:**

| Provider | File | Models |
|----------|------|--------|
| OpenAI | `providers/implementations/OpenAIProvider.ts` | GPT-4o, GPT-4o-mini, o1, o3, etc. |
| Ollama | `providers/implementations/OllamaProvider.ts` | Any locally-hosted model (Llama, Mistral, etc.) |
| OpenRouter | `providers/implementations/OpenRouterProvider.ts` | 100+ models from any provider via unified API |

**Additional components:**

- **PromptEngine** (`PromptEngine.ts`) -- Constructs prompts from system instructions, contextual elements, persona definitions, and dynamic user context. Supports template interpolation and conditional element inclusion.
- **IProvider** (`providers/IProvider.ts`) -- Interface contract for adding custom LLM providers.
- **Streaming adapters** -- All providers support token-level streaming via async generators with backpressure control.

**Per-request model override:**

```typescript
for await (const chunk of agent.processRequest({
  userId: 'user-1',
  sessionId: 'session-1',
  textInput: 'Summarize this document',
  options: {
    preferredProviderId: 'anthropic',
    preferredModelId: 'claude-sonnet-4-5-20250929',
  },
})) { /* ... */ }
```

---

### Tool System

**Location:** `src/core/tools/`

Tools are the primary mechanism for agents to interact with the outside world. Every tool implements the `ITool` interface.

```
+-----------------------------------------------------------+
|                    ToolOrchestrator                         |
|  (Discovery, selection, validation, execution pipeline)    |
+-----------------------------------------------------------+
        |                |                |
        v                v                v
+---------------+ +---------------+ +-------------------+
| ToolExecutor  | | ToolPermission| | ToolExecution     |
| (Validation,  | | Manager       | | Guard             |
|  invocation,  | | (RBAC, per-   | | (Timeout 30s,     |
|  result wrap) | |  user access) | |  circuit breaker)  |
+---------------+ +---------------+ +-------------------+
```

**ITool interface (abbreviated):**

```typescript
interface ITool<TInput = any, TOutput = any> {
  readonly id: string;              // Globally unique identifier
  readonly name: string;            // LLM-facing function name
  readonly displayName: string;     // Human-readable title
  readonly description: string;     // Natural language description for LLM
  readonly inputSchema: JSONSchemaObject;   // JSON Schema for input validation
  readonly outputSchema?: JSONSchemaObject; // JSON Schema for output validation
  readonly category?: string;       // Grouping (e.g., "data_analysis")
  readonly hasSideEffects: boolean; // Whether the tool modifies external state
  readonly requiredCapabilities?: string[]; // Persona capabilities needed

  execute(
    args: TInput,
    context?: ToolExecutionContext
  ): Promise<ToolExecutionResult<TOutput>>;
}
```

**ToolExecutionResult:**

```typescript
interface ToolExecutionResult<TOutput = any> {
  success: boolean;
  output?: TOutput;
  error?: string;
  contentType?: string;  // MIME type (default: "application/json")
  details?: Record<string, any>;
}
```

**ToolExecutionContext** provides the tool with calling agent identity (`gmiId`, `personaId`), user context, correlation ID for tracing, and optional session data.

---

### Extension System

**Location:** `src/extensions/`

The extension system is AgentOS's plugin architecture. Extensions are packaged as **packs** containing one or more **descriptors**, loaded via a **manifest**.

```
ExtensionManifest
    |
    +-- ExtensionPackManifestEntry[]
            |
            +-- ExtensionPack (resolved via factory/module/package)
                    |
                    +-- ExtensionDescriptor[] (id + kind + payload)
                            |
                            +-- Registered in ExtensionRegistry
                                    |
                                    +-- Consumed by runtime (ToolOrchestrator,
                                        GuardrailService, WorkflowEngine, etc.)
```

**12 extension kinds:**

| Kind Constant | Value | Payload Type |
|---------------|-------|--------------|
| `EXTENSION_KIND_TOOL` | `"tool"` | `ITool` |
| `EXTENSION_KIND_GUARDRAIL` | `"guardrail"` | `IGuardrailService` |
| `EXTENSION_KIND_RESPONSE_PROCESSOR` | `"response-processor"` | Response transform function |
| `EXTENSION_KIND_WORKFLOW` | `"workflow"` | `WorkflowDescriptorPayload` |
| `EXTENSION_KIND_WORKFLOW_EXECUTOR` | `"workflow-executor"` | Workflow step executor |
| `EXTENSION_KIND_PERSONA` | `"persona"` | `IPersonaDefinition` |
| `EXTENSION_KIND_PLANNING_STRATEGY` | `"planning-strategy"` | Planning algorithm |
| `EXTENSION_KIND_HITL_HANDLER` | `"hitl-handler"` | Human interaction handler |
| `EXTENSION_KIND_COMM_CHANNEL` | `"communication-channel"` | Agent-to-agent channel |
| `EXTENSION_KIND_MEMORY_PROVIDER` | `"memory-provider"` | Memory backend |
| `EXTENSION_KIND_MESSAGING_CHANNEL` | `"messaging-channel"` | External platform adapter |
| `EXTENSION_KIND_PROVENANCE` | `"provenance"` | Audit/immutability handler |

**ExtensionDescriptor:**

```typescript
interface ExtensionDescriptor<TPayload = unknown> {
  id: string;                           // Unique within its kind
  kind: ExtensionKind;                  // One of the 12 kinds above
  priority?: number;                    // Higher loads later (overrides earlier)
  enableByDefault?: boolean;            // Auto-enable on discovery
  metadata?: Record<string, unknown>;   // Arbitrary metadata
  payload: TPayload;                    // The actual implementation
  source?: ExtensionSourceMetadata;     // Provenance (package name, version)
  requiredSecrets?: ExtensionSecretRequirement[]; // API keys needed
  onActivate?: (ctx: ExtensionLifecycleContext) => Promise<void> | void;
  onDeactivate?: (ctx: ExtensionLifecycleContext) => Promise<void> | void;
}
```

**ExtensionManifest:**

```typescript
interface ExtensionManifest {
  packs: ExtensionPackManifestEntry[];  // Pack references
  overrides?: ExtensionOverrides;       // Per-descriptor enable/disable/priority
}

// Packs can be resolved three ways:
type ExtensionPackResolver =
  | { package: string; version?: string }  // npm package
  | { module: string }                     // Local module path
  | { factory: () => Promise<ExtensionPack> | ExtensionPack }; // Inline factory
```

**Loading pipeline:**

1. `ExtensionLoader` resolves pack entries from the manifest
2. `ExtensionRegistry` registers descriptors by kind, applying priority stacking
3. `ExtensionManager` provides runtime access: `getTools()`, `getGuardrails()`, `getWorkflows()`, etc.
4. `MultiRegistryLoader` supports loading from multiple remote registries

---

### Planning Engine

**Location:** `src/core/planning/`

The planning engine enables multi-step task decomposition and execution using ReAct (Reasoning + Acting) patterns.

```
+-----------------------------------------------------------+
|                    PlanningEngine                           |
|  (Task decomposition, step sequencing, execution loop)     |
+-----------------------------------------------------------+
        |
        v
+-----------------------------------------------------------+
|  IPlanningEngine Interface                                 |
|                                                            |
|  createPlan(goal, context) -> Plan                         |
|  executePlan(plan) -> AsyncGenerator<PlanStepResult>        |
|  revisePlan(plan, feedback) -> Plan                         |
+-----------------------------------------------------------+
```

Plans are composed of typed steps that the agent executes sequentially, with the ability to revise the plan based on intermediate results. The planning engine integrates with:

- **Tool system** for action execution
- **Guardrails** for step-level safety checks
- **HITL** for human approval of high-risk steps
- **Memory** for persisting plan state across sessions

See [`docs/PLANNING_ENGINE.md`](docs/PLANNING_ENGINE.md) for the full planning system specification.

---

### Conversation Management

**Location:** `src/core/conversation/`

Manages session state, message history, and long-term memory persistence.

- **ConversationManager** -- Creates and retrieves conversation contexts, manages rolling message windows, and coordinates memory persistence.
- **ConversationContext** -- Immutable snapshot of a conversation: messages, metadata, active persona, user context.
- **IRollingSummaryMemorySink** -- Interface for persisting conversation summaries that compress long conversations into retrievable memory.
- **ILongTermMemoryRetriever** -- Interface for retrieving relevant past conversations during context assembly.

---

### RAG (Retrieval Augmented Generation)

**Location:** `src/rag/`

A complete RAG pipeline with pluggable vector stores, embedding management, and document ingestion.

```
+-----------------------------------------------------------+
|                  RetrievalAugmentor                         |
|  (Orchestrates ingestion, retrieval, document management)  |
+-----------------------------------------------------------+
        |                               |
        v                               v
+-------------------+         +---------------------+
|  EmbeddingManager |         | VectorStoreManager  |
|  (Model selection,|         | (Multi-provider     |
|   caching, batch) |         |  vector storage)    |
+-------------------+         +---------------------+
        |                               |
        v                               v
+-------------------+         +---------------------+
| LLM Provider      |         | IVectorStore impls  |
| (embedding models)|         +---------------------+
+-------------------+             |    |    |    |
                       +----------+    |    |    +-----------+
                       v               v    v               v
                +-----------+  +--------+  +--------+  +---------+
                | InMemory  |  |  SQL   |  | HNSW   |  | Qdrant  |
                | (dev)     |  | (prod) |  | (local)|  | (cloud) |
                +-----------+  +--------+  +--------+  +---------+
```

**Vector store implementations:**

| Store | Import | Use Case |
|-------|--------|----------|
| `InMemoryVectorStore` | `@framers/agentos/rag` | Development and testing |
| `SqlVectorStore` | `@framers/agentos/rag` | Production (SQLite/Postgres via `@framers/sql-storage-adapter`) |
| `HnswlibVectorStore` | `@framers/agentos/rag` | High-performance local ANN search |
| `QdrantVectorStore` | `@framers/agentos/rag` | Cloud-hosted vector database |

**GraphRAG:**

The `GraphRAGEngine` (at `src/rag/graphrag/`) extends traditional RAG with knowledge graph capabilities:

- Entity and relationship extraction from documents
- Community detection via Louvain algorithm (requires `graphology` peer dependency)
- Local search (entity-centric) and global search (community-summarized)
- Hybrid retrieval combining vector similarity with graph traversal

```typescript
import { GraphRAGEngine } from '@framers/agentos/rag/graphrag';
import type { GraphRAGConfig, GraphEntity, GraphRelationship } from '@framers/agentos/rag/graphrag';
```

See [`docs/RAG_MEMORY_CONFIGURATION.md`](docs/RAG_MEMORY_CONFIGURATION.md) and [`docs/MULTIMODAL_RAG.md`](docs/MULTIMODAL_RAG.md) for detailed configuration guides.

---

### Safety and Guardrails

**Location:** `src/core/safety/` and `src/core/guardrails/`

AgentOS provides defense-in-depth safety through two complementary systems.

#### Safety Primitives (`core/safety/`)

Five runtime safety components:

| Component | Export | Purpose |
|-----------|--------|---------|
| **CircuitBreaker** | `CircuitBreaker` | Three-state (closed/open/half-open) wrapper for LLM calls. Configurable failure threshold, reset timeout, and half-open probe count. Throws `CircuitOpenError` when tripped. |
| **ActionDeduplicator** | `ActionDeduplicator` | Hash-based recent action tracking with LRU eviction. Prevents redundant tool calls and repeated operations within a configurable time window. |
| **StuckDetector** | `StuckDetector` | Detects three patterns: repeated outputs, repeated errors, and oscillation (A-B-A-B cycles). Returns `StuckDetection` with reason and confidence. |
| **CostGuard** | `CostGuard` | Per-agent session and daily spending caps. Defaults: $1/session, $5/day. Throws `CostCapExceededError` when limits are hit. Tracks token usage across all LLM calls. |
| **ToolExecutionGuard** | `ToolExecutionGuard` | Per-tool timeout (30s default) with independent circuit breakers per tool ID. Reports `ToolHealthReport` for monitoring. Throws `ToolTimeoutError`. |

```typescript
import {
  CircuitBreaker,
  CostGuard,
  StuckDetector,
  ActionDeduplicator,
  ToolExecutionGuard,
} from '@framers/agentos/core/safety';
```

See [`docs/SAFETY_PRIMITIVES.md`](docs/SAFETY_PRIMITIVES.md) for the full safety API reference.

#### Guardrails (`core/guardrails/`)

Content-level input/output filtering:

```typescript
enum GuardrailAction {
  ALLOW    = 'allow',     // Pass through unchanged
  FLAG     = 'flag',      // Pass through but log for review
  SANITIZE = 'sanitize',  // Replace with modified content (e.g., PII redaction)
  BLOCK    = 'block',     // Reject entirely, terminate stream
}

interface IGuardrailService {
  evaluateInput?(input: AgentOSInput, context: GuardrailContext): Promise<GuardrailEvaluationResult>;
  evaluateOutput?(output: string, context: GuardrailContext): Promise<GuardrailEvaluationResult>;
}
```

Guardrails run at two points in the request lifecycle:
1. **Pre-processing** -- `evaluateInput()` inspects user input before it reaches the LLM
2. **Post-processing** -- `evaluateOutput()` inspects the LLM response before streaming to the client

Multiple guardrails can be composed via the extension system, and each receives full context (user ID, session ID, persona ID, custom metadata) for context-aware policy decisions.

See [`docs/GUARDRAILS_USAGE.md`](docs/GUARDRAILS_USAGE.md) for implementation patterns.

---

### Human-in-the-Loop (HITL)

**Location:** `src/core/hitl/`

The HITL system enables agents to request human approval, clarification, and collaboration at key decision points.

**Core interface: `IHumanInteractionManager`**

Three interaction modes:

| Mode | Method | Use Case |
|------|--------|----------|
| **Approval** | `requestApproval()` | Gate high-risk actions (database mutations, financial operations, external communications) |
| **Clarification** | `requestClarification()` | Ask the user for missing information before proceeding |
| **Escalation** | `escalateToHuman()` | Hand off to a human operator when the agent cannot proceed |

**PendingAction structure:**

```typescript
interface PendingAction {
  actionId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category?: 'data_modification' | 'external_api' | 'financial' |
             'communication' | 'system' | 'other';
  agentId: string;
  context: Record<string, unknown>;
  potentialConsequences?: string[];
  reversible: boolean;
  estimatedCost?: { amount: number; currency: string };
  timeoutMs?: number;
  alternatives?: AlternativeAction[];
}
```

HITL integrates with the planning engine so individual plan steps can require approval, and with the extension system via `EXTENSION_KIND_HITL_HANDLER` for custom approval UIs.

See [`docs/HUMAN_IN_THE_LOOP.md`](docs/HUMAN_IN_THE_LOOP.md) for the full HITL specification.

---

### Channels System

**Location:** `src/channels/`

Unified adapters for 20 external messaging platforms.

**20 supported platforms:**

| Priority | Platforms |
|----------|-----------|
| **P0** (Core) | Telegram, WhatsApp, Discord, Slack, Webchat |
| **P1** | Signal, iMessage, Google Chat, Microsoft Teams |
| **P2** | Matrix, Zalo, Email, SMS |
| **P3** | Nostr, Twitch, Line, Feishu, Mattermost, Nextcloud Talk, Tlon |

**21 capability flags:**

Each adapter declares its capabilities, allowing consumers to check before attempting unsupported actions:

```
text, rich_text, images, video, audio, voice_notes, documents,
stickers, reactions, threads, typing_indicator, read_receipts,
group_chat, channels, buttons, inline_keyboard, embeds,
mentions, editing, deletion
```

**IChannelAdapter** -- Unified interface for bidirectional messaging:

- `connect()` / `disconnect()` -- Lifecycle management
- `sendMessage()` -- Outbound messages with platform-specific formatting
- `onMessage()` -- Inbound message handler registration
- `getConnectionInfo()` -- Connection health monitoring
- `capabilities` -- Declared capability set

**ChannelRouter** -- Routes inbound messages to the appropriate agent and outbound responses to the correct platform adapter. Supports multi-platform agents (one agent, many channels).

**Connection status:** `disconnected` -> `connecting` -> `connected` -> `reconnecting` -> `error`

Channel adapters are registered as extensions via `EXTENSION_KIND_MESSAGING_CHANNEL`.

See [`docs/PLATFORM_SUPPORT.md`](docs/PLATFORM_SUPPORT.md) for platform-specific configuration.

---

### Voice and Telephony

**Location:** `src/voice/`

Enable agents to make and receive phone calls via telephony providers.

**Call state machine:**

```
initiated --> ringing --> answered --> active --> speaking <--> listening
    |            |           |          |            |            |
    +------------+-----------+----------+------------+------------+
    |                    (any non-terminal state)                 |
    v
[Terminal States]
completed | hangup-user | hangup-bot | timeout | error |
failed | no-answer | busy | voicemail
```

**Providers:**

| Provider | Support |
|----------|---------|
| Twilio | Full voice + SMS |
| Telnyx | Full voice |
| Plivo | Full voice |
| Mock | Testing/development |

**Key components:**

- **CallManager** -- Manages call lifecycle, state transitions, and event dispatch
- **IVoiceCallProvider** -- Interface for telephony provider adapters
- **telephony-audio.ts** -- Audio stream handling and format conversion

Voice providers are registered via `EXTENSION_KIND_TOOL` with the `voice-call-provider` category.

---

### Workflows

**Location:** `src/core/workflows/`

Declarative multi-step workflows with persistence and monitoring.

- **WorkflowEngine** -- Instantiates and executes workflow definitions
- **IWorkflowStore** -- Persistence interface for workflow state (supports SQL and in-memory backends)
- **WorkflowTypes** -- Type definitions for workflow definitions, instances, tasks, and progress updates

Workflows integrate with the IAgentOS interface:

```typescript
// List available workflow definitions
const definitions = agent.listWorkflowDefinitions();

// Start a workflow instance
const instance = await agent.startWorkflow('data-pipeline-v1', input, {
  context: { source: 'scheduled' },
  roleAssignments: { analyst: 'gmi-123', reviewer: 'gmi-456' },
});

// Monitor progress
const status = await agent.getWorkflow(instance.workflowId);
```

---

### Multi-Agent Coordination

**Location:** `src/core/agency/`

Enables teams of agents to collaborate on shared goals.

- **AgencyRegistry** -- Register and manage agent teams with role assignments
- **AgentCommunicationBus** -- Inter-agent message passing with typed events and handoffs
- **AgencyMemoryManager** -- Shared memory space with vector search for agency-wide knowledge

```
+-----------------------------------------------------------+
|                    AgencyRegistry                          |
+-----------------------------------------------------------+
    |               |               |               |
    v               v               v               v
+--------+    +--------+    +--------+    +--------+
| Agent  |    | Agent  |    | Agent  |    | Agent  |
|  (GMI) |    |  (GMI) |    |  (GMI) |    |  (GMI) |
| Resrch |    | Writer |    | Review |    | Deploy |
+--------+    +--------+    +--------+    +--------+
    |               |               |               |
    +-------+-------+-------+-------+-------+-------+
            |                               |
            v                               v
   +------------------+          +--------------------+
   | Communication    |          | Agency Memory      |
   | Bus (events,     |          | Manager (shared    |
   | handoffs, sync)  |          | vector memory)     |
   +------------------+          +--------------------+
```

See [`docs/AGENT_COMMUNICATION.md`](docs/AGENT_COMMUNICATION.md) for the full multi-agent specification.

---

### Observability

**Location:** `src/core/observability/`

OpenTelemetry-native observability for tracing, metrics, and cost tracking.

- **ITracer** / **Tracer** -- Span creation and propagation for distributed tracing
- **otel.ts** -- `configureAgentOSObservability()` sets up the OpenTelemetry SDK with custom exporters
- **Metrics** -- Token usage, latency percentiles, tool execution counts, error rates
- **Cost tracking** -- Per-request and aggregate cost computation across providers

```typescript
import { configureAgentOSObservability } from '@framers/agentos';

configureAgentOSObservability({
  serviceName: 'my-agent',
  traceExporter: myOTLPExporter,
  metricExporter: myMetricsExporter,
});
```

See [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) and [`docs/COST_OPTIMIZATION.md`](docs/COST_OPTIMIZATION.md) for setup guides.

---

### Skills

**Location:** `src/skills/`

Skills are portable, self-describing agent capabilities defined in `SKILL.md` files.

- **SkillRegistry** -- Discovers and registers available skills
- **SkillLoader** -- Parses SKILL.md format (YAML frontmatter + markdown body)
- **SKILL.md format** -- Declarative skill definition with name, description, required tools, and behavioral instructions

See [`docs/SKILLS.md`](docs/SKILLS.md) for the skill authoring guide.

---

### Structured Output

**Location:** `src/core/structured/`

Extract typed, validated data from unstructured text using JSON Schema.

- **StructuredOutputManager** -- Coordinates schema-constrained generation with validation
- **JSON Schema validation** -- Input/output validation via ajv with format support
- **Parallel function calls** -- Multiple tool invocations in a single LLM turn
- **Entity extraction** -- Named entity recognition with schema constraints

See [`docs/STRUCTURED_OUTPUT.md`](docs/STRUCTURED_OUTPUT.md) for usage patterns.

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
      { providerId: 'openai', enabled: true, isDefault: true,
        config: { apiKey: process.env.OPENAI_API_KEY } },
      { providerId: 'anthropic', enabled: true,
        config: { apiKey: process.env.ANTHROPIC_API_KEY } },
      { providerId: 'ollama', enabled: true,
        config: { baseUrl: 'http://localhost:11434' } },
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
  options: {
    preferredProviderId: 'anthropic',
    preferredModelId: 'claude-sonnet-4-5-20250929',
  },
})) { /* ... */ }
```

### Environment Variables

```bash
# Required: at least one LLM provider
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
OLLAMA_BASE_URL=http://localhost:11434

# Database
DATABASE_URL=file:./data/agentos.db

# Observability (optional)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-agent

# Voice/Telephony (optional)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TELNYX_API_KEY=KEY...
```

---

## API Reference

### AgentOS Class

The main service facade. Implements `IAgentOS`.

```typescript
class AgentOS implements IAgentOS {
  // Lifecycle
  initialize(config: AgentOSConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Core interaction (streaming-first)
  processRequest(input: AgentOSInput): AsyncGenerator<AgentOSResponse>;
  handleToolResult(streamId, toolCallId, toolName, toolOutput, isSuccess, errorMessage?):
    AsyncGenerator<AgentOSResponse>;

  // Personas
  listPersonas(): IPersonaDefinition[];
  setActivePersona(personaId: string): Promise<void>;

  // Conversation
  getConversationHistory(sessionId: string): Promise<ConversationContext>;

  // Workflows
  listWorkflowDefinitions(): WorkflowDefinition[];
  startWorkflow(definitionId, input, options?): Promise<WorkflowInstance>;
  getWorkflow(workflowId): Promise<WorkflowInstance | null>;
  updateWorkflowTask(workflowId, taskId, update): Promise<void>;
  queryWorkflows(options?): Promise<WorkflowInstance[]>;

  // Feedback
  submitFeedback(feedback: UserFeedbackPayload): Promise<void>;

  // Exposed managers (for advanced usage)
  readonly llmProviderManager: AIModelProviderManager;
  readonly extensionManager: ExtensionManager;
  readonly conversationManager: ConversationManager;
}
```

### IAgentOS Interface

The core contract. See `src/api/interfaces/IAgentOS.ts` for the full interface definition.

### AgentOSInput

```typescript
interface AgentOSInput {
  userId: string;
  organizationId?: string;        // Multi-tenant routing
  sessionId: string;
  textInput: string | null;
  visionInput?: VisionInputData;  // Image/video input
  audioInput?: AudioInputData;    // Audio input
  preferredPersonaId?: string;    // Request specific persona
  userApiKeys?: Record<string, string>; // User-provided API keys
  feedback?: UserFeedbackPayload; // Inline feedback
  workflowInvocation?: WorkflowInvocationRequest;
  agencyInvocation?: AgencyInvocationRequest;
  memoryControl?: AgentOSMemoryControl;
  options?: ProcessingOptions;    // Model override, temperature, etc.
}
```

### AgentOSResponse Streaming

All core methods return `AsyncGenerator<AgentOSResponse>`. Each yielded chunk has a `type` discriminant:

```typescript
// Handle all chunk types:
for await (const chunk of agent.processRequest(input)) {
  switch (chunk.type) {
    case AgentOSResponseChunkType.TEXT_DELTA:
      process.stdout.write(chunk.textDelta);
      break;
    case AgentOSResponseChunkType.TOOL_CALL_REQUEST:
      console.log('Tools requested:', chunk.toolCalls);
      break;
    case AgentOSResponseChunkType.TOOL_RESULT_EMISSION:
      console.log('Tool result:', chunk.toolName, chunk.toolResult);
      break;
    case AgentOSResponseChunkType.SYSTEM_PROGRESS:
      console.log('Progress:', chunk.message, chunk.progressPercentage);
      break;
    case AgentOSResponseChunkType.WORKFLOW_UPDATE:
      console.log('Workflow:', chunk.workflowProgress);
      break;
    case AgentOSResponseChunkType.AGENCY_UPDATE:
      console.log('Agency event:', chunk.agencyEvent);
      break;
    case AgentOSResponseChunkType.ERROR:
      console.error('Error:', chunk.error);
      break;
    case AgentOSResponseChunkType.FINAL_RESPONSE:
      console.log('Complete:', chunk.finalText);
      break;
  }
}
```

### ITool Interface

See the [Tool System](#tool-system) section above for the full interface. Tools are registered via extension packs:

```typescript
const descriptor: ExtensionDescriptor<ITool> = {
  id: 'my-tool',
  kind: EXTENSION_KIND_TOOL,
  payload: myToolImplementation,
};
```

### ExtensionDescriptor

See the [Extension System](#extension-system) section above for the full type definition and all 12 extension kinds.

### IGuardrailService

```typescript
interface IGuardrailService {
  evaluateInput?(
    input: AgentOSInput,
    context: GuardrailContext,
  ): Promise<GuardrailEvaluationResult>;

  evaluateOutput?(
    output: string,
    context: GuardrailContext,
  ): Promise<GuardrailEvaluationResult>;
}

interface GuardrailEvaluationResult {
  action: GuardrailAction;        // ALLOW | FLAG | SANITIZE | BLOCK
  reason?: string;                // Human-readable explanation
  reasonCode?: string;            // Machine-readable code
  modifiedText?: string;          // Required when action is SANITIZE
  metadata?: Record<string, any>; // Additional context for logging
}
```

### IHumanInteractionManager

```typescript
interface IHumanInteractionManager {
  requestApproval(action: PendingAction): Promise<ApprovalDecision>;
  requestClarification(request: ClarificationRequest): Promise<ClarificationResponse>;
  escalateToHuman(context: EscalationContext): Promise<EscalationResult>;
  getPendingActions(): Promise<PendingAction[]>;
}
```

---

## Usage Examples

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
    output: { text: `Weather in ${args.city}: 22 C, partly cloudy` },
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
  actionId: 'archive-inactive',
  description: 'Archive 50K inactive accounts older than 2 years',
  severity: 'high',
  category: 'data_modification',
  agentId: 'data-cleanup-agent',
  context: { affectedRows: 50_000, table: 'users' },
  reversible: true,
  potentialConsequences: ['Users will lose access to archived data'],
  alternatives: [
    { alternativeId: 'soft_delete', description: 'Mark as inactive instead' },
    { alternativeId: 'export_first', description: 'Export to CSV before archiving' },
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
// Result: { name: 'Sarah Chen', email: 'sarah@startup.io', date: 'Jan 15', topic: 'Series A' }
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
        { modelId: 'text-embedding-3-small', providerId: 'openai',
          dimension: 1536, isDefault: true },
      ],
    },
    vectorStoreManagerConfig: {
      managerId: 'rag-vsm',
      providers: [
        { id: 'sql-store', type: 'sql', storage: { filePath: './data/vectors.db' } },
      ],
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

### Custom Guardrails

```typescript
import {
  AgentOS,
  type IGuardrailService,
  type GuardrailContext,
  GuardrailAction,
} from '@framers/agentos';
import { createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

const piiGuardrail: IGuardrailService = {
  async evaluateInput(input, context) {
    // Check for SSN patterns in user input
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
    if (input.textInput && ssnPattern.test(input.textInput)) {
      return {
        action: GuardrailAction.SANITIZE,
        modifiedText: input.textInput.replace(ssnPattern, '[SSN REDACTED]'),
        reason: 'PII detected in user input',
        reasonCode: 'PII_SSN',
      };
    }
    return { action: GuardrailAction.ALLOW };
  },

  async evaluateOutput(output, context) {
    if (output.toLowerCase().includes('password')) {
      return {
        action: GuardrailAction.BLOCK,
        reason: 'Output contains potentially sensitive credential information',
        reasonCode: 'CREDENTIAL_LEAK',
      };
    }
    return { action: GuardrailAction.ALLOW };
  },
};

const agent = new AgentOS();
const config = await createTestAgentOSConfig();
await agent.initialize({ ...config, guardrailService: piiGuardrail });
```

### Channel Adapters

```typescript
import {
  EXTENSION_KIND_MESSAGING_CHANNEL,
  type ExtensionManifest,
  type IChannelAdapter,
  type ChannelPlatform,
} from '@framers/agentos';

// Implement a custom channel adapter
const myAdapter: IChannelAdapter = {
  platform: 'webchat' as ChannelPlatform,
  capabilities: new Set(['text', 'rich_text', 'images', 'typing_indicator']),

  async connect() { /* establish connection */ },
  async disconnect() { /* clean up */ },
  async sendMessage(channelId, message) { /* send outbound */ },
  onMessage(handler) { /* register inbound handler */ },
  getConnectionInfo() {
    return { status: 'connected', connectedSince: new Date().toISOString() };
  },
};

// Register via extension manifest
const manifest: ExtensionManifest = {
  packs: [{
    factory: async () => ({
      name: 'my-channels',
      descriptors: [{
        id: 'webchat-adapter',
        kind: EXTENSION_KIND_MESSAGING_CHANNEL,
        payload: myAdapter,
      }],
    }),
  }],
};
```

### Voice Calls

```typescript
import { CallManager, type IVoiceCallProvider } from '@framers/agentos';

const callManager = new CallManager();

// Initiate an outbound call
const call = await callManager.initiateCall({
  provider: 'twilio',
  to: '+1234567890',
  from: '+0987654321',
  agentId: 'support-agent',
});

// Monitor call state transitions
call.on('stateChange', (newState) => {
  console.log(`Call ${call.id}: ${newState}`);
  // initiated -> ringing -> answered -> active -> speaking <-> listening -> completed
});

// Handle call completion
call.on('completed', (summary) => {
  console.log('Duration:', summary.durationMs);
  console.log('Transcript:', summary.transcript);
});
```

---

## Package Exports

AgentOS provides 112 export paths for fine-grained imports. Key entry points:

```typescript
// Main entry -- all public types and classes
import { AgentOS, AgentOSResponseChunkType, /* ... */ } from '@framers/agentos';

// Configuration
import { createAgentOSConfig, createTestAgentOSConfig } from '@framers/agentos/config/AgentOSConfig';

// Safety primitives
import { CircuitBreaker, CostGuard, StuckDetector } from '@framers/agentos/core/safety';

// Guardrails
import { GuardrailAction } from '@framers/agentos/core/guardrails';

// Tools
import type { ITool, ToolExecutionResult } from '@framers/agentos/core/tools';

// HITL
import type { IHumanInteractionManager } from '@framers/agentos/core/hitl';

// RAG
import { VectorStoreManager, EmbeddingManager, RetrievalAugmentor } from '@framers/agentos/rag';
import { GraphRAGEngine } from '@framers/agentos/rag/graphrag';

// Skills
import { SkillRegistry, SkillLoader } from '@framers/agentos/skills';

// Deep imports (wildcard exports)
import { SomeType } from '@framers/agentos/core/safety/CircuitBreaker';
import { SomeConfig } from '@framers/agentos/config/ToolOrchestratorConfig';
```

Wildcard exports support paths up to 4 levels deep:
- `./*` -- `dist/*.js`
- `./*/*` -- `dist/*/*.js`
- `./*/*/*` -- `dist/*/*/*.js`
- `./*/*/*/*` -- `dist/*/*/*/*.js`

---

## Internal Documentation

The `docs/` directory contains 25 detailed specification documents:

| Document | Description |
|----------|-------------|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Complete system architecture with data flow diagrams |
| [`SAFETY_PRIMITIVES.md`](docs/SAFETY_PRIMITIVES.md) | Circuit breaker, cost guard, stuck detection, dedup API reference |
| [`PLANNING_ENGINE.md`](docs/PLANNING_ENGINE.md) | ReAct reasoning, multi-step task planning specification |
| [`HUMAN_IN_THE_LOOP.md`](docs/HUMAN_IN_THE_LOOP.md) | Approval workflows, clarification, escalation patterns |
| [`GUARDRAILS_USAGE.md`](docs/GUARDRAILS_USAGE.md) | Input/output guardrail implementation patterns |
| [`RAG_MEMORY_CONFIGURATION.md`](docs/RAG_MEMORY_CONFIGURATION.md) | Vector store setup, embedding models, data source config |
| [`MULTIMODAL_RAG.md`](docs/MULTIMODAL_RAG.md) | Image, audio, and document RAG pipelines |
| [`STRUCTURED_OUTPUT.md`](docs/STRUCTURED_OUTPUT.md) | JSON schema validation, entity extraction, function calling |
| [`AGENT_COMMUNICATION.md`](docs/AGENT_COMMUNICATION.md) | Inter-agent messaging, handoffs, shared memory |
| [`TOOL_CALLING_AND_LOADING.md`](docs/TOOL_CALLING_AND_LOADING.md) | Tool registration, discovery, execution pipeline |
| [`OBSERVABILITY.md`](docs/OBSERVABILITY.md) | OpenTelemetry setup, custom spans, metrics export |
| [`COST_OPTIMIZATION.md`](docs/COST_OPTIMIZATION.md) | Token usage monitoring, caching strategies, model routing |
| [`SKILLS.md`](docs/SKILLS.md) | SKILL.md format specification, skill authoring guide |
| [`PLATFORM_SUPPORT.md`](docs/PLATFORM_SUPPORT.md) | Channel platform capabilities and adapter configuration |
| [`ECOSYSTEM.md`](docs/ECOSYSTEM.md) | Extension ecosystem, official packs, community extensions |
| [`PROVENANCE_IMMUTABILITY.md`](docs/PROVENANCE_IMMUTABILITY.md) | Sealed agents, signed event ledger, external anchoring |
| [`IMMUTABLE_AGENTS.md`](docs/IMMUTABLE_AGENTS.md) | Agent sealing, toolset manifests, revision tracking |
| [`RFC_EXTENSION_STANDARDS.md`](docs/RFC_EXTENSION_STANDARDS.md) | Extension pack authoring standards and conventions |
| [`EVALUATION_FRAMEWORK.md`](docs/EVALUATION_FRAMEWORK.md) | Agent evaluation, benchmarking, quality metrics |
| [`RECURSIVE_SELF_BUILDING_AGENTS.md`](docs/RECURSIVE_SELF_BUILDING_AGENTS.md) | Self-modifying agent patterns |
| [`LOGGING.md`](docs/LOGGING.md) | Structured logging configuration with pino |
| [`CLIENT_SIDE_STORAGE.md`](docs/CLIENT_SIDE_STORAGE.md) | Browser-compatible storage adapters |
| [`SQL_STORAGE_QUICKSTART.md`](docs/SQL_STORAGE_QUICKSTART.md) | SQLite/Postgres setup with `@framers/sql-storage-adapter` |
| [`RELEASING.md`](docs/RELEASING.md) | Release process and semantic versioning |

---

## Key Design Patterns

1. **Interface-driven design** -- All major components define interface contracts (`IAgentOS`, `ITool`, `IGuardrailService`, `IChannelAdapter`, `IVoiceCallProvider`, `IVectorStore`, etc.). Implementations are swappable.

2. **Streaming-first** -- Core interaction methods return `AsyncGenerator<AgentOSResponse>` for token-level streaming with natural backpressure. Consumers process chunks as they arrive.

3. **Extension system** -- Pluggable components via `ExtensionDescriptor` with 12 kinds, priority stacking, lifecycle hooks, and secret management. Extensions can be loaded from npm packages, local modules, or inline factories.

4. **Multi-provider** -- LLM providers, vector stores, voice providers, and channel adapters all support multiple backend implementations with runtime switching.

5. **Safety layering** -- Defense-in-depth: input guardrails, output guardrails, circuit breakers, cost guards, tool execution guards, stuck detection, action deduplication, and HITL approval gates.

6. **Observability** -- OpenTelemetry integration throughout the stack with distributed tracing, custom metrics, cost tracking, and structured logging via pino.

---

## Contributing

```bash
git clone https://github.com/framersai/agentos.git
cd agentos
pnpm install
pnpm run build
pnpm run test
```

**Available scripts:**

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
  <img src="https://raw.githubusercontent.com/framersai/agentos/master/assets/logos/frame-logo.svg" alt="Frame.dev" height="40" />
</a>

**Built by [Frame.dev](https://frame.dev)** · [@framersai](https://github.com/framersai)

</div>
