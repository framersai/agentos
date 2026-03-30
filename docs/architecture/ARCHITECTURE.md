# System Architecture

AgentOS is organized into 26 domain-specific modules. This page covers the high-level layout, request lifecycle, and how the major subsystems connect.

For specific subsystem deep-dives, see:
- [Sandbox & Security](./sandbox-security.md)
- [CLI Subprocess](./cli-subprocess.md)
- [Tool Permissions](./tool-permissions.md)
- [Extension Loading](./extension-loading.md)
- [Skills Engine](./skills-engine.md)
- [Provenance & Immutability](../features/provenance-immutability.md)

---

## Source Directory Layout

The `src/` tree is organized into 26 domain-specific top-level modules. Only foundational infrastructure remains under `core/`.

**Perception model:** Vision, hearing, and speech are separated into three independent modules following the biological perception analogy -- **vision/** (OCR, scene detection, image analysis), **hearing/** (STT providers, VAD, silence detection), and **speech/** (TTS providers, resolver, session). Shared media generation (images, video, music, SFX) remains under **media/**.

**Key architectural patterns:**

- **GMI** (Generalized Mind Instance) delegates to focused collaborators: `ConversationHistoryManager`, `CognitiveMemoryBridge`, `SentimentTracker`, and `MetapromptExecutor`. Persona layering lives in `cognitive_substrate/persona_overlays/`.

- **AgentOS** is the public lifecycle facade. Setup and runtime concerns are in `api/runtime/` (`WorkflowFacade`, `CapabilityDiscoveryInitializer`, `RagMemoryInitializer`). High-level helpers (`generateText`, `streamText`, `agent`, `agency`) live under `api/`.

- **AgentOSOrchestrator** coordinates requests, delegating to `TurnExecutionPipeline` (pre-LLM preparation), `GMIChunkTransformer` (stream mapping), and `ExternalToolResultHandler` (tool-result continuation).

```
src/
├── agents/                  # Agent definitions + multi-agent collectives
│   ├── definitions/         # Agent type definitions
│   └── agency/              # Multi-agent coordination (AgencyRegistry, etc.)
│
├── api/                     # Public API surface (AgentOS, high-level helpers)
│   ├── runtime/             # Orchestrator collaborators, tool adapters, provider defaults
│   └── types/               # AgentOSInput, AgentOSResponse, etc.
│
├── channels/                # Channel adapters + telephony + social posting
│   ├── adapters/            # Platform-specific adapters (Discord, Slack, etc.)
│   ├── telephony/           # Voice call providers (Twilio, Vonage, etc.)
│   └── social-posting/      # Social media post management
│
├── cognitive_substrate/     # GMI + extracted collaborators
│   ├── personas/            # Persona definitions + loader
│   ├── persona_overlays/    # PersonaOverlayManager
│   ├── ConversationHistoryManager.ts
│   ├── CognitiveMemoryBridge.ts
│   ├── SentimentTracker.ts
│   └── MetapromptExecutor.ts
│
├── core/                    # Infrastructure (11 dirs)
│   ├── config/              # Configuration types
│   ├── conversation/        # ConversationManager
│   ├── embeddings/          # IEmbeddingManager (shared interface)
│   ├── llm/                 # LLM providers, routing
│   ├── logging/             # Logger abstraction
│   ├── rate-limiting/       # Rate limiter
│   ├── storage/             # IStorageAdapter
│   ├── streaming/           # StreamingManager
│   ├── tools/               # ITool, ToolOrchestrator
│   ├── utils/               # Shared helpers
│   └── vector-store/        # IVectorStore, IVectorStoreManager (shared interfaces)
│
├── discovery/               # Capability discovery engine (tiered semantic search)
│
├── emergent/                # Emergent capabilities (self-improvement)
│
├── evaluation/              # Eval framework + observability
│   └── observability/       # OpenTelemetry tracing & metrics
│
├── extensions/              # Extension system
│
├── hearing/                 # Listening: STT providers, VAD, silence detection
│
├── marketplace/             # Agent marketplace + workspace
│   ├── store/               # Marketplace listings & search
│   └── workspace/           # Per-agent workspace helpers
│
├── media/                   # Creative generation (images, video, music, SFX)
│   ├── audio/               # Music + SFX generation
│   ├── images/              # Image generation (DALL-E, Stability, etc.)
│   └── video/               # Video generation & analysis
│
├── memory/                  # Cognitive memory system
│   ├── core/                # Shared memory types, decay, working-memory helpers
│   ├── io/facade/           # Standalone Memory API (remember/recall)
│   ├── io/tools/            # MemoryAdd/Search/Update/Delete/Merge tools
│   ├── mechanisms/          # Neuroscience-grounded cognitive mechanisms
│   ├── pipeline/            # Consolidation, context, lifecycle, observation
│   └── retrieval/           # SqliteBrain, graphs, feedback, prospective memory
│
├── nlp/                     # NLP processing
│   ├── ai_utilities/        # AI utility helpers (LLM-backed summarization, etc.)
│   ├── language/            # Language detection & translation
│   ├── tokenizers/          # Tokenizer implementations
│   ├── stemmers/            # Stemmer implementations
│   └── ...                  # normalizers, lemmatizers, filters
│
├── orchestration/           # DAG workflow engine + planner + HITL
│   ├── planner/             # PlanningEngine, ReAct loops
│   ├── hitl/                # Human-in-the-loop approval
│   ├── workflows/           # Workflow definitions & execution
│   ├── turn-planner/        # TurnPlanner + telemetry
│   ├── ir/                  # Intermediate representation
│   ├── compiler/            # Graph compiler
│   ├── runtime/             # Workflow runtime
│   ├── checkpoint/          # Checkpoint/restore
│   └── events/              # Event bus
│
├── provenance/              # Content provenance + blockchain anchoring
│
├── query-router/            # Query classification + routing
│
├── rag/                     # Retrieval-augmented generation
│   ├── vector-search/       # HNSW sidecar, Postgres, etc.
│   ├── vector_stores/       # Vector store implementations
│   ├── chunking/            # Document chunking strategies
│   ├── reranking/           # Reranking models
│   ├── unified/             # Unified retriever
│   └── graphrag/            # Graph-augmented retrieval
│
├── safety/                  # Guardrails + runtime safety
│   ├── guardrails/          # IGuardrailService, ParallelGuardrailDispatcher
│   └── runtime/             # CircuitBreaker, CostGuard, StuckDetector, etc.
│
├── sandbox/                 # Sandboxed execution + subprocess
│   ├── executor/            # Sandboxed code execution
│   └── subprocess/          # CLISubprocessBridge, CLIRegistry
│
├── skills/                  # SKILL.md loader (content lives in agentos-skills)
│
├── speech/                  # Speaking: TTS providers, resolver, session
│
├── structured/              # Structured output + prompt routing
│   ├── output/              # StructuredOutputManager, JSON schema
│   └── prompting/           # Prompt routing & construction
│
├── types/                   # Shared types (auth)
│
├── vision/                  # Seeing: OCR, scene detection, image analysis
│
└── voice-pipeline/          # Real-time voice conversation orchestrator
```

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│  API Layer                                                  │
│  generateText · streamText · agent · agency · generateImage │
├─────────────────────────────────────────────────────────────┤
│  Orchestration                                              │
│  workflow() · mission() · AgentGraph · HITL · checkpointing │
├─────────────────────────────────────────────────────────────┤
│  GMI (Generalized Mind Instance)                            │
│  ConversationHistory · CognitiveMemory · Sentiment · Persona│
├──────────────────────┬──────────────────────────────────────┤
│  Safety & Guardrails │  Tools & Extensions                  │
│  5-tier security     │  107 extensions, 72 skills           │
│  PII · toxicity      │  CLI executor, web search            │
│  grounding guard     │  capability discovery                │
├──────────────────────┴──────────────────────────────────────┤
│  Memory & RAG                                               │
│  4-tier memory · 8 cognitive mechanisms · HEXACO-modulated  │
│  7 vector backends · HyDE · GraphRAG · hybrid retrieval     │
├─────────────────────────────────────────────────────────────┤
│  LLM Providers (21)                                         │
│  OpenAI · Anthropic · Gemini · Ollama · Groq · OpenRouter   │
│  + automatic fallback chains                                │
├─────────────────────────────────────────────────────────────┤
│  Perception                                                 │
│  Vision (OCR) · Hearing (STT/VAD) · Speech (TTS)           │
│  37 channel adapters · telephony (Twilio/Telnyx/Plivo)     │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle

A user request flows through the following stages:

1. **Authentication & Rate Limiting** -- Validate auth context and check rate limits.
2. **Context Assembly** -- Load session history, conversation context, and temporal/environmental state.
3. **GMI Selection** -- Get or create a GMI instance for the user/persona/session tuple.
4. **Memory Retrieval** -- `CognitiveMemoryBridge` retrieves relevant memory traces; RAG retrieval runs if configured.
5. **Prompt Construction** -- `MetapromptExecutor` assembles system, persona, memory, RAG context, and conversation history into the prompt via `PromptBuilder`.
6. **Pre-execution Guardrails** -- `ParallelGuardrailDispatcher` runs input guardrails (sanitizers first, classifiers in parallel).
7. **Tool Orchestration** -- `ToolOrchestrator` resolves and executes any tool calls selected by the LLM.
8. **LLM Execution** -- `StreamingManager` sends the prompt to the selected LLM provider and streams chunks.
9. **Post-execution Guardrails** -- Output guardrails evaluate the response (toxicity, PII, grounding).
10. **Memory Update** -- `CognitiveMemoryBridge` encodes new memory traces; `MemoryObserver` queues background consolidation.
11. **Analytics** -- `Tracer` records OpenTelemetry spans; cost/token metrics are tracked.

The `TurnExecutionPipeline` (in `api/runtime/`) handles steps 2-6 before handing off to the LLM. `GMIChunkTransformer` maps raw LLM chunks into `AgentOSResponse` format. `ExternalToolResultHandler` manages tool-result continuation loops.

---

## Extension & Guardrail Runtime

The extension runtime is centered on three core pieces:

1. **`ExtensionManifest` / `ExtensionPack`** -- Declarative loading of tool bundles, guardrails, and channel adapters.
2. **`ExtensionManager`** -- Descriptor activation and runtime access.
3. **`ISharedServiceRegistry`** -- Lazy singleton reuse across packs (for NLP pipelines, ONNX classifiers, embedding functions).

```typescript
interface ExtensionPack {
  name: string;
  version?: string;
  descriptors: ExtensionDescriptor[];
  onActivate?: (context: ExtensionLifecycleContext) => Promise<void> | void;
  onDeactivate?: (context: ExtensionLifecycleContext) => Promise<void> | void;
}
```

### Guardrail Dispatch Model

`ParallelGuardrailDispatcher` uses a two-phase execution model:

1. **Phase 1 (sequential sanitizers)** -- Guardrails with `config.canSanitize === true` run in registration order and can chain `SANITIZE` results deterministically.
2. **Phase 2 (parallel classifiers)** -- All remaining guardrails run concurrently with worst-action aggregation (`BLOCK > FLAG > ALLOW`).

`GuardrailOutputPayload` carries `ragSources?: RagRetrievedChunk[]` so grounding-aware guardrails can verify claims against retrieved evidence.

### Built-in Guardrail Packs

Five built-in packs ship directly from `@framers/agentos/extensions/packs/*`:

- `pii-redaction`
- `ml-classifiers`
- `topicality`
- `code-safety`
- `grounding-guard`

For details on writing custom guardrails, see [Creating Guardrails](../safety/CREATING_GUARDRAILS.md) and [Guardrails Usage](../safety/GUARDRAILS_USAGE.md).

---

## Persona System

Personas define the identity, expertise, and behavioral configuration for a GMI instance.

**Key files:**
- `cognitive_substrate/personas/IPersonaDefinition.ts` -- The `IPersonaDefinition` interface
- `cognitive_substrate/personas/PersonaLoader.ts` -- Loads persona JSON files from disk or registry
- `cognitive_substrate/personas/PersonaValidation.ts` -- Schema validation
- `cognitive_substrate/persona_overlays/PersonaOverlayManager.ts` -- Runtime persona layering

A persona definition includes:

- **Identity** -- Name, role, title, personality traits, expertise domains, purpose/objectives
- **Cognitive config** -- Memory settings (working memory capacity, decay rate, consolidation frequency), attention priorities
- **Behavioral config** -- Communication style, problem-solving methodology, collaboration style
- **HEXACO personality traits** -- Six-factor personality model that modulates memory encoding, retrieval, and cognitive mechanisms

The `PersonaOverlayManager` supports runtime persona blending -- applying temporary overlays (e.g., "be more formal") on top of the base persona definition.

For preset persona definitions, see `packages/wunderland/presets/`.

---

## Prompt Construction

`MetapromptExecutor` (`cognitive_substrate/MetapromptExecutor.ts`) is the prompt assembly engine. It builds the final LLM prompt from:

1. **System instruction** -- Base persona system prompt
2. **Persona overlays** -- Active overlay modifications
3. **Memory context** -- Retrieved memory traces formatted by `MemoryPromptAssembler`
4. **RAG context** -- Retrieved document chunks (when RAG is enabled)
5. **Conversation history** -- Managed by `ConversationHistoryManager` with token-budget compression
6. **Tool schemas** -- Available tools serialized for the LLM
7. **Capability discovery results** -- Tiered semantic search results (when discovery is active)

`PromptProfileRouter` (`structured/prompting/PromptProfileRouter.ts`) selects prompt strategies based on task classification.

---

## Memory System

The cognitive memory system replaces flat key-value memory with a personality-modulated, decay-aware architecture grounded in cognitive science.

### Core Model

Memory traces follow the Ebbinghaus forgetting curve: `S(t) = S0 * e^(-dt / stability)`, where `S0` is set by personality, arousal, and content features. Stability grows with each successful retrieval (spaced repetition). Traces below a pruning threshold are soft-deleted during consolidation.

### Architecture

```
CognitiveMemoryManager (orchestrator)
  ├── EncodingModel         -- HEXACO traits -> encoding weights, flashbulb memories
  ├── DecayModel            -- Ebbinghaus curve, spaced repetition, interference
  ├── CognitiveWorkingMemory -- Baddeley's slot model (7+-2, personality-modulated)
  ├── MemoryStore           -- IVectorStore + IKnowledgeGraph unified persistence
  ├── MemoryPromptAssembler -- Token-budgeted 6-section prompt assembly
  ├── IMemoryGraph          -- Graphology adapter with 8 edge types
  ├── SpreadingActivation   -- Anderson's ACT-R BFS with Hebbian learning
  ├── MemoryObserver        -- Personality-biased background note extraction
  ├── MemoryReflector       -- LLM-driven consolidation of notes into long-term traces
  ├── ProspectiveMemoryManager -- Time/event/context-triggered future intentions
  └── ConsolidationPipeline -- 5-step periodic maintenance
```

### Memory Types and Retrieval

Four memory types (Tulving's taxonomy): `episodic`, `semantic`, `procedural`, `prospective`. Four scopes: `thread`, `user`, `persona`, `organization`.

Retrieval combines six weighted signals: strength/decay (0.25), vector similarity (0.35), recency (0.10), emotional congruence (0.15), graph activation (0.10), importance (0.05).

### Eight Cognitive Mechanisms

Located in `memory/mechanisms/`: reconsolidation, retrieval-induced forgetting, involuntary recall, feeling-of-knowing, temporal gist extraction, schema encoding, source confidence decay, emotion regulation. All are HEXACO-modulated.

### GMI Integration

1. **After user message**: `encode()` creates a MemoryTrace with personality-modulated strength
2. **Before prompt construction**: `assembleForPrompt()` retrieves and formats memory within a token budget
3. **After response**: `observe()` feeds the response to the observer buffer for background consolidation

For full details, see [Cognitive Memory](../memory/COGNITIVE_MEMORY.md), [Cognitive Mechanisms](../memory/COGNITIVE_MECHANISMS.md), and [Memory Architecture](../memory/MEMORY_ARCHITECTURE.md).

---

## RAG System

The RAG subsystem provides retrieval-augmented generation with multiple vector backends and retrieval strategies.

### Vector Store Backends

Seven `IVectorStore` implementations:

- **HnswlibVectorStore** -- In-process HNSW index via `hnswlib-node` (O(log n) ANN search, 2-10ms at 100K docs)
- **InMemoryVectorStore** -- Linear-scan cosine similarity (development/testing)
- **PostgresVectorStore** -- pgvector-backed
- **PineconeVectorStore**, **QdrantVectorStore** -- Managed cloud backends
- **SqliteVectorStore** -- Via `sql-storage-adapter`
- **IndexedDBVectorStore** -- Browser-side persistence

### GraphRAG Engine

`GraphRAGEngine` (`rag/graphrag/GraphRAGEngine.ts`) implements Microsoft GraphRAG-inspired retrieval:

1. **Ingestion**: Entity extraction (LLM or pattern-based) -> graph construction (graphology) -> Louvain community detection -> hierarchical meta-graph -> LLM community summarization
2. **Global search**: Query community summary embeddings, synthesize across matched communities
3. **Local search**: Query entity embeddings, 1-hop graph expansion, include community context

### Retrieval Pipeline

- **HyDE** (Hypothetical Document Embeddings) for improved recall
- **Hybrid retrieval**: Dense (embedding) + sparse (BM25) with reciprocal rank fusion
- **Reranking**: Pluggable providers (Cohere API or local cross-encoder via Transformers.js)
- **Chunking**: Multiple strategies in `rag/chunking/`

### GMI RAG Integration

The GMI integrates with RAG through persona-configurable hooks:
- `shouldTriggerRAGRetrieval()` checks `ragConfig.retrievalTriggers`
- `retrievalAugmentor.retrieveContext()` runs the retrieval pipeline
- `performPostTurnIngestion()` summarizes and embeds conversation turns

For configuration details, see [RAG Memory Configuration](../memory/RAG_MEMORY_CONFIGURATION.md) and [HyDE Retrieval](../memory/HYDE_RETRIEVAL.md).

---

## Multi-Agent Coordination

### Agency System

The agency system enables multi-agent coordination through two strategies:

**Emergent mode**: An LLM-backed planner decomposes goals into tasks, assigns them to roles, and spawns new roles as needed. Implemented in `backend/src/integrations/agentos/EmergentAgencyCoordinator.ts`.

**Static mode**: Predefined roles and tasks execute in topologically-sorted order. Implemented in `backend/src/integrations/agentos/StaticAgencyCoordinator.ts`.

`MultiGMIAgencyExecutor` orchestrates parallel GMI instance spawning (one per role), handles retry logic with exponential backoff, and aggregates costs across seats.

### Agent Communication Bus

`AgentCommunicationBus` (`agents/agency/AgentCommunicationBus.ts`) provides structured messaging between GMIs:
- **Direct send** -- Targeted messages to specific agents
- **Broadcast** -- Send to all agents in an agency
- **Request/Response** -- Query agents and await responses
- **Handoff** -- Transfer context between agents with state, findings, and memory references

Message types: `task_delegation`, `status_update`, `question`, `answer`, `finding`, `decision`, `critique`, `handoff`, `alert`, `proposal`, `agreement`, `disagreement`.

### Planning Engine

`PlanningEngine` (`orchestration/planner/PlanningEngine.ts`) converts high-level goals into multi-step `ExecutionPlan` objects using the ReAct (Reasoning and Acting) pattern. Supports plan generation, task decomposition, plan refinement, and autonomous plan-execute-reflect loops.

### Human-in-the-Loop

`HumanInteractionManager` (`orchestration/hitl/HumanInteractionManager.ts`) provides structured collaboration between AI agents and human operators:
- **Approval requests** for high-risk actions (with severity levels and reversibility flags)
- **Clarification requests** for ambiguous situations
- **Escalations** for transferring control to humans

For details, see [Planning Engine](../orchestration/PLANNING_ENGINE.md), [HITL](../safety/HUMAN_IN_THE_LOOP.md), [Agency API](../orchestration/AGENCY_API.md), and [Agent Communication](./AGENT_COMMUNICATION.md).

---

## Tool System

`ToolOrchestrator` (`core/tools/ToolOrchestrator.ts`) manages tool registration, discovery, and execution.

### Key Components

- **ITool interface** -- Standard tool contract with `name`, `description`, `parameters` (JSON Schema), and `execute()`.
- **ToolOrchestrator** -- Resolves tool calls from LLM output, validates inputs against schemas, executes tools, and returns results.
- **CodeSandbox** (`sandbox/executor/CodeSandbox.ts`) -- Sandboxed code execution environment.
- **CLIRegistry** (`sandbox/subprocess/CLIRegistry.ts`) -- Registry for CLI subprocess bridges (claude-code-cli, gemini-cli, etc.).
- **CapabilityDiscoveryEngine** (`discovery/`) -- Tiered semantic search replacing static tool dumps (~90% token reduction).

### Extension-Provided Tools

Tools are typically loaded via `ExtensionPack` descriptors. The extension registry catalogs 23+ tools, 37 channels, 3 voice extensions, and 4 orchestration tools.

For details, see [Tool Calling & Loading](../extensions/TOOL_CALLING_AND_LOADING.md) and [Capability Discovery](../extensions/CAPABILITY_DISCOVERY.md).

---

## Guardrails

`IGuardrailService` is the core interface:

```typescript
interface IGuardrailService {
  config?: {
    evaluateStreamingChunks?: boolean;
    maxStreamingEvaluations?: number;
    canSanitize?: boolean;
    timeoutMs?: number;
  };
  evaluateInput?(payload: GuardrailInputPayload): Promise<GuardrailEvaluationResult | null>;
  evaluateOutput?(payload: GuardrailOutputPayload): Promise<GuardrailEvaluationResult | null>;
}
```

`ParallelGuardrailDispatcher` runs guardrails in two phases (sanitizers sequentially, classifiers in parallel). Five built-in packs cover PII redaction, ML classification, topicality, code safety, and grounding verification.

The safety runtime also includes `CircuitBreaker`, `CostGuard`, and `StuckDetector` in `safety/runtime/`.

For details, see [Safety Primitives](../safety/SAFETY_PRIMITIVES.md), [Creating Guardrails](../safety/CREATING_GUARDRAILS.md), and [Guardrails Usage](../safety/GUARDRAILS_USAGE.md).

---

## Voice Pipeline

The real-time voice conversation pipeline lives in `voice-pipeline/`:

- **WebSocketStreamTransport** / **WebRTCStreamTransport** -- Audio transport layers
- **HeuristicEndpointDetector** -- VAD-based speech endpoint detection
- **HardCutBargeinHandler** -- Barge-in (interruption) handling

The pipeline coordinates hearing (STT), the GMI turn loop, and speech (TTS) into a streaming conversation flow.

For details, see [Voice Pipeline](../features/VOICE_PIPELINE.md) and [Speech Providers](../features/SPEECH_PROVIDERS.md).

---

## Channels

37 channel adapters provide platform connectivity:

- **ChannelRouter** (`channels/ChannelRouter.ts`) -- Routes messages to the appropriate adapter
- **IChannelAdapter** -- Standard adapter interface
- **adapters/** -- Discord, Slack, Telegram, Twitter/X, LinkedIn, Facebook, Threads, Bluesky, Mastodon, and more
- **telephony/** -- Twilio, Telnyx, Plivo, Vonage voice call providers
- **social-posting/** -- `SocialPostManager` and `ContentAdaptationEngine` for cross-platform publishing

For details, see [Channels](../features/CHANNELS.md), [Social Posting](../features/SOCIAL_POSTING.md), and [Telephony Providers](../features/TELEPHONY_PROVIDERS.md).

---

## Observability

- **Tracer** (`evaluation/observability/Tracer.ts`) -- OpenTelemetry-compatible distributed tracing
- **otel.ts** -- OTLP exporter configuration
- **Evaluator** / **LLMJudge** (`evaluation/`) -- Eval framework for grading agent outputs
- **TurnPlanner telemetry** (`orchestration/turn-planner/SqlTaskOutcomeTelemetryStore.ts`) -- Per-turn outcome tracking

For details, see [Observability](../observability/OBSERVABILITY.md), [Logging](../observability/LOGGING.md), and [Evaluation Framework](../observability/EVALUATION_FRAMEWORK.md).

---

## Emergent Capabilities

The `emergent/` module enables runtime self-improvement:

- **SandboxedToolForge** -- Agents can compose new tools at runtime
- **ComposableToolBuilder** -- Declarative tool composition
- **AdaptPersonalityTool** / **PersonalityMutationStore** -- Controlled personality adaptation within safety bounds
- **SelfEvaluateTool** -- Agent self-assessment

For details, see [Emergent Capabilities](./EMERGENT_CAPABILITIES.md) and [Recursive Self-Building Agents](./RECURSIVE_SELF_BUILDING_AGENTS.md).
