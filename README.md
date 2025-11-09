<div align="center">

![AgentOS](assets/agentos-primary-transparent-2x.png)

[![NPM Version](https://img.shields.io/npm/v/@agentos/core?logo=npm)](https://www.npmjs.com/package/@agentos/core)
[![CI](https://github.com/framersai/agentos/actions/workflows/ci.yml/badge.svg)](https://github.com/framersai/agentos/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/framersai/agentos/branch/main/graph/badge.svg)](https://codecov.io/gh/framersai/agentos)
[![Website](https://img.shields.io/badge/Website-agentos.sh-00d4ff)](https://agentos.sh)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

### Modular orchestration runtime for adaptive AI systems

[Documentation](https://agentos.sh/docs) • [GitHub](https://github.com/framersai/agentos) • [NPM](https://www.npmjs.com/package/@agentos/core)

</div>

<p align="center">
  <a href="https://frame.dev" target="_blank" rel="noopener noreferrer">
    <img src="../../logos/frame-wordmark.svg" alt="Frame.dev" height="28" />
  </a>
  <br />
  <em>We are the Framers.</em>
  · <a href="https://frame.dev" target="_blank" rel="noopener noreferrer">Visit Frame.dev →</a>
  · <a href="https://vca.chat" target="_blank" rel="noopener noreferrer">Explore vca.chat →</a>
</p>

---

# @agentos/core

> Modular AgentOS runtime used by Voice Chat Assistant. Official home: [github.com/framersai/agentos](https://github.com/framersai/agentos).

This package contains the Typescript implementation of the AgentOS orchestration stack (GMI manager, conversation/memory services, tool orchestrator, streaming manager, RAG helpers). It is developed inside the Voice Chat Assistant workspace and will be published as a standalone open-source package.

---

## Install

```bash
pnpm install @agentos/core
# or
npm install @agentos/core
```

Until public releases begin, consume the package via the workspace (monorepo) or the GitHub repo.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm run build` | Cleans `dist/`, compiles `src/**` (ESM) with declaration maps. |
| `pnpm run test`  | Executes Vitest tests (`tests/**/*.spec.ts`). |
| `pnpm run lint`  | Placeholder for future ESLint config. |
| `pnpm run clean` | Removes the `dist/` directory. |
| `pnpm run docs`  | Generates TypeDoc output under `docs/api`. |

> Tip: when working from the workspace root, run `npm --prefix packages/agentos run build` (this is already part of `npm run build:backend`).

---

## Usage

```ts
import { AgentOS, AgentOSConfig } from '@agentos/core';

const agentos = new AgentOS();
await agentos.initialize(agentOsConfig);

for await (const chunk of agentos.processRequest(input)) {
  // handle AgentOSResponseChunkType.* events
}
```

Key exports (see `src/index.ts`):

- `AgentOS`, `AgentOSOrchestrator`
- Types: `AgentOSInput`, `AgentOSResponse`, cognitive substrate interfaces, tool/permission contracts
- Streaming helpers (`StreamingManager` / `IStreamClient`), conversation/memory services, tool orchestrator configs
- Error helpers: `GMIError`, `GMIErrorCode`, `createGMIErrorFromError`

### Default wiring

- If no `utilityAIService` is provided in `AgentOSConfig`, the facade now spins up a lightweight `LLMUtilityAI` that implements both the `IUtilityAI` and `IPromptEngineUtilityAI` contracts. This keeps the package usable out of the box (prompt summarisation, RAG trimming, etc.).
- The `ToolOrchestrator` is initialised with an explicit `ToolPermissionManager` and `ToolExecutor`, so dynamic tool registration/enforcement rules are honoured even when the package is consumed outside the Voice Chat Assistant backend.
- `AgentOS.processRequest` exposes responses as an async generator by registering a temporary in-memory stream client (`AsyncStreamClientBridge`). Consumers that do not want to run the Express router can interact with the AgentOS facade directly.

Real deployments should supply their own auth/subscription services by implementing the interfaces in `src/services/user_auth/types.ts` (see VCA's adapters in `backend/src/integrations/agentos`). The package ships with minimal stubs for local testing.

---

## Tests & Roadmap

- Vitest is configured (`pnpm --filter @agentos/core test`). Today's coverage is minimal; expect more unit + integration tests as the extraction work completes.
- API docs can be generated locally via `pnpm run docs`; artefacts land in `docs/api`.
- Documentation, CI, and publishing flows will migrate to the dedicated OSS repo ([framersai/agentos](https://github.com/framersai/agentos)). This README serves as the single source of truth until the repo split is finalized (see [docs/AGENTOS_REINTEGRATION_NOTES.md](../../docs/AGENTOS_REINTEGRATION_NOTES.md)).

---

## Contributing

While the package lives in this workspace:

1. Update code under `packages/agentos/src/**`.
2. Run `pnpm --filter @agentos/core test` and `npm run build:backend` to ensure consumers still compile.
3. Document API changes in this README and, once the standalone repo is live, in its CHANGELOG.

When the repo split is complete, contributions should go directly to [https://github.com/framersai/agentos](https://github.com/framersai/agentos).
