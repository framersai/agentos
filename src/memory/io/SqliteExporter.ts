/**
 * @fileoverview SQLite exporter for AgentOS memory brain.
 *
 * Provides a full-fidelity backup of the `SqliteBrain` SQLite file by copying
 * the database file to a specified output path.  This is the highest-fidelity
 * export format — it preserves all tables, indexes, and metadata exactly.
 *
 * Uses the `VACUUM INTO` SQL command (SQLite 3.27+) which atomically creates
 * a clean, fully checkpointed copy without any WAL sidecar file.
 *
 * @module memory/io/SqliteExporter
 */

import type { ExportOptions } from '../facade/types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';

// ---------------------------------------------------------------------------
// SqliteExporter
// ---------------------------------------------------------------------------

/**
 * Exports a `SqliteBrain` as a portable SQLite file.
 *
 * **Usage:**
 * ```ts
 * const exporter = new SqliteExporter(brain);
 * await exporter.export('/path/to/backup.sqlite');
 * ```
 */
export class SqliteExporter {
  /**
   * @param brain - The `SqliteBrain` instance to export.
   */
  constructor(private readonly brain: SqliteBrain) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Copy the brain database to `outputPath`.
   *
   * Uses `VACUUM INTO` which:
   * - Checkpoints all WAL frames into the output file.
   * - Creates a compact, defragmented copy (no `-wal` or `-shm` sidecar).
   * - Is safe to run while the database is open and being written to.
   *
   * The parent directory of `outputPath` must already exist.
   *
   * @param outputPath - Absolute path for the SQLite backup file.
   * @param _options   - Export options (unused — SQLite export always includes
   *   all data including embeddings).
   */
  async export(outputPath: string, _options?: ExportOptions): Promise<void> {
    await this.brain.features.exporter.exportToFile(outputPath);
  }
}
