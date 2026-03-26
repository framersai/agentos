/**
 * @fileoverview CSV importer for AgentOS memory brain.
 *
 * Imports flat CSV files into a target `SqliteBrain`. A header row is
 * required and must include a `content` column. Optional columns map onto
 * `memory_traces` fields when present.
 *
 * Supported optional columns:
 * - `id`
 * - `type`
 * - `scope`
 * - `strength`
 * - `created_at` / `createdAt`
 * - `last_accessed`
 * - `retrieval_count`
 * - `deleted`
 * - `tags` (JSON array, comma-separated, or pipe-separated)
 * - `metadata` (JSON object)
 *
 * Deduplication uses SHA-256 of the `content` field and stores the hash in
 * `metadata.import_hash`.
 *
 * @module memory/io/CsvImporter
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { ImportResult } from '../facade/types.js';
import type { SqliteBrain } from '../store/SqliteBrain.js';

/**
 * Imports a flat CSV file into a `SqliteBrain`.
 */
export class CsvImporter {
  constructor(private readonly brain: SqliteBrain) {}

  /**
   * Read, parse, and import a CSV file.
   *
   * @param sourcePath - Absolute or relative path to the CSV file.
   * @returns Import summary with imported/skipped/error counts.
   */
  async import(sourcePath: string): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    let raw: string;
    try {
      raw = await fs.readFile(sourcePath, 'utf8');
    } catch (err) {
      result.errors.push(`Failed to read file: ${String(err)}`);
      return result;
    }

    const rows = this._parseCsv(raw.replace(/^\uFEFF/, ''));
    if (rows.length === 0) {
      result.errors.push('CSV import failed: file is empty.');
      return result;
    }

    const [headerRow, ...dataRows] = rows;
    const header = headerRow.map((cell) => cell.trim().toLowerCase());
    const contentIndex = header.indexOf('content');

    if (contentIndex === -1) {
      result.errors.push('CSV import failed: missing required "content" column.');
      return result;
    }

    const indexOf = (name: string): number => header.indexOf(name);
    const idIndex = indexOf('id');
    const typeIndex = indexOf('type');
    const scopeIndex = indexOf('scope');
    const strengthIndex = indexOf('strength');
    const createdAtIndex = Math.max(indexOf('created_at'), indexOf('createdat'));
    const lastAccessedIndex = indexOf('last_accessed');
    const retrievalCountIndex = indexOf('retrieval_count');
    const deletedIndex = indexOf('deleted');
    const tagsIndex = indexOf('tags');
    const metadataIndex = indexOf('metadata');

    const checkStmt = this.brain.db.prepare<[string, string], { id: string }>(
      `SELECT id
       FROM memory_traces
       WHERE json_extract(metadata, '$.import_hash') = ?
          OR json_extract(metadata, '$.content_hash') = ?
       LIMIT 1`,
    );

    const insertStmt = this.brain.db.prepare(
      `INSERT INTO memory_traces
         (id, type, scope, content, embedding, strength, created_at, last_accessed,
          retrieval_count, tags, emotions, metadata, deleted)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    );

    this.brain.db.transaction(() => {
      for (const row of dataRows) {
        try {
          const content = (row[contentIndex] ?? '').trim();
          if (!content) {
            result.skipped++;
            continue;
          }

          const hash = this._sha256(content);
          if (checkStmt.get(hash, hash)) {
            result.skipped++;
            continue;
          }

          let metadata: Record<string, unknown> = {};
          const rawMetadata = metadataIndex >= 0 ? row[metadataIndex] ?? '' : '';
          if (rawMetadata.trim()) {
            try {
              metadata = JSON.parse(rawMetadata) as Record<string, unknown>;
            } catch {
              result.errors.push(`CSV metadata parse error for content "${content.slice(0, 40)}..."`);
              continue;
            }
          }

          metadata.import_hash = hash;

          const rawCreatedAt = createdAtIndex >= 0 ? row[createdAtIndex] ?? '' : '';
          const rawLastAccessed = lastAccessedIndex >= 0 ? row[lastAccessedIndex] ?? '' : '';
          const rawRetrievalCount = retrievalCountIndex >= 0 ? row[retrievalCountIndex] ?? '' : '';
          const rawStrength = strengthIndex >= 0 ? row[strengthIndex] ?? '' : '';
          const rawDeleted = deletedIndex >= 0 ? row[deletedIndex] ?? '' : '';

          insertStmt.run(
            this._readCell(row, idIndex) || `mt_${uuidv4()}`,
            this._readCell(row, typeIndex) || 'episodic',
            this._readCell(row, scopeIndex) || 'user',
            content,
            this._toNumber(rawStrength) ?? 1.0,
            this._toInteger(rawCreatedAt) ?? Date.now(),
            this._toInteger(rawLastAccessed) ?? null,
            this._toInteger(rawRetrievalCount) ?? 0,
            JSON.stringify(this._parseTags(tagsIndex >= 0 ? row[tagsIndex] ?? '' : '')),
            JSON.stringify(metadata),
            this._toInteger(rawDeleted) ?? 0,
          );

          result.imported++;
        } catch (err) {
          result.errors.push(`CSV trace import error: ${String(err)}`);
        }
      }
    })();

    return result;
  }

  private _sha256(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private _readCell(row: string[], index: number): string {
    if (index < 0) return '';
    return (row[index] ?? '').trim();
  }

  private _toNumber(value: string): number | null {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _toInteger(value: string): number | null {
    const parsed = this._toNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
  }

  private _parseTags(raw: string): string[] {
    const value = raw.trim();
    if (!value) return [];

    if (value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((tag): tag is string => typeof tag === 'string');
        }
      } catch {
        return [];
      }
    }

    const separator = value.includes('|') ? '|' : ',';
    return value
      .split(separator)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  /**
   * Small RFC4180-ish CSV parser that supports quoted fields, escaped quotes,
   * and embedded newlines inside quoted cells.
   */
  private _parseCsv(input: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    const pushField = (): void => {
      row.push(field);
      field = '';
    };

    const pushRow = (): void => {
      if (row.length === 1 && row[0] === '' && rows.length > 0) {
        row = [];
        return;
      }
      rows.push(row);
      row = [];
    };

    for (let i = 0; i < input.length; i++) {
      const char = input[i]!;

      if (inQuotes) {
        if (char === '"') {
          if (input[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ',') {
        pushField();
        continue;
      }

      if (char === '\r') {
        if (input[i + 1] === '\n') i++;
        pushField();
        pushRow();
        continue;
      }

      if (char === '\n') {
        pushField();
        pushRow();
        continue;
      }

      field += char;
    }

    pushField();
    if (row.length > 0) {
      pushRow();
    }

    return rows;
  }
}
