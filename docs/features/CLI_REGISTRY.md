# CLI Registry

The CLI Registry is AgentOS's auto-discovery system for installed command-line tools. It scans the user's PATH for known binaries, detects versions, and exposes results to providers, extensions, and the capability discovery engine.

## Overview

AgentOS ships with a JSON-based registry of 54 CLI descriptors across 8 categories. At startup (or on demand), the `CLIRegistry` runs `which` + `--version` for each registered binary in parallel, producing a scan result that tells the runtime exactly what's available on the host machine.

This powers:
- **LLM provider auto-detection** -- `ClaudeCodeCLIBridge` and `GeminiCLIBridge` check if their binary is installed before attempting subprocess calls.
- **`wunderland doctor`** -- health-check output includes detected CLIs.
- **Capability discovery** -- the discovery engine indexes installed tools as capabilities agents can reference.
- **cli-executor extension** -- `shell_execute` relies on the host having the right binaries.

## Registry Categories

The 54 bundled descriptors live in `src/sandbox/subprocess/registry/` as plain JSON files:

| File | Category | Count | Examples |
|------|----------|-------|----------|
| `llm.json` | llm | 5 | claude, gemini, ollama, lmstudio, aichat |
| `devtools.json` | devtools | 10 | git, gh, docker, docker-compose, kubectl, terraform, make, jq, yq, tmux |
| `runtimes.json` | runtime | 8 | node, python3, deno, bun, ruby, go, rustc, java |
| `package-managers.json` | package-manager | 7 | npm, pnpm, yarn, pip, uv, brew, cargo |
| `cloud.json` | cloud | 9 | gcloud, aws, az, flyctl, vercel, netlify, railway, heroku, wrangler |
| `databases.json` | database | 5 | psql, mysql, sqlite3, redis-cli, mongosh |
| `media.json` | media | 5 | ffmpeg, ffprobe, magick, sox, yt-dlp |
| `networking.json` | networking | 5 | curl, wget, ssh, rsync, scp |

## CLIDescriptor Shape

Each JSON entry conforms to the `CLIDescriptor` interface:

```typescript
interface CLIDescriptor {
  /** Binary name on PATH (e.g. 'claude', 'docker', 'ffmpeg'). */
  binaryName: string;
  /** Human-readable display name. */
  displayName: string;
  /** What this CLI does. */
  description: string;
  /** Category for grouping (e.g. 'llm', 'media', 'devtools'). */
  category: string;
  /** How to install if missing. */
  installGuidance: string;
  /** Version flag override if not --version. */
  versionFlag?: string;
  /** Regex to parse version from output (default: /(\d+\.\d+\.\d+)/). */
  versionPattern?: RegExp;
}
```

Example from `cloud.json`:

```json
{
  "binaryName": "gcloud",
  "displayName": "Google Cloud SDK",
  "description": "Google Cloud resource management",
  "category": "cloud",
  "installGuidance": "https://cloud.google.com/sdk/docs/install",
  "versionFlag": "--version"
}
```

## CLIRegistry API

```typescript
import { CLIRegistry, WELL_KNOWN_CLIS } from '@framers/agentos/sandbox/subprocess';
```

### Constructor

```typescript
const registry = new CLIRegistry();           // loads bundled JSON descriptors
const empty    = new CLIRegistry(false);       // starts empty (no defaults)
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `register(descriptor)` | `void` | Register a single CLI descriptor. Overwrites existing entry for same `binaryName`. |
| `registerAll(descriptors)` | `void` | Register multiple descriptors at once. |
| `unregister(binaryName)` | `boolean` | Remove a descriptor by binary name. |
| `scan()` | `Promise<CLIScanResult[]>` | Scan PATH for all registered CLIs (parallel `which` + `--version`). |
| `check(binaryName)` | `Promise<CLIScanResult>` | Check a single binary by name. |
| `list()` | `CLIDescriptor[]` | Get all registered descriptors (installed status unknown). |
| `installed()` | `Promise<CLIScanResult[]>` | Get only CLIs that are installed. |
| `byCategory(category)` | `Promise<CLIScanResult[]>` | Get CLIs by category (scans first). |
| `categories()` | `string[]` | Get all unique categories. |
| `has(binaryName)` | `boolean` | Check if a binary is registered (not whether installed). |
| `get(binaryName)` | `CLIDescriptor \| undefined` | Get a descriptor by binary name. |
| `size` | `number` | Total number of registered descriptors. |

### CLIScanResult

The result from `scan()` or `check()` extends `CLIDescriptor`:

```typescript
interface CLIScanResult extends CLIDescriptor {
  installed: boolean;         // whether the binary was found on PATH
  binaryPath?: string;        // resolved absolute path (e.g. /usr/local/bin/node)
  version?: string;           // parsed version string (e.g. "22.4.0")
}
```

## Adding Custom CLIs

### Option 1: Edit JSON (permanent)

Add a new entry to an existing category file, or create a new `*.json` file in `src/sandbox/subprocess/registry/`:

```json
[
  {
    "binaryName": "my-tool",
    "displayName": "My Tool",
    "description": "Internal deployment CLI",
    "category": "devtools",
    "installGuidance": "brew install my-tool"
  }
]
```

### Option 2: Register at runtime (dynamic)

```typescript
const registry = new CLIRegistry();

registry.register({
  binaryName: 'my-tool',
  displayName: 'My Tool',
  description: 'Internal deployment CLI',
  category: 'devtools',
  installGuidance: 'brew install my-tool',
});

const result = await registry.check('my-tool');
if (result.installed) {
  console.log(`my-tool v${result.version} at ${result.binaryPath}`);
}
```

### Option 3: Full scan with custom CLIs

```typescript
const registry = new CLIRegistry();

// Add several custom CLIs
registry.registerAll([
  { binaryName: 'tsc', displayName: 'TypeScript', description: 'TS compiler', category: 'devtools', installGuidance: 'npm i -g typescript' },
  { binaryName: 'eslint', displayName: 'ESLint', description: 'JS linter', category: 'devtools', installGuidance: 'npm i -g eslint' },
]);

// Scan everything (bundled + custom)
const results = await registry.scan();
for (const r of results) {
  const status = r.installed ? `v${r.version}` : 'not installed';
  console.log(`${r.displayName.padEnd(24)} ${status}`);
}

// Filter by category
const llmClis = await registry.byCategory('llm');
console.log(`LLM CLIs found: ${llmClis.filter(c => c.installed).length}/${llmClis.length}`);
```

## Integration with CLISubprocessBridge

The `CLISubprocessBridge` is an abstract base class for managing CLI subprocesses. It handles spawning, stdin piping, NDJSON stream parsing, timeouts, and abort signals. Subclasses implement CLI-specific flag assembly and error classification.

Two production bridges extend it:

| Bridge | Binary | Purpose |
|--------|--------|---------|
| `ClaudeCodeCLIBridge` | `claude` | Anthropic Claude via Max subscription (no API key needed) |
| `GeminiCLIBridge` | `gemini` | Google Gemini via Google account login (no API key needed) |

Both bridges use `checkBinaryInstalled()` (which internally runs `which` + `--version`) before attempting LLM calls, and fall back gracefully when the binary is missing.

### Creating a custom bridge

```typescript
import { CLISubprocessBridge } from '@framers/agentos/sandbox/subprocess';
import { CLISubprocessError, CLI_ERROR } from '@framers/agentos/sandbox/subprocess';

class MyToolBridge extends CLISubprocessBridge {
  protected readonly binaryName = 'mytool';

  protected buildArgs(options, format) {
    return ['--prompt', options.prompt, '--format', format];
  }

  protected classifyError(error) {
    if (error.code === 'ENOENT') {
      return new CLISubprocessError(
        'mytool not found',
        CLI_ERROR.BINARY_NOT_FOUND,
        'mytool',
        'Install: brew install mytool',
        false,
      );
    }
    return new CLISubprocessError(
      error.message,
      CLI_ERROR.CRASHED,
      'mytool',
      'Check mytool logs',
      true,
    );
  }

  protected parseStreamEvent(raw) {
    if (raw.text) return { type: 'text_delta', text: raw.text };
    if (raw.done) return { type: 'result', result: raw.output };
    return null;
  }
}
```

## Integration with cli-executor Extension

The `cli-executor` extension pack (`@framers/agentos-ext-cli-executor`) provides tools that let agents execute arbitrary shell commands on the host. While it does not import `CLIRegistry` directly, the two systems are complementary:

- **CLIRegistry** answers "what binaries exist?" -- discovery and detection.
- **cli-executor** answers "can the agent run this command?" -- execution with security guardrails.

When the wunderland runtime loads the cli-executor extension, it configures filesystem roots, security checks, and the `dangerouslySkipSecurityChecks` flag based on the active security tier. See the [Wunderland CLI Tools doc](../../../wunderland/docs/features/CLI_TOOLS.md) for details.

## Security Considerations

The CLI Registry itself is read-only and does not execute commands beyond `which` and `--version`. However, downstream consumers should respect the active security tier:

| Security Tier | CLI Execution | File Writes | External APIs |
|--------------|---------------|-------------|---------------|
| `dangerous` | Allowed | Allowed | Allowed |
| `permissive` | Allowed | Allowed | Allowed |
| `balanced` | Allowed | Blocked | Allowed |
| `strict` | Blocked | Blocked | Allowed |
| `paranoid` | Blocked | Blocked | Blocked |

The `balanced` tier is the recommended default. It permits CLI execution but blocks file writes unless the agent requests folder access through the HITL approval flow.

## Error Handling

The `CLISubprocessError` class provides structured errors with actionable guidance:

```typescript
import { CLISubprocessError, CLI_ERROR } from '@framers/agentos/sandbox/subprocess';

// Common error codes:
CLI_ERROR.BINARY_NOT_FOUND   // Binary not found on PATH
CLI_ERROR.NOT_AUTHENTICATED  // Binary installed but not logged in
CLI_ERROR.VERSION_OUTDATED   // Version too old for required features
CLI_ERROR.SPAWN_FAILED       // Process failed to start
CLI_ERROR.TIMEOUT            // Process exceeded timeout
CLI_ERROR.CRASHED            // Non-zero exit code
CLI_ERROR.RATE_LIMITED       // Rate limit / quota exceeded
CLI_ERROR.PERMISSION_DENIED  // EACCES
CLI_ERROR.CONTEXT_TOO_LONG   // Input too long for the CLI
```

Each error carries a `guidance` string with human-readable fix instructions and a `recoverable` flag indicating whether retry/fallback is appropriate.

## Exports

Everything is exported from the barrel at `@framers/agentos/sandbox/subprocess`:

```typescript
export { CLISubprocessBridge } from './CLISubprocessBridge';
export { CLIRegistry, WELL_KNOWN_CLIS } from './CLIRegistry';
export { CLISubprocessError, CLI_ERROR } from './errors';
export type {
  BridgeOptions,
  BridgeResult,
  StreamEvent,
  OutputFormat,
  InstallCheckResult,
  CLIDescriptor,
  CLIScanResult,
} from './types';
```
