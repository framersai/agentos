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

### [@framers/agentos-extensions](https://github.com/framersai/agentos-extensions)
**Extensions Registry** — Community registry of tools, workflows, guardrails, and integrations.

```bash
npm install @framers/agentos-extensions
```

[![npm](https://img.shields.io/npm/v/@framers/agentos-extensions?logo=npm&color=cb3837)](https://www.npmjs.com/package/@framers/agentos-extensions)
[![GitHub](https://img.shields.io/github/stars/framersai/agentos-extensions?style=social)](https://github.com/framersai/agentos-extensions)

**Extension Types:**
- **Tools** — Custom agent capabilities
- **Guardrails** — Safety and validation rules
- **Workflows** — Multi-step process definitions
- **Personas** — Agent personality templates
- **Memory Providers** — Custom storage backends

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

## Quick Links

| Resource | Link |
|----------|------|
| Documentation | [agentos.sh/docs](https://agentos.sh/docs) |
| API Reference | [agentos-live-docs branch](https://github.com/framersai/agentos/tree/agentos-live-docs) |
| npm | [@framers/agentos](https://www.npmjs.com/package/@framers/agentos) |
| Discord | [Join Community](https://discord.gg/agentos) |
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
