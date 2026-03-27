/**
 * @fileoverview Universal streaming migration engine between vector store backends.
 * @module rag/migration/MigrationEngine
 *
 * Streams data in configurable batches between any pair of supported backends
 * (SQLite, Postgres, Qdrant). Never loads the entire dataset into memory.
 *
 * Usage:
 * ```typescript
 * import { MigrationEngine } from '@framers/agentos';
 *
 * await MigrationEngine.migrate({
 *   from: { type: 'sqlite', path: './brain.sqlite' },
 *   to: { type: 'postgres', connectionString: 'postgresql://...' },
 *   batchSize: 1000,
 *   onProgress: (done, total, table) => console.log(`${table}: ${done}/${total}`),
 * });
 * ```
 */

import type {
  MigrationOptions,
  MigrationResult,
  IMigrationSource,
  IMigrationTarget,
  BackendConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// MigrationEngine
// ---------------------------------------------------------------------------

export class MigrationEngine {
  /**
   * Migrate data between any two backends.
   *
   * The engine:
   * 1. Connects to source and lists available tables.
   * 2. For each table, reads rows in streaming batches.
   * 3. Creates the table in the target (if it doesn't exist).
   * 4. Writes each batch to the target.
   * 5. Reports progress after each batch.
   *
   * @param options - Source, target, batch size, and progress callback.
   * @returns Migration result with counts, duration, and any errors.
   */
  static async migrate(options: MigrationOptions): Promise<MigrationResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize ?? 1000;
    const errors: string[] = [];
    const tablesProcessed: string[] = [];
    let totalRows = 0;

    // Create source and target adapters via dynamic import (lazy loading).
    const source = await MigrationEngine._createSource(options.from);
    const target = await MigrationEngine._createTarget(options.to);

    try {
      const tables = await source.listTables();

      for (const table of tables) {
        try {
          const count = await source.countRows(table);
          if (count === 0) {
            tablesProcessed.push(table);
            continue;
          }

          // Dry run: just count and report progress.
          if (options.dryRun) {
            options.onProgress?.(count, count, table);
            totalRows += count;
            tablesProcessed.push(table);
            continue;
          }

          // Read first batch to get a sample row for schema inference.
          const firstBatch = await source.readBatch(table, 0, batchSize);
          if (firstBatch.length === 0) {
            tablesProcessed.push(table);
            continue;
          }

          // Ensure target table exists (creates schema from sample row).
          await target.ensureTable(table, firstBatch[0]);

          // Write first batch.
          let written = await target.writeBatch(table, firstBatch);
          totalRows += written;
          options.onProgress?.(written, count, table);

          // Stream remaining batches.
          let offset = firstBatch.length;
          while (offset < count) {
            const batch = await source.readBatch(table, offset, batchSize);
            if (batch.length === 0) break;

            const w = await target.writeBatch(table, batch);
            written += w;
            totalRows += w;
            offset += batch.length;
            options.onProgress?.(Math.min(offset, count), count, table);
          }

          tablesProcessed.push(table);
        } catch (err) {
          // Per-table errors are collected, not thrown — other tables still migrate.
          errors.push(`[${table}] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      // Fatal error (e.g. source connection failed).
      errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      await source.close().catch(() => {});
      await target.close().catch(() => {});
    }

    return {
      tablesProcessed,
      totalRows,
      durationMs: Date.now() - startTime,
      verified: errors.length === 0,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Adapter factories (dynamic import for tree-shaking)
  // ---------------------------------------------------------------------------

  /**
   * Create a source adapter for the given backend type.
   * Uses dynamic imports so unused adapters don't bloat the bundle.
   */
  private static async _createSource(config: BackendConfig): Promise<IMigrationSource> {
    switch (config.type) {
      case 'sqlite': {
        const { SqliteSourceAdapter } = await import('./adapters/SqliteSourceAdapter.js');
        return new SqliteSourceAdapter(config.path!);
      }
      case 'postgres': {
        const { PostgresSourceAdapter } = await import('./adapters/PostgresSourceAdapter.js');
        return new PostgresSourceAdapter(config.connectionString!);
      }
      case 'qdrant': {
        const { QdrantSourceAdapter } = await import('./adapters/QdrantSourceAdapter.js');
        return new QdrantSourceAdapter(config.url!, config.apiKey);
      }
      case 'pinecone': {
        const { PineconeSourceAdapter } = await import('./adapters/PineconeSourceAdapter.js');
        return new PineconeSourceAdapter(config.url!, config.apiKey!, config.collectionPrefix);
      }
      default:
        throw new Error(`Unsupported migration source type: ${(config as BackendConfig).type}`);
    }
  }

  /**
   * Create a target adapter for the given backend type.
   * Uses dynamic imports so unused adapters don't bloat the bundle.
   */
  private static async _createTarget(config: BackendConfig): Promise<IMigrationTarget> {
    switch (config.type) {
      case 'sqlite': {
        const { SqliteTargetAdapter } = await import('./adapters/SqliteTargetAdapter.js');
        return new SqliteTargetAdapter(config.path!);
      }
      case 'postgres': {
        const { PostgresTargetAdapter } = await import('./adapters/PostgresTargetAdapter.js');
        return new PostgresTargetAdapter(config.connectionString!);
      }
      case 'qdrant': {
        const { QdrantTargetAdapter } = await import('./adapters/QdrantTargetAdapter.js');
        return new QdrantTargetAdapter(config.url!, config.apiKey);
      }
      case 'pinecone': {
        // Pinecone as a target: upsert vectors via the same PineconeVectorStore.
        // For now, use the source adapter pattern — Pinecone is typically a source
        // for migration TO self-hosted backends, not a target.
        throw new Error('Pinecone as migration target is not yet supported. Migrate FROM Pinecone to SQLite/Postgres/Qdrant.');
      }
      default:
        throw new Error(`Unsupported migration target type: ${(config as BackendConfig).type}`);
    }
  }
}
