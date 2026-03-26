# Agent Config Export & Import

> Round-trip agent configurations between environments with secret redaction, schema validation, and CLI support.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [CLI Commands](#cli-commands)
4. [Programmatic API](#programmatic-api)
5. [Export Formats](#export-formats)
6. [Secret Redaction](#secret-redaction)
7. [Schema Validation](#schema-validation)
8. [Round-Trip Workflow](#round-trip-workflow)
9. [Portable Agent Bundles](#portable-agent-bundles)
10. [Examples](#examples)
11. [Related Documentation](#related-documentation)

---

## Overview

Agent configurations contain everything needed to reproduce an agent:
personality, security tier, LLM provider settings, skills, channels,
extensions, and tool permissions. The export/import system lets you:

- **Share** agent configurations between team members
- **Version** agent configs in Git alongside application code
- **Migrate** agents between environments (dev/staging/prod)
- **Backup** and restore agent state
- **Template** new agents from proven configurations

Secrets (API keys, tokens) are automatically redacted on export and must be
re-supplied on import.

---

## Quick Start

### Export an Agent

```bash
# Export to YAML (default)
wunderland export --output my-agent.yaml

# Export to JSON
wunderland export --format json --output my-agent.json

# Export from a specific config directory
wunderland export --config ~/.wunderland/agents/research-bot --output research-bot.yaml
```

### Import an Agent

```bash
# Import from file
wunderland import my-agent.yaml

# Import to a specific directory
wunderland import my-agent.yaml --target ~/.wunderland/agents/new-agent

# Import with automatic secret prompting
wunderland import my-agent.yaml --prompt-secrets
```

---

## CLI Commands

### `wunderland export`

Export the current agent configuration to a portable file.

```
Usage: wunderland export [options]

Options:
  --output, -o <path>      Output file path (default: stdout)
  --format <yaml|json>     Output format (default: yaml)
  --config <path>          Config directory to export from
  --include-skills         Include resolved skill content (default: false)
  --include-workflows      Include workflow definitions (default: false)
  --no-redact              Skip secret redaction (DANGEROUS — includes raw API keys)
  --pretty                 Pretty-print JSON output (default: true)
```

### `wunderland import`

Import an agent configuration from a file.

```
Usage: wunderland import <file> [options]

Options:
  --target <path>          Target config directory (default: current)
  --prompt-secrets         Interactively prompt for redacted secrets
  --merge                  Merge with existing config instead of replacing
  --dry-run                Show what would change without writing
  --validate-only          Validate the file without importing
  --yes, -y                Skip confirmation prompts
```

---

## Programmatic API

### exportAgentConfig()

```typescript
import { exportAgentConfig } from '@framers/agentos';

const exported = await exportAgentConfig({
  configDir: '~/.wunderland',        // Config directory to read
  format: 'yaml',                     // 'yaml' | 'json'
  includeSkills: false,               // Include resolved SKILL.md content
  includeWorkflows: false,            // Include workflow definitions
  redactSecrets: true,                // Replace secrets with placeholders
});

console.log(exported.content);        // YAML/JSON string
console.log(exported.format);         // 'yaml'
console.log(exported.redactedKeys);   // ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', ...]
console.log(exported.warnings);       // Any validation warnings
```

### importAgent()

```typescript
import { importAgent } from '@framers/agentos';

const result = await importAgent({
  source: './my-agent.yaml',           // File path or string content
  targetDir: '~/.wunderland',          // Where to write the config
  merge: false,                         // Replace (false) or merge (true)
  secrets: {                            // Supply redacted secrets
    OPENAI_API_KEY: 'sk-...',
    ANTHROPIC_API_KEY: 'sk-ant-...',
  },
});

console.log(result.configDir);         // Resolved target directory
console.log(result.changes);           // List of files written
console.log(result.warnings);          // Any import warnings
```

### agent.export() / agent.exportJSON()

Export from an instantiated agent:

```typescript
import { createAgent } from '@framers/agentos';

const agent = await createAgent({ /* ... */ });

// Export as YAML string
const yaml = await agent.export();

// Export as parsed JSON object
const json = await agent.exportJSON();
console.log(json.personality);          // { hexaco: { ... } }
console.log(json.llmProvider);         // "openai"
console.log(json.skills);              // ["research-assistant", "web-search"]
```

---

## Export Formats

### YAML Format (Default)

```yaml
# AgentOS Agent Configuration Export
# Exported: 2026-03-26T12:00:00Z
# Version: 1.0.0

meta:
  exportVersion: "1.0.0"
  agentosVersion: "0.48.0"
  exportedAt: "2026-03-26T12:00:00Z"

agent:
  name: "Research Assistant"
  description: "A research-focused agent with web search and deep analysis"

personality:
  hexaco:
    honestyHumility: 0.85
    emotionality: 0.40
    extraversion: 0.60
    agreeableness: 0.75
    conscientiousness: 0.90
    opennessToExperience: 0.95

llm:
  provider: "anthropic"
  model: "claude-sonnet-4-20250514"
  fallback:
    - "openrouter"

security:
  tier: "balanced"
  executionMode: "deny-side-effects"
  approvedTools:
    - "web-search"
    - "web-browser"
    - "news-search"

skills:
  - "research-assistant"
  - "deep-research"
  - "web-search"

channels:
  - platform: "webchat"
    enabled: true
  - platform: "slack"
    enabled: true

extensions:
  - "web-search"
  - "web-browser"
  - "news-search"

memory:
  type: "cognitive"
  ragEnabled: true
  vectorStore: "hnsw"

secrets:
  ANTHROPIC_API_KEY: "<<REDACTED>>"
  OPENROUTER_API_KEY: "<<REDACTED>>"
  DEEPGRAM_API_KEY: "<<REDACTED>>"
```

### JSON Format

```json
{
  "meta": {
    "exportVersion": "1.0.0",
    "agentosVersion": "0.48.0",
    "exportedAt": "2026-03-26T12:00:00Z"
  },
  "agent": {
    "name": "Research Assistant",
    "description": "A research-focused agent with web search and deep analysis"
  },
  "personality": {
    "hexaco": {
      "honestyHumility": 0.85,
      "emotionality": 0.40,
      "extraversion": 0.60,
      "agreeableness": 0.75,
      "conscientiousness": 0.90,
      "opennessToExperience": 0.95
    }
  },
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "fallback": ["openrouter"]
  },
  "security": {
    "tier": "balanced",
    "executionMode": "deny-side-effects",
    "approvedTools": ["web-search", "web-browser", "news-search"]
  },
  "skills": ["research-assistant", "deep-research", "web-search"],
  "channels": [
    { "platform": "webchat", "enabled": true },
    { "platform": "slack", "enabled": true }
  ],
  "extensions": ["web-search", "web-browser", "news-search"],
  "memory": {
    "type": "cognitive",
    "ragEnabled": true,
    "vectorStore": "hnsw"
  },
  "secrets": {
    "ANTHROPIC_API_KEY": "<<REDACTED>>",
    "OPENROUTER_API_KEY": "<<REDACTED>>",
    "DEEPGRAM_API_KEY": "<<REDACTED>>"
  }
}
```

---

## Secret Redaction

By default, all known secret patterns are replaced with `<<REDACTED>>` on
export. The list of redacted keys includes:

| Pattern | Examples |
|---------|---------|
| `*_API_KEY` | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STABILITY_API_KEY` |
| `*_API_TOKEN` | `REPLICATE_API_TOKEN`, `TELEGRAM_BOT_TOKEN` |
| `*_SECRET` | `SLACK_OAUTH_CLIENT_SECRET`, `WUNDERLAND_INTERNAL_API_SECRET` |
| `*_AUTH_TOKEN` | `TWILIO_AUTH_TOKEN`, `WUNDERLAND_AUTH_TOKEN` |
| `*_PASSWORD` | Database passwords, SMTP passwords |
| `*_PRIVATE_KEY` | Solana private keys, SSH keys |

### Exporting Without Redaction

Use `--no-redact` for trusted environments (e.g., encrypted backup):

```bash
# WARNING: Output will contain raw API keys
wunderland export --no-redact --output backup.yaml
```

### Supplying Secrets on Import

```bash
# Interactive prompting for each redacted secret
wunderland import my-agent.yaml --prompt-secrets

# Supply secrets via environment variables (they're matched by name)
OPENAI_API_KEY=sk-... wunderland import my-agent.yaml

# Supply secrets programmatically
await importAgent({
  source: './my-agent.yaml',
  secrets: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  },
});
```

---

## Schema Validation

Exported configurations are validated against a JSON Schema on both export
and import:

```bash
# Validate without importing
wunderland import my-agent.yaml --validate-only

# Output:
# ✓ Schema version: 1.0.0
# ✓ Required fields: present
# ✓ LLM provider: valid (anthropic)
# ✓ Security tier: valid (balanced)
# ✓ Skills: 3 referenced, all resolvable
# ⚠ Secrets: 3 redacted keys (supply on import)
```

### Programmatic Validation

```typescript
import { validateAgentConfig } from '@framers/agentos';

const result = validateAgentConfig('./my-agent.yaml');

if (result.valid) {
  console.log('Config is valid');
} else {
  for (const error of result.errors) {
    console.error(`${error.path}: ${error.message}`);
  }
}
```

---

## Round-Trip Workflow

A typical workflow for migrating an agent between environments:

```bash
# 1. Export from development
cd ~/dev-agent
wunderland export --output agent-config.yaml

# 2. Commit to version control
git add agent-config.yaml
git commit -m "Export research-assistant config"

# 3. Import on production server
ssh prod-server
git pull
wunderland import agent-config.yaml --prompt-secrets --target /opt/agents/research-bot

# 4. Verify
wunderland doctor --config /opt/agents/research-bot
```

### Team Sharing

```bash
# Developer A: Export and share
wunderland export --output team-agent.yaml --include-skills
# Commit to shared repo

# Developer B: Import and customize
wunderland import team-agent.yaml --merge --prompt-secrets
# The --merge flag preserves local settings while applying shared ones
```

---

## Portable Agent Bundles

For sharing agents with all dependencies (skills, workflows, custom tools),
use the bundle format:

```bash
# Create a self-contained bundle (.tar.gz)
wunderland export --bundle --output my-agent-bundle.tar.gz --include-skills --include-workflows

# The bundle contains:
#   agent-config.yaml        — Main configuration
#   skills/                  — Resolved SKILL.md files
#   workflows/               — Workflow definitions
#   tools/                   — Custom tool definitions
#   MANIFEST.json            — Bundle metadata and checksums
```

### Import a Bundle

```bash
wunderland import my-agent-bundle.tar.gz --target ~/.wunderland/agents/imported
```

---

## Examples

### Export for CI/CD

```typescript
import { exportAgentConfig } from '@framers/agentos';
import { writeFileSync } from 'node:fs';

// Export without secrets for CI
const exported = await exportAgentConfig({
  configDir: './agent-config',
  format: 'json',
  redactSecrets: true,
});

writeFileSync('./deploy/agent-config.json', exported.content);

// In CI, secrets come from environment
// OPENAI_API_KEY, ANTHROPIC_API_KEY, etc. are set as CI secrets
```

### Clone an Agent

```typescript
import { exportAgentConfig, importAgent } from '@framers/agentos';

// Export current agent
const exported = await exportAgentConfig({
  configDir: '~/.wunderland/agents/original',
  format: 'json',
  redactSecrets: false, // Same machine, no need to redact
});

// Import as a new agent with modified settings
const config = JSON.parse(exported.content);
config.agent.name = 'Research Assistant v2';
config.llm.model = 'claude-opus-4-20250514';

await importAgent({
  source: JSON.stringify(config),
  targetDir: '~/.wunderland/agents/research-v2',
});
```

### Diff Two Configs

```bash
# Export both configs and diff
wunderland export --config ./agent-a --format json --output /tmp/a.json
wunderland export --config ./agent-b --format json --output /tmp/b.json
diff /tmp/a.json /tmp/b.json
```

---

## Related Documentation

- [Getting Started](./GETTING_STARTED.md) — Initial agent setup
- [Architecture](./ARCHITECTURE.md) — System architecture overview
- [Skills](./SKILLS.md) — Skill format and discovery
- [Ecosystem](./ECOSYSTEM.md) — AgentOS ecosystem overview
