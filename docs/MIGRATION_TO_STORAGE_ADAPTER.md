# AgentOS Migration to sql-storage-adapter

## Summary

AgentOS has been fully migrated to use `@framers/sql-storage-adapter` for all database operations. Prisma is now **optional** and only used for server-side features (auth, subscriptions, multi-user management).

## Changes

### ✅ ConversationManager
- **Before:** Used Prisma directly for all database operations
- **After:** Uses `StorageAdapter` interface (works with IndexedDB, SQLite, PostgreSQL)
- **Migration:** All Prisma calls replaced with SQL queries via StorageAdapter
- **Schema:** Auto-creates tables on initialization

### ✅ GMIManager
- **Before:** Required Prisma parameter (even though it didn't use it)
- **After:** Prisma dependency removed entirely
- **Migration:** Constructor signature updated, validation updated

### ✅ AgentOSConfig
- **Before:** Prisma was required
- **After:** Either `storageAdapter` OR `prisma` must be provided (both optional individually)
- **Migration:** Validation updated to allow either/or

### ✅ Graceful Degradation
- **Auto-detection:** `createAgentOSStorage({ platform: 'auto' })` detects best adapter
- **Priority:** Postgres → SQLite → IndexedDB → sql.js
- **Works:** Fully client-side (browser) to fully server-side (cloud)

## Usage Examples

### Client-Side (Browser)
```typescript
import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';
import { AgentOS } from '@agentos/core';

const storage = await createAgentOSStorage({ platform: 'web' });

const agentos = new AgentOS();
await agentos.initialize({
  storageAdapter: storage.getAdapter(),
  // prisma: undefined,  // Not needed for client-side
  authService: mockAuthService,
  subscriptionService: mockSubscriptionService,
  // ... other config
});
```

### Server-Side (Multi-User)
```typescript
import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';
import { AgentOS } from '@agentos/core';
import { PrismaClient } from '@prisma/client';

const storage = await createAgentOSStorage({ 
  platform: 'cloud',
  postgres: { connectionString: process.env.DATABASE_URL }
});

const prisma = new PrismaClient();

const agentos = new AgentOS();
await agentos.initialize({
  storageAdapter: storage.getAdapter(),  // For conversations
  prisma: prisma,  // For auth, subscriptions, user management
  // ... other config
});
```

### Desktop (Electron)
```typescript
import { createAgentOSStorage } from '@framers/sql-storage-adapter/agentos';

const storage = await createAgentOSStorage({ platform: 'electron' });

await agentos.initialize({
  storageAdapter: storage.getAdapter(),
  // ... other config
});
```

## Database Schema

ConversationManager auto-creates these tables:

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  gmi_instance_id TEXT,
  title TEXT,
  language TEXT,
  session_details TEXT DEFAULT '{}',
  is_archived INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  multimodal_data TEXT,
  audio_url TEXT,
  audio_transcript TEXT,
  voice_settings TEXT,
  metadata TEXT DEFAULT '{}',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

## Breaking Changes

⚠️ **No backward compatibility** - This is a breaking change:

1. **ConversationManager.initialize()** signature changed:
   - **Before:** `initialize(config, utilityAIService?, prismaClient?)`
   - **After:** `initialize(config, utilityAIService?, storageAdapter?)`

2. **GMIManager constructor** signature changed:
   - **Before:** `new GMIManager(config, subscriptionService, authService, prisma, conversationManager, ...)`
   - **After:** `new GMIManager(config, subscriptionService, authService, conversationManager, ...)`

3. **AgentOSConfig.prisma** is now optional:
   - **Before:** Required
   - **After:** Optional (only needed for auth/subscriptions)

## Migration Path

If you have existing code using Prisma:

1. **Install sql-storage-adapter:**
   ```bash
   npm install @framers/sql-storage-adapter
   ```

2. **Create storage adapter:**
   ```typescript
   const storage = await createAgentOSStorage({ platform: 'auto' });
   ```

3. **Update AgentOS initialization:**
   ```typescript
   await agentos.initialize({
     storageAdapter: storage.getAdapter(),  // Add this
     prisma: prismaClient,  // Keep for auth/subscriptions if needed
     // ... rest of config
   });
   ```

4. **Update ConversationManager calls:**
   - No changes needed - ConversationManager now uses storageAdapter automatically

5. **Update GMIManager instantiation:**
   - Remove `prisma` parameter from constructor

## Testing

All tests have been updated to use StorageAdapter mocks instead of Prisma mocks.

## Benefits

✅ **Cross-platform:** Works in browser, Electron, mobile, Node.js, cloud
✅ **Graceful degradation:** Auto-detects best adapter for platform
✅ **Smaller bundle:** No Prisma client needed for client-side
✅ **Better performance:** Native SQLite on desktop/mobile
✅ **Offline-first:** Full IndexedDB support for PWAs
✅ **Future-proof:** Easy to add new adapters (e.g., Supabase, Firebase)

## Next Steps

- [ ] Update all backend code to use storageAdapter
- [ ] Add integration tests for cross-platform compatibility
- [ ] Document Prisma usage for auth/subscriptions only
- [ ] Add migration utilities for existing Prisma databases

