# AgentOS Ecosystem

> Related repositories, packages, and resources for building with AgentOS.

---

## Core Packages

### [@framers/agentos](https://github.com/framersai/agentos)
**Main SDK** — The core orchestration runtime for building adaptive AI agents.

```bash
npm install @framers/agentos
```

[![npm](https://img.shields.io/npm/v/@framers/agentos?logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos)
[![GitHub](https://img.shields.io/github/stars/framersai/agentos?style=social)](https://github.com/framersai/agentos)

---

### [@framers/sql-storage-adapter](https://github.com/framersai/sql-storage-adapter)
**SQL Storage** — Cross-platform SQL storage abstraction with automatic fallbacks. Supports SQLite, PostgreSQL, and in-memory storage.

```bash
npm install @framers/sql-storage-adapter
```

[![npm](https://img.shields.io/npm/v/@framers/sql-storage-adapter?logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/sql-storage-adapter)
[![GitHub](https://img.shields.io/github/stars/framersai/sql-storage-adapter?style=social)](https://github.com/framersai/sql-storage-adapter)

**Features:**
- SQLite (better-sqlite3, sql.js for browser)
- PostgreSQL (pg)
- Automatic runtime detection
- Vector storage support for RAG

---

### [@framers/agentos-extensions-registry](https://github.com/framersai/agentos-extensions)
**Curated Extensions Registry** — Load all official extensions with a single `createCuratedManifest()` call. Handles lazy loading, secret resolution, and factory invocation.

```bash
npm install @framers/agentos-extensions-registry
```

[![npm](https://img.shields.io/npm/v/@framers/agentos-extensions-registry?logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos-extensions-registry)
[![GitHub](https://img.shields.io/github/stars/framersai/agentos-extensions?style=social)](https://github.com/framersai/agentos-extensions)

```typescript
import { createCuratedManifest } from '@framers/agentos-extensions-registry';

const manifest = await createCuratedManifest({
  tools: 'all',
  channels: 'none',
  secrets: { 'serper.apiKey': process.env.SERPER_API_KEY! },
});

const agentos = new AgentOS();
await agentos.initialize({ extensionManifest: manifest });
```

Only installed extension packages will load — missing ones are skipped silently.

---

### [@framers/agentos-extensions](https://github.com/framersai/agentos-extensions)
**Extension Source** — Implementations, templates, and manifests for tools, channel adapters, and integrations. The `agentos-extensions-registry` package catalogs and loads these.

```bash
npm install @framers/agentos-extensions
```

[![npm](https://img.shields.io/npm/v/@framers/agentos-extensions?logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos-extensions)

**Available Extensions:**

| Category | Extensions |
|----------|-----------|
| **Research** | web-search, web-browser, news-search |
| **Media** | giphy, image-search, speech-runtime, voice-synthesis |
| **System** | cli-executor, auth |
| **Integrations** | telegram, telegram-bot |
| **Provenance** | anchor-providers, tip-ingestion |
| **Channels** | telegram, whatsapp, discord, slack, webchat |

---

### [@framers/agentos-skills-registry](https://github.com/framersai/agentos-skills-registry)
**Curated Skills Catalog SDK** — typed catalog (SKILLS_CATALOG), query helpers, and lazy-loading factories for `SkillRegistry` and snapshots.

```bash
npm install @framers/agentos-skills-registry
```

```typescript
// Lightweight catalog queries (zero peer deps)
import { searchSkills, getSkillsByCategory } from '@framers/agentos-skills-registry/catalog';

// Full registry with lazy-loaded @framers/agentos
import { createCuratedSkillSnapshot } from '@framers/agentos-skills-registry';
const snapshot = await createCuratedSkillSnapshot({ skills: ['github', 'weather'] });
```

---

### [@framers/agentos-skills](https://github.com/framersai/agentos-skills)
**Skills Content** — 69 curated SKILL.md prompt modules + `registry.json` index.

```bash
npm install @framers/agentos-skills
```

This is the content package for skills. The runtime engine (SkillLoader, SkillRegistry, path utilities) now lives in `@framers/agentos/skills`.

```
@framers/agentos/skills               <- Engine (SkillLoader, SkillRegistry, path utils)
@framers/agentos-skills               <- Content (69 SKILL.md files + registry.json)
@framers/agentos-skills-registry      <- Catalog SDK (SKILLS_CATALOG, query helpers, factories)
```

---

## Applications

### [agentos.sh](https://github.com/framersai/agentos.sh)
**Documentation Website** — Official documentation and marketing site.

🌐 **Live:** [agentos.sh](https://agentos.sh)

---

### [agentos-workbench](https://github.com/framersai/agentos-workbench)
**Development Workbench** — Visual development environment for building and testing AgentOS agents.

**Features:**
- Interactive agent playground
- Tool testing interface
- Conversation history viewer
- Real-time streaming visualization

---

### [Wunderland](https://wunderland.sh)
**Autonomous Agent Network + SDK** — A social network layer for agents (identity, tips, governance) plus a TypeScript SDK built on AgentOS.

```bash
npm install wunderland
```

**Docs:** https://docs.wunderland.sh  
**Rabbit Hole (control plane):** https://rabbithole.inc (self-hosted runtime by default; managed runtime is enterprise)

---

## Quick Links

| Resource | Link |
|----------|------|
| Documentation | [agentos.sh/docs](https://agentos.sh/docs) |
| API Reference | [agentos-live-docs branch](https://github.com/framersai/agentos/tree/agentos-live-docs) |
| npm | [@framers/agentos](https://www.npmjs.com/package/@framers/agentos) |
| Discord | [Join Community](https://discord.gg/VXXC4SJMKh) |
| Twitter | [@framersai](https://twitter.com/framersai) |

---

## Contributing

We welcome contributions to any repository in the ecosystem:

1. **Bug reports** — [Open an issue](https://github.com/framersai/agentos/issues)
2. **Feature requests** — [Start a discussion](https://github.com/framersai/agentos/discussions)
3. **Extensions** — Submit to [agentos-extensions](https://github.com/framersai/agentos-extensions)
4. **Documentation** — PRs welcome on any repo

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Application                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    @framers/agentos                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   AgentOS   │  │     GMI     │  │   Tool Orchestrator │  │
│  │   Runtime   │  │   Manager   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ sql-storage-    │  │    agentos-     │  │   LLM Providers │
│ adapter         │  │    extensions   │  │  (OpenAI, etc.) │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

<p align="center">
  <sub>Part of the <a href="https://agentos.sh">AgentOS</a> ecosystem by <a href="https://frame.dev">Frame.dev</a></sub>
</p>
