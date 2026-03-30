---
title: 'Memory Import/Export'
sidebar_position: 22
description: 'Export agent memories to SQLite, JSON, Markdown, or Obsidian vaults, and import from SQLite, JSON, Markdown, Obsidian, ChatGPT exports, and CSV.'
---

> The Memory I/O subsystem provides lossless round-trip serialisation across four export formats and six import formats. JSON round-trips traces, graph rows, documents, chunks, images, conversations, and messages, and trace deduplication is enabled by default on import.

---

## Overview

| Direction | Formats | Use Case |
|-----------|---------|----------|
| **Export** | SQLite, JSON, Markdown, Obsidian | Backup, sharing, human review, Obsidian knowledge management |
| **Import** | SQLite, JSON, Markdown, Obsidian, ChatGPT, CSV | Restore, migrate, ingest existing knowledge, import chat history |

All operations are available via the `Memory` facade API.

---

## Export Formats

### SQLite (Byte-Perfect Backup)

The highest-fidelity export. Uses SQLite's `VACUUM INTO` to produce a clean, self-contained copy of the entire brain database including all traces, embeddings, graph edges, documents, chunks, and consolidation logs.

```ts
await mem.export('./backup.sqlite', { format: 'sqlite' });
```

- Produces an exact copy of the brain file.
- Includes raw embedding BLOBs (no re-embedding needed on import).
- Suitable for disaster recovery, agent cloning, or migration.

### JSON (Programmatic)

A single structured JSON document containing the full portable brain payload. Designed for programmatic consumption, browser-safe transfer, and cross-runtime restore.

```ts
await mem.export('./memories.json', { format: 'json' });

// Optional: include raw embedding vectors (increases file size significantly)
await mem.export('./memories-with-embeddings.json', {
  format: 'json',
  includeEmbeddings: true,
});
```

Each trace entry contains fields like:

```json
{
  "id": "mt_abc123",
  "type": "semantic",
  "scope": "user",
  "content": "User prefers TypeScript over Python",
  "strength": 0.87,
  "tags": ["preference", "language"],
  "emotions": {},
  "metadata": { "source": "user_statement" },
  "createdAt": 1711234567890,
  "lastAccessed": 1711234600000,
  "retrievalCount": 3
}
```

### Markdown (Human-Readable)

Exports each trace as a standalone `.md` file with YAML front-matter. The output directory structure groups traces by type:

```ts
await mem.export('./memory-export', { format: 'markdown' });
```

Produces files like:

```
memory-export/
  episodic/
    mt_abc123.md
    mt_def456.md
  semantic/
    mt_ghi789.md
  procedural/
    mt_jkl012.md
```

Each file:

```markdown
---
id: mt_abc123
type: semantic
scope: user
strength: 0.87
tags:
  - preference
  - language
createdAt: 2024-03-24T12:34:56Z
---

User prefers TypeScript over Python
```

### Obsidian (Wikilinks + Tags)

Extends the Markdown exporter with Obsidian-specific features for integration with Obsidian knowledge vaults:

```ts
await mem.export('./vault', { format: 'obsidian' });
```

Produces:

- `[[wikilinks]]` between related traces (graph edges become internal links).
- `#tags` in the body for every tag on the trace.
- YAML front-matter with all metadata fields.
- Folder structure matching Tulving memory types.

Example output:

```markdown
---
id: mt_abc123
type: semantic
scope: user
strength: 0.87
tags:
  - preference
  - language
---

User prefers TypeScript over Python

#preference #language

## Related
- [[mt_def456]] — deployment preferences
- [[mt_ghi789]] — tooling choices
```

---

## Import Formats

### SQLite

Merges another brain database into the current one. Smart deduplication compares content hashes; conflicting traces are resolved by tag union.

```ts
const result = await mem.importFrom('./backup.sqlite', { format: 'sqlite' });
console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
```

### JSON

Parses a `JsonExporter`-format JSON file and restores traces plus any included graph/document/conversation rows.

```ts
const result = await mem.importFrom('./memories.json', { format: 'json' });
```

### Markdown

Walks a directory of Markdown files with YAML front-matter. Each file becomes one memory trace. The `id`, `type`, `scope`, `tags`, and `strength` fields are read from front-matter; the body becomes the trace content.

```ts
const result = await mem.importFrom('./notes/', { format: 'markdown' });
```

### Obsidian Vault

Extends the Markdown importer with Obsidian-specific parsing:

```ts
const result = await mem.importFrom('./my-vault/', { format: 'obsidian' });
```

- `[[wikilinks]]` are parsed and converted to knowledge graph edges between traces.
- YAML front-matter fields are mapped to trace metadata.
- `#tags` in the body are extracted and added to the trace's tag array.
- Folder structure is used to infer memory type when not specified in front-matter.

### ChatGPT Export

Imports from ChatGPT's `conversations.json` export file. Each user/assistant message pair becomes an episodic memory trace:

```ts
const result = await mem.importFrom('./conversations.json', { format: 'chatgpt' });
```

- Conversation titles become trace tags.
- Each message pair (user question + assistant answer) becomes one episodic trace.
- Timestamps from the export are preserved as `createdAt`.
- Long conversations produce many traces, which can then be consolidated via `mem.consolidate()`.

### CSV

Imports flat CSV files. Requires a `content` column; all other columns are treated as metadata:

```ts
const result = await mem.importFrom('./knowledge-base.csv', { format: 'csv' });
```

Expected CSV structure:

```csv
content,type,tags
"User prefers dark mode",semantic,"preference,ui"
"Deploy with Docker Compose",procedural,"deployment,docker"
```

---

## SHA-256 Deduplication

All import paths use SHA-256 content hashing to prevent duplicate traces:

1. Before inserting a new trace, the importer computes `SHA-256(content)`.
2. The hash is compared against existing traces in the `memory_traces.metadata` JSON column (field: `import_hash`).
3. If a matching hash exists with the same `type` and `scope`, the trace is skipped.
4. Deduplication is enabled by default (`dedup: true`) and can be disabled per-import.

```ts
// Disable dedup (allows duplicate content)
const result = await mem.importFrom('./data.json', {
  format: 'json',
  dedup: false,
});
```

---

## ImportResult

Every import operation returns a summary:

```ts
interface ImportResult {
  imported: number;  // Traces successfully written
  skipped: number;   // Traces skipped (dedup or format mismatch)
  errors: string[];  // Human-readable error messages for failures
}
```

---

## ExportOptions Reference

```ts
interface ExportOptions {
  /** Serialisation format. Default: 'json'. */
  format?: 'sqlite' | 'json' | 'markdown' | 'obsidian';

  /** Include raw embedding vectors. Default: false. */
  includeEmbeddings?: boolean;

  /** Include conversation turn traces. Default: true. */
  includeConversations?: boolean;
}
```

## ImportOptions Reference

```ts
interface ImportOptions {
  /** Source format. Default: 'auto' (detect from extension/magic bytes). */
  format?: 'auto' | 'sqlite' | 'json' | 'markdown' | 'obsidian' | 'chatgpt' | 'csv';

  /** Skip traces whose content hash already exists. Default: true. */
  dedup?: boolean;
}
```

---

## Source Files

| File | Purpose |
|------|---------|
| `memory/io/JsonExporter.ts` | JSON export (NDJSON or array) |
| `memory/io/JsonImporter.ts` | JSON import with dedup |
| `memory/io/MarkdownExporter.ts` | Markdown directory export with YAML front-matter |
| `memory/io/MarkdownImporter.ts` | Markdown directory import |
| `memory/io/ObsidianExporter.ts` | Obsidian vault export (wikilinks + tags) |
| `memory/io/ObsidianImporter.ts` | Obsidian vault import (wikilinks -> graph edges) |
| `memory/io/SqliteExporter.ts` | `VACUUM INTO` byte-perfect backup |
| `memory/io/SqliteImporter.ts` | SQLite merge with smart dedup + tag union |
| `memory/io/ChatGptImporter.ts` | ChatGPT `conversations.json` parser |
| `memory/io/CsvImporter.ts` | CSV import with required `content` column |
