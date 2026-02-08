# AgentOS + SQL Storage Adapter Integration - Quick Start Guide

## 🎯 TL;DR

**Should we integrate?** ✅ **YES - High Value**

**When?** **Phase 1 (Memory) now**, Phase 2 (App DB) later, Phase 3 (Core) optional

**Effort?** 2-3 weeks for Phase 1, 6-8 weeks total for Phases 1-2

---

## 💡 Why This Matters

### Current Problems

1. ❌ **SQLite-only** - Can't run on mobile (Capacitor), edge (Supabase), or production PostgreSQL
2. ❌ **No backups** - Critical conversation data not backed up to cloud
3. ❌ **Multiple storage systems** - better-sqlite3, Prisma, LocalForage all doing the same thing differently
4. ❌ **Hard to scale** - Migrating dev → production requires rewriting storage layer

### What sql-storage-adapter Solves

1. ✅ **One API, many backends** - SQLite (dev), PostgreSQL (prod), Supabase (edge), Capacitor (mobile)
2. ✅ **Cloud backups** - Automatic S3/R2 backups with compression and retention
3. ✅ **Unified codebase** - Same code works everywhere
4. ✅ **Easy migrations** - Built-in tools to export/import data between systems

---

## 📋 Integration Plan (Recommended)

### Phase 1: Conversation Memory (HIGH PRIORITY)

**Goal**: Replace `SqliteMemoryAdapter` with sql-storage-adapter

**Scope**:
- `backend/src/core/memory/SqliteMemoryAdapter.ts` → new `StorageAdapterMemory.ts`
- Keep same `IMemoryAdapter` interface (no breaking changes)
- Add cloud backup to S3/R2

**Timeline**: 2-3 weeks

**Benefits**:
- ✅ Conversations backed up to cloud
- ✅ Works on mobile apps (Capacitor SQLite plugin)
- ✅ Easy PostgreSQL migration for production
- ✅ Supabase support for edge deployments

**Code Change**:
```typescript
// OLD:
import Database from 'better-sqlite3';
const db = new Database('./memory.db');

// NEW:
import { createDatabase } from '@framers/sql-storage-adapter';
const db = await createDatabase({ type: 'sqlite', path: './memory.db' });
// Same code works with postgres: type: 'postgres', connection: 'postgresql://...'
```

---

### Phase 2: App Database (MEDIUM PRIORITY)

**Goal**: Replace `appDatabase.ts` with sql-storage-adapter

**Scope**:
- `backend/src/core/database/appDatabase.ts` → new `StorageAdapterDatabase.ts`
- Update all repositories (users, organizations, billing)
- Add cloud backup for user data

**Timeline**: 2-3 weeks

**Benefits**:
- ✅ Organizations work in PostgreSQL
- ✅ User data backed up to cloud
- ✅ Multi-tenant production deployments

---

### Phase 3: AgentOS Core (OPTIONAL)

**Goal**: Use sql-storage-adapter for GMI state, RAG metadata, lifecycle events

**Scope**:
- New `AgentOSStorageManager` class
- Schema for `gmi_instances`, `rag_data_sources`, `memory_lifecycle_events`
- Integration with GMI for persistence

**Timeline**: 2-4 weeks

**Benefits**:
- ✅ GMI state survives restarts
- ✅ Cross-session memory
- ✅ Consistent with rest of system

---

## 🚀 Quick Start (Phase 1 Only)

### 1. Install Package

```bash
cd packages/sql-storage-adapter
pnpm add @framers/sql-storage-adapter
```

### 2. Create New Adapter

**File**: `backend/src/core/memory/StorageAdapterMemory.ts`

```typescript
import { createDatabase, StorageAdapter } from '@framers/sql-storage-adapter';
import { IMemoryAdapter } from './IMemoryAdapter';

export class StorageAdapterMemory implements IMemoryAdapter {
  private db: StorageAdapter | null = null;
  
  async initialize(): Promise<void> {
    this.db = await createDatabase({
      type: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
      connection: process.env.DATABASE_URL || './db_data/memory.db',
    });
    
    // Create schema (same as before)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (...);
      CREATE TABLE IF NOT EXISTS conversation_turns (...);
    `);
  }
  
  async storeConversationTurn(...) {
    // Use this.db.run() instead of direct DB access
  }
  
  async retrieveConversationTurns(...) {
    // Use this.db.all() instead of direct DB access
  }
  
  // Implement other IMemoryAdapter methods
}
```

### 3. Enable Cloud Backups

```typescript
import { createCloudBackupManager } from '@framers/sql-storage-adapter';
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });
const backup = createCloudBackupManager(this.db, s3, 'agentos-memory', {
  interval: 3600000,  // 1 hour
  maxBackups: 168,    // 1 week
  options: { compression: 'gzip' }
});

backup.start();
```

### 4. Environment Variables

```bash
# Development (SQLite)
DATABASE_TYPE=sqlite

# Production (PostgreSQL)
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/agentos

# Cloud Backups
ENABLE_CLOUD_BACKUPS=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BACKUP_BUCKET=agentos-backups
```

### 5. Migration Script

```bash
npm run migrate:memory-to-storage-adapter
```

---

## ✅ Success Checklist

### Before Production

- [ ] All unit tests passing
- [ ] Integration tests with SQLite
- [ ] Integration tests with PostgreSQL
- [ ] Migration script tested with production data copy
- [ ] Cloud backups working (test restore)
- [ ] Performance tests (query speed, backup speed)
- [ ] Documentation updated
- [ ] Team trained on new system

### After Production

- [ ] Monitor backup success rate (should be >99.9%)
- [ ] Monitor query performance (should be within 10% of baseline)
- [ ] Monitor S3 costs
- [ ] No data loss incidents
- [ ] Zero user-reported issues

---

## 🔧 Troubleshooting

### "Module not found: @framers/sql-storage-adapter"

```bash
cd packages/sql-storage-adapter
pnpm install
pnpm build
```

### "Database locked" errors

sql-storage-adapter uses WAL mode by default, which prevents locking. If you still see errors:

```typescript
await db.exec('PRAGMA busy_timeout = 5000;');
```

### Cloud backup failures

Check S3 credentials and permissions:
```bash
aws s3 ls s3://agentos-backups/  # Should list backups
```

### Performance slower than expected

Enable indexes:
```sql
CREATE INDEX idx_conversation_turns_conv ON conversation_turns(conversationId, timestamp);
CREATE INDEX idx_conversations_user ON conversations(userId, lastActivity DESC);
```

---

## 📊 Expected Results

### Performance

- **SQLite queries**: Same speed (uses better-sqlite3 under the hood)
- **PostgreSQL queries**: Similar to direct pg usage
- **Backup creation**: ~5-10 seconds for 10k conversations
- **Backup restore**: ~10-20 seconds for 10k conversations

### Storage

- **Gzip compression**: 40-60% reduction in backup size
- **S3 costs**: ~$0.023/GB/month (standard), ~$0.015/GB/month (R2)
- **Example**: 1GB of conversations = ~$0.02/month with R2

### Reliability

- **Backup success rate**: >99.9%
- **Data loss incidents**: 0
- **Migration success rate**: 100%

---

## 📞 Support

### Questions?

- **Full Analysis**: See `SQL_STORAGE_INTEGRATION_ANALYSIS.md`
- **sql-storage-adapter Docs**: `packages/sql-storage-adapter/README.md`
- **Examples**: `packages/sql-storage-adapter/examples/`

### Need Help?

1. Check existing `IMemoryAdapter` interface - new adapter must match it exactly
2. Look at `SqliteMemoryAdapter` implementation - copy the same logic, just use `db.run()` instead of `prepare().run()`
3. Test with SQLite first, then try PostgreSQL
4. Start without cloud backups, add them once basic storage works

---

**Ready to start?** Begin with Phase 1 - conversation memory integration. It's the highest-value, lowest-risk starting point.
