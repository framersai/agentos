---
description: "What a GMI is, how its seven layers fit together, and how it differs from a stateless prompt-based agent."
---

# Generalized Mind Instances (GMIs)

A **Generalized Mind Instance** (GMI) is the core abstraction in AgentOS. It is not a system prompt around a chat API. It is a persistent cognitive core with personality traits, cognitive memory, runtime guardrails, and provider-agnostic LLM access — created through `agent()` and addressed through sessions that carry state across turns and processes.

The architecture follows the [CoALA framework](https://arxiv.org/abs/2309.02427) (Sumers et al., 2023) for cognitive language agents and extends it with relational and prospective memory traces a long-running agent needs.

## Quick example

```typescript
import { agent } from '@framers/agentos';

const gmi = agent({
  provider: 'anthropic',
  instructions: 'You are a thorough research analyst.',
  personality: {
    conscientiousness: 0.95,
    openness: 0.85,
    agreeableness: 0.7,
  },
  memory: { enabled: true, consolidation: true },
  guardrails: ['pii-redaction', 'grounding-guard'],
});

const session = gmi.session('research-q1');
const reply = await session.send(
  'Analyze Q1 market trends in AI infrastructure.'
);
console.log(reply.text);
```

The same `agent()` factory powers everything from a single chat assistant to a multi-agent orchestrator. Configuration is data; the runtime composes the layers below from it.

## The seven layers

A GMI is composed of seven concentric layers. Outer layers are the surface area exposed to users and other systems; inner layers are the cognitive substrate.

| Layer | What it owns |
|-------|-------------|
| **Channels & I/O** | Telegram, Discord, Slack, WhatsApp and additional adapters. Voice via STT + TTS providers. Every adapter streams tokens through a unified protocol. |
| **Guardrails & Safety** | Per-chunk evaluation: PII redaction, toxicity detection, grounding checks, code-safety scans. Tier presets from `safe` to `private-adult`. See [Sandbox & Security](/architecture/sandbox-security). |
| **Tools & Extensions** | Built-in extensions and curated skills, plus runtime tool forging. Capability discovery selects tools semantically rather than from hard-coded lists. See [Skills vs Tools vs Extensions](/architecture/skills-vs-tools-vs-extensions). |
| **Orchestration** | Sequential, parallel, debate, hierarchical, review-loop, and graph strategies. Tree-of-thought planning. Checkpointing with fork and resume semantics. See [Emergent Agency System](/architecture/emergent-agency-system). |
| **Memory** | Ebbinghaus decay, reconsolidation, retrieval-induced forgetting, involuntary recall, feeling-of-knowing, temporal gist, schema encoding, and source-confidence decay. HyDE + GraphRAG retrieval across pluggable vector backends. See [Cognitive Memory](/features/cognitive-memory). |
| **Personality (HEXACO)** | Honesty-Humility, Emotionality, Extraversion, Agreeableness, Conscientiousness, Openness. Trait values modulate memory encoding strength, communication style, and risk tolerance. |
| **LLM Core** | Provider-agnostic adapter layer. Automatic fallback chains across providers. The thinking engine at the heart of every GMI. See [LLM Providers](/architecture/llm-providers). |

The `GMIManager` owns the lifecycle of a single instance; `GMIChunkTransformer` maps streaming output into typed chunks consumers can react to (token, tool-call, memory-formed, media). For higher-level coordination across multiple GMIs, see [Multi-GMI Collaboration](/architecture/multi-gmi-implementation-plan).

## GMI vs. a stateless agent

| | Traditional agent | AgentOS GMI |
|---|---|---|
| Identity | Stateless prompt | Persistent identity with HEXACO personality |
| Memory | None between sessions | Cognitive memory with Ebbinghaus decay and consolidation |
| Behavior | Fixed | Style adaptation across turns and sessions |
| Providers | Single model | Multi-provider with automatic fallback |
| Tools | Manual wiring | Capability discovery — tools chosen semantically |
| Safety | After-the-fact filter | Per-chunk guardrails enforced at the framework layer |

A traditional "agent" is a system prompt and a list of tools called inside one inference. A GMI is the entity that exists between those inferences: it owns the session state, encodes new memories, decays old ones, applies trait-modulated language, and routes around provider failures. The conversation is a window into the GMI; the GMI is not a snapshot of the conversation.

## Where it fits in the source tree

`GMI` delegates to focused collaborators rather than centralizing logic:

- `ConversationHistoryManager` — turn buffer and history compaction
- `CognitiveMemoryBridge` — encoding, decay, retrieval
- `SentimentTracker` — mood + PAD-model state
- `MetapromptExecutor` — system-prompt assembly with personality + skill layering
- `cognitive_substrate/persona_overlays/` — persona layering on top of base traits

The public lifecycle facade is `AgentOS` (in `api/runtime/`), with `WorkflowFacade`, `CapabilityDiscoveryInitializer`, and `RagMemoryInitializer` handling setup. The high-level helpers `generateText`, `streamText`, `agent`, and `agency` live under `api/`.

## Further reading

- [System Architecture](/architecture/system-architecture) — full module layout and request lifecycle
- [Cognitive Memory](/features/cognitive-memory) — encoding, decay, and retrieval mechanics
- [Skills vs Tools vs Extensions](/architecture/skills-vs-tools-vs-extensions) — when each capability system applies
- [Emergent Agency System](/architecture/emergent-agency-system) — multi-GMI coordination and goal decomposition
- [Sandbox & Security](/architecture/sandbox-security) — guardrail and tool-execution isolation
- [LLM Providers](/architecture/llm-providers) — provider abstraction and fallback chains
