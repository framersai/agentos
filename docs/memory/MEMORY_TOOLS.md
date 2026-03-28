---
title: 'Agent Memory Tools'
sidebar_position: 24
description: 'Reference for the 6 agent-facing memory tools (memory_add, memory_update, memory_delete, memory_merge, memory_search, memory_reflect) that let agents manage their own long-term memory.'
---

> Six ITool implementations let agents read, write, search, and consolidate their own memory traces at runtime. Register them as a pack or individually.

---

## Overview

| Tool | Name | Description | Side Effects |
|------|------|-------------|-------------|
| `MemoryAddTool` | `memory_add` | Store a new memory trace | Write |
| `MemoryUpdateTool` | `memory_update` | Update content or tags of an existing trace | Write |
| `MemoryDeleteTool` | `memory_delete` | Soft-delete a trace by ID | Write |
| `MemoryMergeTool` | `memory_merge` | Merge multiple traces into one | Write |
| `MemorySearchTool` | `memory_search` | FTS5 full-text search over traces | Read-only |
| `MemoryReflectTool` | `memory_reflect` | Trigger on-demand consolidation | Write |

All tools implement the `ITool` interface and belong to the `memory` category.

---

## Registration

### Extension Pack (Recommended)

```ts
import { createMemoryToolsPack, Memory } from '@framers/agentos';

const memory = await Memory.create({ path: './brain.sqlite', selfImprove: true });

// Register all 6 tools at once
for (const tool of memory.createTools()) {
  await agentos.getToolOrchestrator().registerTool(tool);
}
```

### Via AgentOS Initialize

```ts
import { AgentOS, Memory } from '@framers/agentos';

const memory = await Memory.create({ path: './brain.sqlite', selfImprove: true });
const agentos = new AgentOS();

await agentos.initialize({
  memoryTools: {
    memory,
    includeReflect: true,     // Include memory_reflect tool
    identifier: 'primary-memory-tools',
    manageLifecycle: true,    // AgentOS closes Memory on shutdown
  },
});
```

### Extension-Based Registration

```ts
await agentos.getExtensionManager().loadPackFromFactory(
  createMemoryToolsPack(memory),
  'memory-tools',
);
```

---

## Tool Reference

### `memory_add`

Store a new memory trace in the agent's brain database.

**Input Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | `string` | Yes | --- | The text content to remember |
| `type` | `string` | No | `'episodic'` | Tulving memory type: `episodic`, `semantic`, `procedural`, `prospective` |
| `scope` | `string` | No | `'user'` | Visibility scope: `thread`, `user`, `persona`, `organization` |
| `tags` | `string[]` | No | `[]` | Free-form tags for filtering |

**Output:**

```json
{ "traceId": "mt_abc123-def4-5678-9abc-def012345678" }
```

**Behaviour:**
- Creates a trace with strength 1.0 (full encoding strength at creation time).
- Computes SHA-256 content hash for deduplication --- if an identical trace exists with the same type and scope, the existing trace ID is returned instead.
- ID format: `mt_<UUID>` (crypto.randomUUID for collision safety).
- The trace is indexed in FTS5 and optionally added to the memory graph.

**Example:**

```json
{
  "name": "memory_add",
  "arguments": {
    "content": "User prefers dark mode and TypeScript.",
    "type": "semantic",
    "tags": ["preference", "ui", "language"]
  }
}
```

---

### `memory_update`

Update the content or tags of an existing memory trace.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `traceId` | `string` | Yes | ID of the trace to update |
| `content` | `string` | No | New text content (replaces old) |
| `tags` | `string[]` | No | New tags array (replaces old) |

**Output:**

```json
{ "updated": true }
```

**Behaviour:**
- Locates the trace by ID in `memory_traces`.
- Updates only the specified fields (content, tags, or both).
- Recomputes the content hash if content changed.
- Re-syncs the FTS5 index entry.
- Returns `{ "updated": false }` if the trace was not found.

**Example:**

```json
{
  "name": "memory_update",
  "arguments": {
    "traceId": "mt_abc123-def4-5678-9abc-def012345678",
    "content": "User prefers dark mode, TypeScript, and VS Code.",
    "tags": ["preference", "ui", "language", "editor"]
  }
}
```

---

### `memory_delete`

Soft-delete a memory trace by ID.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `traceId` | `string` | Yes | ID of the trace to delete |

**Output:**

```json
{ "deleted": true }
```

**Behaviour:**
- Sets `deleted = 1` on the trace (soft-delete, not physical removal).
- Soft-deleted traces are excluded from search results and retrieval.
- The trace remains in the database for audit/provenance purposes.
- Returns `{ "deleted": false }` if the trace was not found.

**Example:**

```json
{
  "name": "memory_delete",
  "arguments": {
    "traceId": "mt_abc123-def4-5678-9abc-def012345678"
  }
}
```

---

### `memory_merge`

Merge multiple memory traces into a single consolidated trace.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `traceIds` | `string[]` | Yes | IDs of traces to merge (minimum 2) |
| `content` | `string` | No | Override content for the merged trace (if omitted, content is concatenated) |

**Output:**

```json
{
  "mergedTraceId": "mt_new-merged-id",
  "sourcesDeleted": 3
}
```

**Behaviour:**
- Creates a new trace combining the content of all source traces.
- Tags from all source traces are unioned.
- Source traces are soft-deleted with a reference to the merged trace.
- The merged trace inherits the highest strength among the sources.
- Knowledge graph edges from source traces are re-pointed to the merged trace.

**Example:**

```json
{
  "name": "memory_merge",
  "arguments": {
    "traceIds": ["mt_aaa", "mt_bbb", "mt_ccc"],
    "content": "User's deployment preferences: Docker Compose, blue-green strategy, Friday deploys."
  }
}
```

---

### `memory_search`

Full-text search over memory traces using the FTS5 index with BM25 ranking.

**Input Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | `string` | Yes | --- | Full-text search query |
| `type` | `string` | No | --- | Filter by memory type |
| `scope` | `string` | No | --- | Filter by visibility scope |
| `limit` | `number` | No | `10` | Maximum results to return |

**Output:**

```json
{
  "results": [
    {
      "id": "mt_abc123",
      "content": "User prefers dark mode and TypeScript.",
      "type": "semantic",
      "scope": "user",
      "strength": 0.87,
      "tags": ["preference", "ui"]
    }
  ]
}
```

**Behaviour:**
- Queries the `memory_traces_fts` FTS5 virtual table.
- Results are ranked by BM25 relevance score.
- Only active traces are returned (soft-deleted traces are excluded).
- Optional `type` and `scope` filters are applied via SQL WHERE clauses on the join.
- Natural language queries are automatically converted to FTS5 syntax.

### FTS5 Query Syntax

The tool accepts natural language queries which are internally converted to FTS5 format. You can also use FTS5 operators directly:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `word` | Match any form (Porter stemming) | `deploy` matches "deployment", "deployed" |
| `"phrase query"` | Exact phrase match | `"dark mode"` |
| `word1 AND word2` | Both terms required | `docker AND compose` |
| `word1 OR word2` | Either term | `typescript OR javascript` |
| `word1 NOT word2` | Exclude term | `deploy NOT staging` |
| `prefix*` | Prefix match | `type*` matches "typescript", "types" |

**Example:**

```json
{
  "name": "memory_search",
  "arguments": {
    "query": "deployment preferences",
    "type": "semantic",
    "limit": 5
  }
}
```

---

### `memory_reflect`

Trigger on-demand memory consolidation --- the analogue of slow-wave sleep. Runs the full 6-step ConsolidationLoop.

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | `string` | No | Reserved for future topic-scoped consolidation (currently ignored) |

**Output:**

```json
{
  "pruned": 3,
  "merged": 1,
  "derived": 0,
  "compacted": 2,
  "durationMs": 42
}
```

**Behaviour:**

Runs the 6 consolidation steps in order:

1. **Prune** --- soft-delete traces below strength threshold (default 0.05).
2. **Merge** --- deduplicate near-identical traces (similarity > 0.95).
3. **Strengthen** --- record Hebbian co-activation edges from retrieval feedback.
4. **Derive** --- synthesise insight traces from memory clusters (LLM-backed, skipped if no LLM).
5. **Compact** --- promote old high-retrieval episodic traces to semantic type.
6. **Re-index** --- rebuild FTS5 index and log run to `consolidation_log`.

If a consolidation cycle is already in progress (mutex), returns immediately with zero counts.

**Example:**

```json
{
  "name": "memory_reflect",
  "arguments": {}
}
```

---

## When Agents Should Use Each Tool

| Situation | Recommended Tool |
|-----------|-----------------|
| Agent learns a new fact about the user | `memory_add` with `type: 'semantic'` |
| Agent wants to record a conversation event | `memory_add` with `type: 'episodic'` |
| Agent discovers a previous memory is outdated | `memory_update` to correct the content |
| Agent finds a memory is wrong or harmful | `memory_delete` to soft-remove it |
| Agent notices several memories say the same thing | `memory_merge` to consolidate them |
| Agent needs to look up what it knows about a topic | `memory_search` with relevant keywords |
| Agent has been running for a while and wants to clean up | `memory_reflect` to trigger consolidation |
| Agent needs to remember a future task | `memory_add` with `type: 'prospective'` |

---

## Source Files

| File | Purpose |
|------|---------|
| `memory/tools/MemoryAddTool.ts` | `memory_add` implementation |
| `memory/tools/MemoryUpdateTool.ts` | `memory_update` implementation |
| `memory/tools/MemoryDeleteTool.ts` | `memory_delete` implementation |
| `memory/tools/MemoryMergeTool.ts` | `memory_merge` implementation |
| `memory/tools/MemorySearchTool.ts` | `memory_search` implementation |
| `memory/tools/MemoryReflectTool.ts` | `memory_reflect` implementation |
| `memory/tools/index.ts` | Barrel exports for all tools |
| `memory/tools/scopeContext.ts` | Scope ID resolution from execution context |
