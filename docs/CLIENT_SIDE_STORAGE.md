# Client-Side Storage for AgentOS

## Overview

AgentOS now supports **fully client-side operation** with persistent storage using `@framers/sql-storage-adapter`. This enables:

- ✅ **Offline-first** web apps (no backend required)
- ✅ **Privacy-first** (data never leaves browser/device)
- ✅ **Progressive Web Apps** (PWAs)
- ✅ **Desktop apps** (Electron)
- ✅ **Mobile apps** (Capacitor)
- ✅ **Hybrid architectures** (local + cloud sync)

---

## Quick Start

### 1. Install sql-storage-adapter

```bash
npm install @framers/sql-storage-adapter
```

### 2. Initialize AgentOS with Storage

```typescript
import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';
import { AgentOS } from '@agentos/core';

// Auto-detects platform (web → IndexedDB, electron → better-sqlite3, etc.)
const storage = await createAgentOSStorage({
  platform: 'auto',
  persistence: true,
});

const agentos = new AgentOS();
await agentos.initialize({
  storageAdapter: storage.getAdapter(),
  // ... other config (modelProviderManagerConfig, etc.)
});
```

### 3. Use AgentOS Normally

```typescript
// All conversations, sessions, personas are persisted locally
const response = await agentos.handleUserMessage({
  userId: 'user-123',
  personaId: 'v_researcher',
  userMessage: 'Hello, AgentOS!',
  conversationId: 'conv-1',
});

// Data is automatically saved to IndexedDB (web) or SQLite (desktop/mobile)
```

---

## Platform-Specific Guides

### Web (Browser)

**Recommended Adapter:** IndexedDB

```typescript
import { IndexedDbAdapter } from '@framers/sql-storage-adapter';

const storage = new IndexedDbAdapter({
  dbName: 'agentos-workbench',
  autoSave: true,
  saveIntervalMs: 5000,  // Batch writes every 5s
});

await storage.open();

await agentos.initialize({
  storageAdapter: storage,
  // ...
});
```

**Features:**
- ✅ 50MB-1GB+ storage quota (browser-dependent)
- ✅ Async, non-blocking
- ✅ Works offline
- ✅ Full SQL via sql.js (SQLite in WebAssembly)

**Export/Import:**
```typescript
// Export conversations for backup
const backup = storage.exportDatabase();  // Uint8Array
const blob = new Blob([backup], { type: 'application/x-sqlite3' });
const url = URL.createObjectURL(blob);
// User downloads .db file

// Import on another device
const file = await fileInput.files[0].arrayBuffer();
await storage.importDatabase(new Uint8Array(file));
```

---

### Desktop (Electron)

**Recommended Adapter:** better-sqlite3

```typescript
import { BetterSqliteAdapter } from '@framers/sql-storage-adapter';
import path from 'path';
import { app } from 'electron';

const storage = new BetterSqliteAdapter({
  filePath: path.join(app.getPath('userData'), 'agentos.db'),
});

await storage.open();

await agentos.initialize({
  storageAdapter: storage,
  // ...
});
```

**Features:**
- ✅ Native C++ performance (10-100x faster than WASM)
- ✅ Full SQLite features (WAL, transactions, indexes)
- ✅ Unlimited storage (file-based)
- ✅ No quota limits

**Fallback:** If better-sqlite3 fails to build, gracefully falls back to sql.js:

```typescript
const storage = await createAgentOSStorage({
  platform: 'electron',
  // Tries better-sqlite3 first, falls back to sql.js
});
```

---

### Mobile (Capacitor)

**Recommended Adapter:** @capacitor-community/sqlite

```typescript
import { CapacitorSqliteAdapter } from '@framers/sql-storage-adapter';

const storage = new CapacitorSqliteAdapter({
  database: 'agentos-mobile',
  encrypted: true,  // iOS Keychain / Android Keystore
});

await storage.open();

await agentos.initialize({
  storageAdapter: storage,
  // ...
});
```

**Features:**
- ✅ Native SQLite on iOS/Android
- ✅ Encryption support
- ✅ Multi-threaded (better performance)
- ✅ Unlimited storage (device-dependent)

**Fallback:** For WebView-based Ionic apps without Capacitor:

```typescript
const storage = await createAgentOSStorage({
  platform: 'web',  // Uses IndexedDB in WebView
});
```

---

## Hybrid Architecture (Local + Cloud Sync)

**Use Case:** Local-first for speed/offline, sync to cloud for multi-device access.

```typescript
import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';

const storage = await createAgentOSStorage({
  local: { adapter: 'indexeddb' },
  remote: { 
    adapter: 'postgres',
    connectionString: process.env.SUPABASE_URL,
  },
  syncStrategy: 'optimistic',  // Write local, sync async
  syncIntervalMs: 30000,       // Sync every 30s
});
```

**Sync Strategies:**

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `local-only` | No sync | Offline-only apps |
| `remote-only` | Cloud-only | Server-authoritative |
| `optimistic` | Local first, sync async | **Recommended** for hybrid |
| `pessimistic` | Remote first, cache local | Strong consistency |

---

## Schema & Typed Queries

AgentOS storage adapter auto-creates these tables:

```sql
-- Conversations (GMI interactions)
conversations (id, user_id, persona_id, created_at, updated_at, metadata)

-- Conversation events (streaming chunks, tool calls, etc.)
conversation_events (id, conversation_id, event_type, event_data, timestamp)

-- Sessions (UI/UX grouping)
sessions (id, user_id, display_name, target_type, target_id, created_at, updated_at, metadata)

-- Persona definitions (cached locally)
personas (id, display_name, description, definition, created_at, updated_at)

-- Telemetry (token usage, costs, performance)
telemetry (id, session_id, event_type, event_data, timestamp)

-- Workflows (cached definitions)
workflows (id, name, definition, created_at, updated_at)
```

**Typed Query Builders (Future):**

```typescript
// Instead of raw SQL
await storage.conversations.save('conv-1', 'user-1', 'v_researcher', events);
const conversation = await storage.conversations.get('conv-1');
const allConversations = await storage.conversations.list('user-1', { limit: 50 });

// Sessions
await storage.sessions.save('session-1', 'user-1', 'V Session', 'persona', 'v_researcher');
const sessions = await storage.sessions.list('user-1');

// Personas
await storage.personas.cache('v_researcher', 'V', personaDefinition);
const persona = await storage.personas.get('v_researcher');
```

---

## Migration from Prisma (Server-Side)

If you're migrating from server-side AgentOS to client-side:

### Before (Server-Side)

```typescript
const agentos = new AgentOS();
await agentos.initialize({
  prisma: new PrismaClient(),  // Server-only
  // ...
});
```

### After (Client-Side)

```typescript
const storage = await createAgentOSStorage({ platform: 'auto' });

const agentos = new AgentOS();
await agentos.initialize({
  storageAdapter: storage.getAdapter(),  // 🆕 Client-side
  prisma: mockPrisma,  // Stub for compatibility (TODO: make optional)
  // ...
});
```

**Note:** Currently, AgentOS still requires a Prisma instance. We're working on making it optional when `storageAdapter` is provided.

---

## Performance & Quotas

| Adapter | Read Speed | Write Speed | Storage Limit | Offline |
|---------|-----------|-------------|---------------|---------|
| IndexedDB | Fast | Moderate | 50MB-1GB+ | ✅ |
| better-sqlite3 | **Fastest** | **Fastest** | Unlimited | ✅ |
| sql.js | Fast | Slow | Unlimited (RAM) | ✅ |
| capacitor | **Fastest** | **Fastest** | Unlimited | ✅ |
| Postgres | Moderate | Moderate | Unlimited | ❌ |

**Recommendations:**
- **Web:** IndexedDB (best browser-native option)
- **Electron:** better-sqlite3 (native performance)
- **Capacitor:** capacitor (native mobile)
- **Cloud:** Postgres (multi-user)

---

## Export/Import for Data Portability

All adapters support export/import:

```typescript
// Export
const backup = storage.exportDatabase();  // Uint8Array (SQLite file format)

// Save to file (browser)
const blob = new Blob([backup], { type: 'application/x-sqlite3' });
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'agentos-backup.db';
link.click();

// Import
const file = await fileInput.files[0].arrayBuffer();
await storage.importDatabase(new Uint8Array(file));
```

**Use Cases:**
- Backup conversations before browser clear
- Move data between devices
- Switch platforms (web → desktop)

---

## Troubleshooting

### "IndexedDB quota exceeded"

**Solution:** Browsers limit IndexedDB to 50MB-1GB. Export old conversations and delete them:

```typescript
// Export backup
const backup = storage.exportDatabase();

// Clear old data
await storage.getAdapter().run('DELETE FROM conversation_events WHERE timestamp < ?', [cutoffDate]);
```

### "better-sqlite3 failed to build"

**Solution:** Ensure native build tools are installed:

```bash
# Windows
npm install --global windows-build-tools

# macOS
xcode-select --install

# Linux
sudo apt install python3 build-essential

# Or fallback to sql.js
STORAGE_ADAPTER=sqljs npm start
```

### "Storage not persisting across page refresh"

**Solution:** Ensure `autoSave: true` for IndexedDB:

```typescript
const storage = new IndexedDbAdapter({
  autoSave: true,  // ← Critical for persistence
  saveIntervalMs: 5000,
});
```

---

## Next Steps

1. **Try the demo:** See `apps/agentos-client` for a working example
2. **Read the Platform Strategy:** [PLATFORM_STRATEGY.md](../../sql-storage-adapter/docs/PLATFORM_STRATEGY.md)
3. **Contribute:** Submit issues/PRs for improvements

---

**TL;DR:** Use `createAgentOSStorage({ platform: 'auto' })` and AgentOS works offline everywhere. IndexedDB for web, better-sqlite3 for desktop, capacitor for mobile.

