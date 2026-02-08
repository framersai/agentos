# AgentOS Platform Support

AgentOS integrates with the SQL Storage Adapter as its primary persistence interface. This enables a single codebase to run across Cloud (PostgreSQL), Desktop (Electron with better-sqlite3), Mobile (Capacitor SQLite), and Browser/Edge (sql.js fallback).

- Start here: `docs/PLATFORM_FEATURE_MATRIX.md` (top-level) for feature availability and gating rules.
- Storage adapter details: `packages/sql-storage-adapter/README.md` and `ARCHITECTURE.md`.

## Defaults

- SaaS (Cloud): prefer PostgreSQL via `DATABASE_URL`.
- Desktop: prefer `better-sqlite3`, fallback to `sqljs`.
- Mobile: prefer Capacitor SQLite.
- Browser: `sqljs` only, export/import for persistence.

## AgentOS Usage

- Use `createDatabase()` from `@framers/sql-storage-adapter` in AgentOS services.
- Branch optional features by adapter capabilities: JSON/arrays/streaming only when supported.
- Degrade gracefully (hide orgs/billing where unsupported, provide export/import when no cloud backup).


