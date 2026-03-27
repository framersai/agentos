# Skills (SKILL.md)

AgentOS supports **skills**: modular prompt modules defined by a `SKILL.md` file.

Skills are intended to complement tools/extensions:

- **Tools** are atomic operations (`ITool`) that the runtime can execute.
- **Skills** are higher-level instructions/workflows injected into the agent’s prompt.

## File format

Each skill lives in its own folder containing `SKILL.md`:

```md
---
name: github
description: Use the GitHub CLI (gh) for issues, PRs, and repos.
metadata:
  agentos:
    emoji: "🐙"
    primaryEnv: GITHUB_TOKEN
    requires:
      bins: ["gh"]
    install:
      - id: brew
        kind: brew
        formula: gh
        bins: ["gh"]
---

# GitHub (gh CLI)

Use the `gh` CLI to interact with GitHub repositories.
```

## Runtime API

Load skills from one or more directories:

```ts
import { SkillRegistry } from '@framers/agentos/skills';

const registry = new SkillRegistry();
await registry.loadFromDirs(['./skills']);

const snapshot = registry.buildSnapshot({ platform: process.platform });
console.log(snapshot.prompt);
```

## Curated registry (optional)

- `@framers/agentos-skills-registry` — 40 curated SKILL.md files + typed catalog + helpers to load and build snapshots

The curated bundle currently includes **40 skills** spanning developer tools, productivity, information, communication, memory, and voice. See `@framers/agentos-skills-registry/registry.json` for the canonical list.

`@framers/agentos-skills-registry` supports two usage modes:

- Lightweight catalog queries (no `@framers/agentos` peer dependency)
- Factory helpers that **lazy-load** `@framers/agentos/skills` only when called (to build a `SkillRegistry` or snapshot)

Agents can discover curated skills via the **Capability Discovery Engine** (`@framers/agentos/discovery`), which indexes them as `CapabilityDescriptor` entries with `kind: ‘skill’`. The `SkillRegistry` from `@framers/agentos-skills` provides `skills_list`, `skills_read`, `skills_enable`, `skills_status`, and `skills_install` tools directly.

## Agentic discovery

Skills are discoverable at runtime via:

- `@framers/agentos-skills` — exposes `skills_list`, `skills_read`, `skills_enable`, `skills_status`, and `skills_install` tools via `SkillRegistry`.
- `@framers/agentos-skills-registry` — curated catalog queried by `SkillRegistry`.
