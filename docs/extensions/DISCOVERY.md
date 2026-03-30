# Capability Discovery — Token-Efficient Tool Context

> Replace static tool dumps with per-turn semantic retrieval — ~90% token reduction while improving accuracy.

---

## Table of Contents

1. [Overview](#overview)
2. [Three-Tier Context Model](#three-tier-context-model)
3. [CapabilityDescriptor](#capabilitydescriptor)
4. [CapabilityGraph Relationships](#capabilitygraph-relationships)
5. [CAPABILITY.yaml Format](#capabilityyaml-format)
6. [Agent Self-Discovery via Meta-Tool](#agent-self-discovery-via-meta-tool)
7. [Integration with PromptBuilder](#integration-with-promptbuilder)
8. [Configuration](#configuration)

---

## Overview

At scale (20+ tools, 40 skills, 20 channels), dumping every tool schema
into the system prompt creates ~20,000 tokens of static context per turn —
most of it irrelevant to the current task. This is **context rot**: degraded
output quality as irrelevant context accumulates.

The Capability Discovery Engine solves this with a three-tier model:

```
User message
    ↓
CapabilityIndex.search(userMessage)         // semantic vector search
    ↓
CapabilityGraph.rerank(results)             // boost related capabilities via graph
    ↓
CapabilityContextAssembler.assemble(reranked)  // token-budgeted tier assembly
    ↓
CapabilityDiscoveryResult → system prompt    // ~1,850 tokens total
```

**Token budget comparison:**

| Approach | Tokens per turn |
|----------|----------------|
| Static dump (20 tools + 40 skills + 20 channels) | ~20,000 |
| Discovery Engine (Tier 0 + 1 + 2) | ~1,850 |
| Reduction | ~90% |

---

## Three-Tier Context Model

### Tier 0 — Always in Context (~150 tokens)

High-level category summaries. Always present regardless of the current query.
Gives the model a map of what capabilities exist.

```
Available capability categories:
- communication: telegram, discord, slack, whatsapp (+16 more) [20]
- information: web-search, news-search, web-browser [3]
- developer-tools: github, git, cli-executor [3]
- social-media: twitter, linkedin, bluesky (+15 more) [18]
- publishing: devto, hashnode, medium, wordpress [4]
Use discover_capabilities tool to get full details on any capability.
```

### Tier 1 — Semantic Matches (~200 tokens)

Top-5 capability summaries retrieved by semantic similarity to the current
user message. One-line descriptions, no full schemas.

```
Relevant capabilities for this turn:
1. web-search [tool] — Search the web for current information
2. news-search [tool] — Search recent news articles
3. arxiv-search [tool] — Search academic papers on arXiv
4. web-browser [tool] — Open and read web pages
5. summarize [skill] — Summarize documents into key points
```

### Tier 2 — Full Schemas (~1,500 tokens)

Complete schemas for the top-2 capabilities — parameter names, types,
examples. Only the most relevant tools get full schemas per turn.

```typescript
// discover_capabilities tool schema (always ~80 tokens in tool list)
{
  "name": "discover_capabilities",
  "description": "Search for available tools, skills, and channels by name or intent.",
  "parameters": {
    "query": { "type": "string", "description": "What you want to do" },
    "kind":  { "type": "string", "enum": ["tool", "skill", "channel", "all"] }
  }
}
```

---

## CapabilityDescriptor

The unified shape that normalizes tools, skills, extensions, and channels
into a single searchable type:

```typescript
import type { CapabilityDescriptor } from '@framers/agentos/discovery';

const descriptor: CapabilityDescriptor = {
  // Identity
  id:          'tool:web-search',       // "${kind}:${name}"
  kind:        'tool',                  // 'tool' | 'skill' | 'extension' | 'channel' | 'voice'
  name:        'web-search',
  displayName: 'Web Search',

  // For embedding — describes WHEN and WHY to use it
  description: 'Search the web for current information, news, and facts. Use when the answer requires up-to-date information not in training data.',

  // Classification
  category: 'information',
  tags:     ['search', 'web', 'real-time'],

  // Requirements
  requiredSecrets: ['SERPER_API_KEY'],
  requiredTools:   [],

  // State
  available: true,

  // Source reference (for lazy-loading the full schema)
  sourceRef: { type: 'tool', toolName: 'web_search' },

  // Tier 2 data (full schema — only loaded on demand)
  fullSchema: {
    parameters: {
      type: 'object',
      properties: {
        query:   { type: 'string', description: 'Search query' },
        numResults: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    examples: ['web_search({ query: "AgentOS release date" })'],
  },
};
```

### Capability Kinds

| Kind | Examples |
|------|---------|
| `tool` | web_search, github_create_issue, send_email |
| `skill` | research-assistant, code-reviewer, linkedin-bot |
| `extension` | guardrail packs, provenance adapters |
| `channel` | telegram, discord, slack, whatsapp |
| `voice` | STT/TTS providers, telephony adapters |
| `emergent-tool` | Runtime-generated tools from EmergentEngine |

---

## CapabilityGraph Relationships

The `CapabilityGraph` tracks relationships between capabilities using a
graphology graph. Four edge types:

| Edge Type | Meaning | Example |
|-----------|---------|---------|
| `DEPENDS_ON` | A requires B to be available | `twitter-bot` depends on `web_search` |
| `COMPOSED_WITH` | A and B work together | `web-search` + `summarize` |
| `SAME_CATEGORY` | A and B serve the same category | `telegram` + `discord` |
| `TAGGED_WITH` | A and B share a semantic tag | any two tools tagged `'social'` |

Edges provide **re-ranking boosts**: if `web-search` is a Tier 1 match,
capabilities connected to it by `COMPOSED_WITH` edges receive a score boost
and may surface in Tier 1 or 2 even if they weren't directly retrieved.

```typescript
import { CapabilityGraph } from '@framers/agentos/discovery';

const graph = new CapabilityGraph();

// Declare explicit relationships
graph.addEdge('tool:web-search', 'skill:summarize',       'COMPOSED_WITH', { weight: 0.9 });
graph.addEdge('skill:linkedin-bot', 'tool:web-search',    'DEPENDS_ON',    { weight: 1.0 });
graph.addEdge('channel:telegram',   'channel:whatsapp',   'SAME_CATEGORY', { weight: 0.5 });

// Query neighbors
const related = graph.neighbors('tool:web-search', { edgeTypes: ['COMPOSED_WITH'] });
console.log(related);
// [{ id: 'skill:summarize', weight: 0.9 }]
```

---

## CAPABILITY.yaml Format

Place a `CAPABILITY.yaml` in any directory under `~/.agentos/capabilities/`
to register a custom capability. The `CapabilityManifestScanner` hot-reloads
on file changes.

```yaml
# ~/.agentos/capabilities/my-tool/CAPABILITY.yaml
id: tool:my-custom-search
kind: tool
name: my-custom-search
displayName: My Custom Search
description: >
  Search our internal knowledge base for company-specific information.
  Use when the user asks about internal processes, policies, or documentation.
category: information
tags:
  - search
  - internal
  - knowledge-base
requiredSecrets:
  - MY_SEARCH_API_KEY
requiredTools: []
available: true

# Declared relationships
edges:
  - target: tool:web-search
    type: SAME_CATEGORY
    weight: 0.6

# Full schema (shown in Tier 2 when this capability is a top match)
schema:
  type: object
  properties:
    query:
      type: string
      description: Search query for the internal knowledge base
    department:
      type: string
      enum: [engineering, product, design, finance, hr]
      description: Filter results by department
  required:
    - query

examples:
  - 'my_custom_search({ query: "vacation policy", department: "hr" })'
```

Optionally, place a `SKILL.md` alongside the YAML for full prompt content:

```markdown
<!-- ~/.agentos/capabilities/my-tool/SKILL.md -->
# My Custom Search Skill

You have access to the internal knowledge base search tool.

When answering questions about company policies or internal processes:
1. Search the knowledge base first
2. Cite the relevant policy document
3. If no results, say "I couldn't find that in our documentation"
```

---

## Agent Self-Discovery via Meta-Tool

The `discover_capabilities` meta-tool lets the agent actively search for
capabilities during a conversation — useful when Tier 0/1 passive context
isn't enough.

```typescript
import { createDiscoverCapabilitiesTool } from '@framers/agentos/discovery';
import { CapabilityDiscoveryEngine } from '@framers/agentos/discovery';

const engine = new CapabilityDiscoveryEngine({ /* config */ });
const discoverTool = createDiscoverCapabilitiesTool(engine);

// Register with your agent
const myAgent = agent({
  provider: 'openai',
  tools:    [discoverTool, ...otherTools],
  instructions: 'You have a discover_capabilities tool to find other tools you can use.',
});
```

The agent uses the tool when it needs something not surfaced by passive tiers:

```
User: "Can you post this announcement to our Slack and email the team?"

Agent thinks: I see slack in Tier 1 context, but I need to find the email tool.

Agent calls: discover_capabilities({ query: "send email", kind: "tool" })

Response: Found: send_email [tool] — Send emails via SMTP or SendGrid...

Agent calls: send_email({ to: "team@example.com", subject: "...", body: "..." })
```

---

## Integration with PromptBuilder

The discovery engine integrates directly with `PromptBuilder`:

```typescript
import { CapabilityDiscoveryEngine } from '@framers/agentos/discovery';
import { PromptEngine } from '@framers/agentos';

const discoveryEngine = new CapabilityDiscoveryEngine({
  embeddingManager: myEmbeddingManager,
  vectorStore:      myVectorStore,
  graph:            myCapabilityGraph,
  scanner:          myManifestScanner,
});

// Wire into the prompt engine
const promptEngine = new PromptEngine({
  // ...
  capabilityDiscovery: {
    enabled: true,
    engine:  discoveryEngine,
  },
});

// Each turn, the prompt engine calls:
// discoveryEngine.discover(userMessage) → CapabilityDiscoveryResult
// promptEngine.capabilityDiscoveryResult(result) → injects into system prompt
```

---

## Configuration

```typescript
import { CapabilityDiscoveryEngine } from '@framers/agentos/discovery';

const engine = new CapabilityDiscoveryEngine({
  // Token budgets per tier
  budgets: {
    tier0: 150,    // category summaries (always)
    tier1: 200,    // semantic match summaries
    tier2: 1500,   // full schemas (top-N capabilities)
  },

  // How many results per tier
  topK: {
    tier1: 5,     // top-5 summaries
    tier2: 2,     // top-2 full schemas
  },

  // Graph re-ranking boost weight
  graphBoostWeight: 0.3,

  // Embedding cache (LRU)
  embeddingCacheSize: 1000,

  // Hot-reload manifests on file changes
  watchManifests: true,
  manifestDirs: [
    `${process.env.HOME}/.agentos/capabilities`,
    './capabilities',
  ],
});
```

---

## Related Guides

- [CAPABILITY_DISCOVERY.md](./CAPABILITY_DISCOVERY.md) — full architecture reference
- [TOOL_CALLING_AND_LOADING.md](./TOOL_CALLING_AND_LOADING.md) — registering and using tools
- [SKILLS.md](./SKILLS.md) — SKILL.md prompt modules and registration
- [RFC_EXTENSION_STANDARDS.md](./RFC_EXTENSION_STANDARDS.md) — extension packaging
