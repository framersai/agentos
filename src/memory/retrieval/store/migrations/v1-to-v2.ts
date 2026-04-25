/**
 * @file v1-to-v2.ts
 * @description Schema migration v1 -> v2: add `brain_id TEXT NOT NULL` column
 * to all 14 brain-owned tables and recreate composite primary keys / indexes.
 *
 * SQLite does not support `ALTER TABLE ADD PRIMARY KEY`, so the migration uses
 * the standard recreate-table dance: rename old to `<name>_v1`, create new
 * with target schema, copy rows with the brain_id default, drop the old.
 *
 * Postgres uses simple ALTER statements (ADD COLUMN with default, DROP CONSTRAINT,
 * ADD PRIMARY KEY) since it supports those operations natively.
 *
 * Idempotent: detects v2 schema and returns early without touching data.
 *
 * @module memory/retrieval/store/migrations/v1-to-v2
 */

import type { StorageAdapter, StorageFeatures } from '@framers/sql-storage-adapter';

interface TableSpec {
  /** Table name. */
  name: string;
  /** Column definitions in v2 form, comma-separated, brain_id first. */
  columnsDdl: string;
  /** Composite PK columns (always starts with brain_id). Empty array for AUTOINCREMENT tables. */
  primaryKey: string[];
  /** Whether this table uses INTEGER PRIMARY KEY AUTOINCREMENT for id (no composite PK). */
  autoincrementId?: boolean;
  /** Foreign keys (compound where applicable). */
  foreignKeys?: string[];
  /** Index DDL statements for v2 schema. */
  indexes: string[];
  /**
   * For agent_id-style legacy tables, map source column to brain_id.
   * Example: archived_traces previously used `agent_id` as the discriminator;
   * during migration we copy `agent_id` into `brain_id` rather than defaulting.
   */
  brainIdSourceColumn?: string;
}

/**
 * The 14 tables that gain `brain_id` in v2. Order matters for FK resolution:
 * documents must exist before document_chunks; conversations before messages.
 */
const V2_TABLES: TableSpec[] = [
  {
    name: 'brain_meta',
    columnsDdl: 'brain_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL',
    primaryKey: ['brain_id', 'key'],
    indexes: [],
  },
  {
    name: 'memory_traces',
    columnsDdl: `
      brain_id        TEXT    NOT NULL,
      id              TEXT    NOT NULL,
      type            TEXT    NOT NULL,
      scope           TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      embedding       BLOB,
      strength        REAL    NOT NULL DEFAULT 1.0,
      created_at      INTEGER NOT NULL,
      last_accessed   INTEGER,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      tags            TEXT    NOT NULL DEFAULT '[]',
      emotions        TEXT    NOT NULL DEFAULT '{}',
      metadata        TEXT    NOT NULL DEFAULT '{}',
      deleted         INTEGER NOT NULL DEFAULT 0
    `,
    primaryKey: ['brain_id', 'id'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_memory_traces_brain_type
         ON memory_traces (brain_id, type, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_traces_brain_scope
         ON memory_traces (brain_id, scope)`,
    ],
  },
  {
    name: 'knowledge_nodes',
    columnsDdl: `
      brain_id   TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      type       TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      properties TEXT    NOT NULL DEFAULT '{}',
      embedding  BLOB,
      confidence REAL    NOT NULL DEFAULT 1.0,
      source     TEXT    NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    `,
    primaryKey: ['brain_id', 'id'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_brain_type
         ON knowledge_nodes (brain_id, type)`,
    ],
  },
  {
    name: 'knowledge_edges',
    columnsDdl: `
      brain_id      TEXT    NOT NULL,
      id            TEXT    NOT NULL,
      source_id     TEXT    NOT NULL,
      target_id     TEXT    NOT NULL,
      type          TEXT    NOT NULL,
      weight        REAL    NOT NULL DEFAULT 1.0,
      bidirectional INTEGER NOT NULL DEFAULT 0,
      metadata      TEXT    NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL
    `,
    primaryKey: ['brain_id', 'id'],
    foreignKeys: [
      'FOREIGN KEY (brain_id, source_id) REFERENCES knowledge_nodes(brain_id, id)',
      'FOREIGN KEY (brain_id, target_id) REFERENCES knowledge_nodes(brain_id, id)',
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_brain_source
         ON knowledge_edges (brain_id, source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_brain_target
         ON knowledge_edges (brain_id, target_id)`,
    ],
  },
  {
    name: 'documents',
    columnsDdl: `
      brain_id     TEXT    NOT NULL,
      id           TEXT    NOT NULL,
      path         TEXT    NOT NULL,
      format       TEXT    NOT NULL,
      title        TEXT,
      content_hash TEXT    NOT NULL,
      chunk_count  INTEGER NOT NULL DEFAULT 0,
      metadata     TEXT    NOT NULL DEFAULT '{}',
      ingested_at  INTEGER NOT NULL
    `,
    primaryKey: ['brain_id', 'id'],
    indexes: [],
  },
  {
    name: 'document_chunks',
    columnsDdl: `
      brain_id     TEXT    NOT NULL,
      id           TEXT    NOT NULL,
      document_id  TEXT    NOT NULL,
      trace_id     TEXT,
      content      TEXT    NOT NULL,
      chunk_index  INTEGER NOT NULL,
      page_number  INTEGER,
      embedding    BLOB
    `,
    primaryKey: ['brain_id', 'id'],
    foreignKeys: [
      'FOREIGN KEY (brain_id, document_id) REFERENCES documents(brain_id, id)',
      'FOREIGN KEY (brain_id, trace_id) REFERENCES memory_traces(brain_id, id)',
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_document_chunks_brain_document
         ON document_chunks (brain_id, document_id, chunk_index)`,
    ],
  },
  {
    name: 'document_images',
    columnsDdl: `
      brain_id    TEXT    NOT NULL,
      id          TEXT    NOT NULL,
      document_id TEXT    NOT NULL,
      chunk_id    TEXT,
      data        BLOB    NOT NULL,
      mime_type   TEXT    NOT NULL,
      caption     TEXT,
      page_number INTEGER,
      embedding   BLOB
    `,
    primaryKey: ['brain_id', 'id'],
    foreignKeys: [
      'FOREIGN KEY (brain_id, document_id) REFERENCES documents(brain_id, id)',
      'FOREIGN KEY (brain_id, chunk_id) REFERENCES document_chunks(brain_id, id)',
    ],
    indexes: [],
  },
  {
    name: 'consolidation_log',
    columnsDdl: `
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      brain_id    TEXT    NOT NULL,
      ran_at      INTEGER NOT NULL,
      pruned      INTEGER NOT NULL DEFAULT 0,
      merged      INTEGER NOT NULL DEFAULT 0,
      derived     INTEGER NOT NULL DEFAULT 0,
      compacted   INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0
    `,
    primaryKey: [], // AUTOINCREMENT id is global; brain_id scopes via index
    autoincrementId: true,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_consolidation_log_brain_time
         ON consolidation_log (brain_id, ran_at DESC)`,
    ],
  },
  {
    name: 'retrieval_feedback',
    columnsDdl: `
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      brain_id   TEXT    NOT NULL,
      trace_id   TEXT    NOT NULL,
      signal     TEXT    NOT NULL,
      query      TEXT,
      created_at INTEGER NOT NULL
    `,
    primaryKey: [],
    autoincrementId: true,
    foreignKeys: [
      'FOREIGN KEY (brain_id, trace_id) REFERENCES memory_traces(brain_id, id)',
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_retrieval_feedback_brain_trace
         ON retrieval_feedback (brain_id, trace_id, created_at DESC)`,
    ],
  },
  {
    name: 'conversations',
    columnsDdl: `
      brain_id   TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      title      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata   TEXT    NOT NULL DEFAULT '{}'
    `,
    primaryKey: ['brain_id', 'id'],
    indexes: [],
  },
  {
    name: 'messages',
    columnsDdl: `
      brain_id        TEXT    NOT NULL,
      id              TEXT    NOT NULL,
      conversation_id TEXT    NOT NULL,
      role            TEXT    NOT NULL,
      content         TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      metadata        TEXT    NOT NULL DEFAULT '{}'
    `,
    primaryKey: ['brain_id', 'id'],
    foreignKeys: [
      'FOREIGN KEY (brain_id, conversation_id) REFERENCES conversations(brain_id, id)',
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_messages_brain_conversation
         ON messages (brain_id, conversation_id, created_at)`,
    ],
  },
  {
    name: 'prospective_items',
    columnsDdl: `
      brain_id             TEXT    NOT NULL,
      id                   TEXT    NOT NULL,
      content              TEXT    NOT NULL,
      trigger_type         TEXT    NOT NULL,
      trigger_at           INTEGER,
      trigger_event        TEXT,
      cue_text             TEXT,
      cue_embedding        BLOB,
      similarity_threshold REAL    DEFAULT 0.7,
      importance           REAL    NOT NULL DEFAULT 0.5,
      triggered            INTEGER NOT NULL DEFAULT 0,
      recurring            INTEGER NOT NULL DEFAULT 0,
      source_trace_id      TEXT,
      created_at           INTEGER NOT NULL
    `,
    primaryKey: ['brain_id', 'id'],
    indexes: [],
  },
  {
    name: 'archived_traces',
    columnsDdl: `
      brain_id         TEXT    NOT NULL,
      trace_id         TEXT    NOT NULL,
      agent_id         TEXT    NOT NULL,
      verbatim_content TEXT    NOT NULL,
      content_hash     TEXT    NOT NULL,
      trace_type       TEXT    NOT NULL,
      emotional_context TEXT   NOT NULL DEFAULT '{}',
      entities         TEXT    NOT NULL DEFAULT '[]',
      tags             TEXT    NOT NULL DEFAULT '[]',
      created_at       INTEGER NOT NULL,
      archived_at      INTEGER NOT NULL,
      archive_reason   TEXT    NOT NULL,
      byte_size        INTEGER NOT NULL DEFAULT 0
    `,
    primaryKey: ['brain_id', 'trace_id'],
    // Migration: copy existing agent_id column into brain_id (legacy archive
    // already discriminated by agent_id, which is semantically the same).
    brainIdSourceColumn: 'agent_id',
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_archived_traces_brain_time
         ON archived_traces (brain_id, archived_at)`,
      `CREATE INDEX IF NOT EXISTS idx_archived_traces_brain_reason
         ON archived_traces (brain_id, archive_reason)`,
    ],
  },
  {
    name: 'archive_access_log',
    columnsDdl: `
      brain_id        TEXT    NOT NULL,
      trace_id        TEXT    NOT NULL,
      accessed_at     INTEGER NOT NULL,
      request_context TEXT
    `,
    primaryKey: ['brain_id', 'trace_id', 'accessed_at'],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_archive_access_recency
         ON archive_access_log (brain_id, trace_id, accessed_at DESC)`,
    ],
  },
];

/**
 * Run the v1 -> v2 migration on the given storage adapter.
 *
 * Idempotent: returns immediately when schema is already v2.
 *
 * @param adapter - The storage adapter to migrate.
 * @param features - Platform-aware feature bundle (used for dialect-specific paths).
 * @param brainId - The brain identifier to assign to all existing rows.
 * @returns `{ migrated: true }` if migration ran, `{ migrated: false }` if no-op.
 */
export async function migrateV1ToV2(
  adapter: StorageAdapter,
  features: StorageFeatures,
  brainId: string,
): Promise<{ migrated: boolean }> {
  const isPostgres = adapter.kind.includes('postgres');

  // Detect v2 schema via brain_meta column existence.
  // If brain_meta does not exist yet, this is a fresh database; no migration needed.
  const brainMetaExists = isPostgres
    ? await postgresTableExists(adapter, 'brain_meta')
    : await sqliteTableExists(adapter, 'brain_meta');

  if (!brainMetaExists) {
    // Fresh database; the upcoming _initSchema() call creates v2 directly.
    return { migrated: false };
  }

  const hasBrainId = isPostgres
    ? await postgresHasColumn(adapter, 'brain_meta', 'brain_id')
    : await sqliteHasColumn(adapter, 'brain_meta', 'brain_id');

  if (hasBrainId) {
    return { migrated: false };
  }

  // Run migration. SQLite uses recreate-table dance; Postgres uses ALTER.
  for (const table of V2_TABLES) {
    const exists = isPostgres
      ? await postgresTableExists(adapter, table.name)
      : await sqliteTableExists(adapter, table.name);
    if (!exists) continue;

    if (isPostgres) {
      await migratePostgresTable(adapter, table, brainId);
    } else {
      await migrateSqliteTable(adapter, table, brainId);
    }
  }

  return { migrated: true };
}

async function sqliteTableExists(adapter: StorageAdapter, table: string): Promise<boolean> {
  const row = await adapter.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table],
  );
  return Boolean(row);
}

async function postgresTableExists(adapter: StorageAdapter, table: string): Promise<boolean> {
  const row = await adapter.get<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table],
  );
  return row?.exists ?? false;
}

async function sqliteHasColumn(
  adapter: StorageAdapter,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await adapter.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

async function postgresHasColumn(
  adapter: StorageAdapter,
  table: string,
  column: string,
): Promise<boolean> {
  const row = await adapter.get<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return row?.exists ?? false;
}

/**
 * SQLite recreate-table dance for a single table.
 *
 * 1. Read existing column names.
 * 2. Rename table to `<name>_v1`.
 * 3. Create new table with v2 schema.
 * 4. Copy rows: for tables with `brainIdSourceColumn`, use that column;
 *    otherwise default to the supplied brainId.
 * 5. Drop old table.
 * 6. Apply indexes.
 */
async function migrateSqliteTable(
  adapter: StorageAdapter,
  table: TableSpec,
  brainId: string,
): Promise<void> {
  const oldColumns = (await adapter.all<{ name: string }>(`PRAGMA table_info(${table.name})`)).map(
    (r) => r.name,
  );

  await adapter.exec(`ALTER TABLE ${table.name} RENAME TO ${table.name}_v1`);

  const pkClause = table.primaryKey.length > 0 ? `, PRIMARY KEY (${table.primaryKey.join(', ')})` : '';
  const fkClause = table.foreignKeys && table.foreignKeys.length > 0
    ? ',\n  ' + table.foreignKeys.join(',\n  ')
    : '';

  await adapter.exec(
    `CREATE TABLE ${table.name} (
       ${table.columnsDdl}${pkClause}${fkClause}
     )`,
  );

  const oldColList = oldColumns.join(', ');
  if (table.brainIdSourceColumn && oldColumns.includes(table.brainIdSourceColumn)) {
    // Copy rows using the existing column as brain_id source.
    await adapter.exec(
      `INSERT INTO ${table.name} (brain_id, ${oldColList})
         SELECT ${table.brainIdSourceColumn}, ${oldColList} FROM ${table.name}_v1`,
    );
  } else {
    await adapter.run(
      `INSERT INTO ${table.name} (brain_id, ${oldColList})
         SELECT ?, ${oldColList} FROM ${table.name}_v1`,
      [brainId],
    );
  }

  await adapter.exec(`DROP TABLE ${table.name}_v1`);

  for (const idx of table.indexes) {
    await adapter.exec(idx);
  }
}

/**
 * Postgres ALTER-based migration for a single table.
 *
 * 1. Add brain_id column with default = brainId (or copy from agent_id when present).
 * 2. Drop existing primary key constraint.
 * 3. Add composite primary key (or skip for AUTOINCREMENT tables).
 * 4. Drop the default on brain_id (future INSERTs supply it explicitly).
 * 5. Apply indexes.
 */
async function migratePostgresTable(
  adapter: StorageAdapter,
  table: TableSpec,
  brainId: string,
): Promise<void> {
  const escapedBrainId = brainId.replace(/'/g, "''");

  if (table.brainIdSourceColumn) {
    // Add nullable, then UPDATE from source column, then SET NOT NULL.
    await adapter.exec(`ALTER TABLE ${table.name} ADD COLUMN brain_id TEXT`);
    await adapter.exec(`UPDATE ${table.name} SET brain_id = ${table.brainIdSourceColumn}`);
    await adapter.exec(`ALTER TABLE ${table.name} ALTER COLUMN brain_id SET NOT NULL`);
  } else {
    await adapter.exec(
      `ALTER TABLE ${table.name} ADD COLUMN brain_id TEXT NOT NULL DEFAULT '${escapedBrainId}'`,
    );
    await adapter.exec(`ALTER TABLE ${table.name} ALTER COLUMN brain_id DROP DEFAULT`);
  }

  if (table.primaryKey.length > 0) {
    // Drop existing PK (Postgres names it <table>_pkey by default).
    await adapter.exec(`ALTER TABLE ${table.name} DROP CONSTRAINT IF EXISTS ${table.name}_pkey`);
    await adapter.exec(
      `ALTER TABLE ${table.name} ADD PRIMARY KEY (${table.primaryKey.join(', ')})`,
    );
  }

  for (const idx of table.indexes) {
    await adapter.exec(idx);
  }
}
