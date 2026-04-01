/**
 * @fileoverview Markdown importer for AgentOS memory brain.
 *
 * Recursively walks a directory of Markdown files and inserts each file as a
 * memory trace in the target `SqliteBrain`.  Front-matter fields (parsed via
 * `gray-matter`) are mapped to trace columns; the document body becomes the
 * trace content.
 *
 * Deduplication uses SHA-256 of the content body — files already present in
 * the target brain (same hash in `metadata.import_hash`) are skipped.
 *
 * @module memory/io/MarkdownImporter
 */
import { sha256 } from '../core/util/crossPlatformCrypto.js';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
// ---------------------------------------------------------------------------
// MarkdownImporter
// ---------------------------------------------------------------------------
/**
 * Imports Markdown files from a directory into a `SqliteBrain`.
 *
 * **Usage:**
 * ```ts
 * const importer = new MarkdownImporter(brain);
 * const result = await importer.import('/path/to/vault');
 * console.log(result.imported, result.skipped);
 * ```
 */
export class MarkdownImporter {
    /**
     * @param brain - The target `SqliteBrain` to import into.
     */
    constructor(brain) {
        this.brain = brain;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Recursively walk `sourceDir`, parse every `.md` file, and insert traces.
     *
     * Non-Markdown files are silently ignored.  Files that fail to parse are
     * recorded in `result.errors` and processing continues.
     *
     * @param sourceDir - Directory to recursively scan for `.md` files.
     * @returns `ImportResult` with counts of imported, skipped, and errored items.
     */
    async import(sourceDir, options) {
        const result = { imported: 0, skipped: 0, errors: [] };
        const files = await this._collectMarkdownFiles(sourceDir);
        for (const filePath of files) {
            await this._processFile(filePath, result, options);
        }
        return result;
    }
    // -------------------------------------------------------------------------
    // Protected helpers (overridden by ObsidianImporter)
    // -------------------------------------------------------------------------
    /**
     * Post-process a parsed file before it is inserted into the database.
     *
     * The base implementation is a no-op.  `ObsidianImporter` overrides this
     * to extract `[[wikilinks]]` and `#tags`.
     *
     * @param _filePath   - Absolute path of the source file.
     * @param _frontmatter - Parsed front-matter data.
     * @param _body       - Markdown body content.
     * @param _result     - Mutable result accumulator.
     * @param _traceId    - The ID assigned (or taken from front-matter) for this trace.
     */
    async postProcess(_filePath, _frontmatter, _body, _result, _traceId) {
        // No-op in base class.
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    /**
     * Recursively collect all `.md` file paths under `dir`.
     *
     * @param dir - Root directory to scan.
     * @returns Sorted list of absolute file paths.
     */
    async _collectMarkdownFiles(dir) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const results = [];
        async function walk(current) {
            let entries;
            try {
                entries = await fs.readdir(current, { withFileTypes: true });
            }
            catch {
                return; // Directory not readable — skip.
            }
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    await walk(full);
                }
                else if (entry.isFile() && entry.name.endsWith('.md')) {
                    results.push(full);
                }
            }
        }
        await walk(dir);
        return results.sort();
    }
    /**
     * Parse and insert a single Markdown file.
     *
     * @param filePath - Absolute path to the `.md` file.
     * @param result   - Mutable `ImportResult` accumulator.
     */
    async _processFile(filePath, result, options) {
        const fs = await import('node:fs/promises');
        let raw;
        try {
            raw = await fs.readFile(filePath, 'utf8');
        }
        catch (err) {
            result.errors.push(`Cannot read ${filePath}: ${String(err)}`);
            return;
        }
        let parsed;
        try {
            parsed = matter(raw);
        }
        catch (err) {
            result.errors.push(`Cannot parse front-matter in ${filePath}: ${String(err)}`);
            return;
        }
        const fm = parsed.data;
        const body = parsed.content.trim();
        if (!body) {
            result.skipped++;
            return;
        }
        const hash = await sha256(body);
        // Dedup check.
        const { dialect } = this.brain.features;
        if (options?.dedup ?? true) {
            const existing = await this.brain.get(`SELECT id FROM memory_traces WHERE ${dialect.jsonExtract('metadata', '$.import_hash')} = ? LIMIT 1`, [hash]);
            if (existing) {
                result.skipped++;
                return;
            }
        }
        const traceId = await this._resolveTraceId((typeof fm.id === 'string' && fm.id) ? fm.id : `mt_${uuidv4()}`);
        const tags = Array.isArray(fm.tags) ? fm.tags : [];
        const meta = { import_hash: hash, source_file: filePath };
        try {
            await this.brain.run(`INSERT INTO memory_traces
             (id, type, scope, content, embedding, strength, created_at, last_accessed,
              retrieval_count, tags, emotions, metadata, deleted)
           VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, 0, ?, '{}', ?, 0)`, [
                traceId,
                typeof fm.type === 'string' ? fm.type : 'episodic',
                typeof fm.scope === 'string' ? fm.scope : 'user',
                body,
                typeof fm.strength === 'number' ? fm.strength : 1.0,
                typeof fm.createdAt === 'number' ? fm.createdAt : Date.now(),
                JSON.stringify(tags),
                JSON.stringify(meta),
            ]);
            // Give subclasses a chance to handle wikilinks, extra tags, etc.
            await this.postProcess(filePath, fm, body, result, traceId);
            result.imported++;
        }
        catch (err) {
            result.errors.push(`Insert error for ${filePath}: ${String(err)}`);
        }
    }
    async _resolveTraceId(preferredId) {
        const existing = await this.brain.get('SELECT id FROM memory_traces WHERE id = ? LIMIT 1', [preferredId]);
        return existing ? `mt_${uuidv4()}` : preferredId;
    }
}
//# sourceMappingURL=MarkdownImporter.js.map