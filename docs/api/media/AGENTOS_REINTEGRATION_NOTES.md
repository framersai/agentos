# AgentOS Integration Notes

AgentOS now ships as the @wearetheframers/agentos package. This note explains how it is wired into the Voice Chat Assistant backend today and which files to adjust when the integration changes.

---

## Current locations

- **Package source:** packages/agentos/src/**
- **Published package:** @wearetheframers/agentos
- **Backend adapters:** ackend/src/integrations/agentos/*
  - gentos.integration.ts – bootstraps AgentOS inside the Express app
  - gentos.chat-adapter.ts – hydrates conversation history + knowledge base before each turn
  - gentos.auth-service.ts – converts global JWT / Supabase sessions into AgentOS IAuthService
  - gentos.subscription-service.ts – enforces plan tiers via shared/planCatalog
  - gentos.persona-registry.ts – mirrors the Vue agent catalogue for persona metadata

Legacy folders under ackend/agentos/** were removed when the runtime became a standalone package.

---

## Integration status

| Area | Status | Notes |
|------|--------|-------|
| Packaging | ✅ | pnpm --filter @agentos/core build emits ESM artifacts and TypeDoc (docs/api). |
| Chat bridge | ✅ | /api/agentos/chat routes into AgentOS via the chat adapter; SSE/WebSocket stubs are ready for full streaming rollout. |
| Auth & billing | ✅ | Supabase/global auth and plan catalogue feed the AgentOS subscription service so persona/tool gating matches the rest of the app. |
| Memory / RAG | ✅ | Conversation history and the SQLite knowledge base are loaded into AgentOS before each turn; lifecycle policies remain configurable through the package. |
| Observability | ⚠ | Structured telemetry hooks exist (ToolOrchestrator, StreamingManager) but are not yet connected to /api/system metrics. |

---

## When to touch the integration files

- Adding or renaming personas? Update gentos.persona-registry.ts so AgentOS points at the correct prompt files and toolsets.
- Changing auth flows? Modify gentos.auth-service.ts / gentos.subscription-service.ts to keep parity with Supabase/global JWT logic and plan entitlements.
- Introducing new knowledge sources or persistence layers? Extend gentos.chat-adapter.ts to load them before delegating to AgentOS.
- Turning on streaming UI? Wire /api/agentos/stream into the frontend once the provider supports streaming models.

---

For the runtime’s internal structure (personas, GMI, memory lifecycle, streaming protocol), see [docs/ARCHITECTURE.md](./ARCHITECTURE.md). Billing, Supabase, and frontend agent guides continue to apply when AgentOS is enabled.
