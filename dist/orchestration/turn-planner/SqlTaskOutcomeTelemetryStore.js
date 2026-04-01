import { resolveStorageAdapter, } from '@framers/sql-storage-adapter';
const DEFAULT_TABLE_NAME = 'agentos_task_outcome_kpi_windows';
function sanitizeTableName(tableName) {
    const normalized = String(tableName || '').trim();
    if (!normalized)
        return DEFAULT_TABLE_NAME;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
        throw new Error(`Invalid tableName '${tableName}'. Use letters, numbers, and underscores only.`);
    }
    return normalized;
}
function sanitizeEntry(raw) {
    const status = raw?.status;
    if (status !== 'success' && status !== 'partial' && status !== 'failed')
        return null;
    const score = Number(raw?.score);
    const timestamp = Number(raw?.timestamp);
    if (!Number.isFinite(score) || !Number.isFinite(timestamp))
        return null;
    return {
        status,
        score: Math.max(0, Math.min(1, score)),
        timestamp: Math.max(0, Math.trunc(timestamp)),
    };
}
/**
 * SQL-backed persistence for `AgentOSOrchestrator` task outcome KPI windows.
 * Uses `@framers/sql-storage-adapter` so the same store works across SQLite, Postgres, and WASM adapters.
 */
export class SqlTaskOutcomeTelemetryStore {
    constructor(config = {}) {
        this.adapter = null;
        this.initialized = false;
        const { tableName, ...resolutionOptions } = config;
        this.tableName = sanitizeTableName(tableName ?? DEFAULT_TABLE_NAME);
        this.resolutionOptions = resolutionOptions;
    }
    async initialize() {
        if (this.initialized)
            return;
        this.adapter = await resolveStorageAdapter(this.resolutionOptions);
        await this.ensureSchema();
        this.initialized = true;
    }
    async close() {
        if (!this.adapter)
            return;
        await this.adapter.close();
        this.adapter = null;
        this.initialized = false;
    }
    async loadWindows() {
        await this.ensureInitialized();
        const adapter = this.getAdapter();
        const rows = await adapter.all(`SELECT scope_key, entries_json FROM ${this.tableName}`);
        const windows = {};
        for (const row of rows) {
            const scopeKey = typeof row?.scope_key === 'string' ? row.scope_key.trim() : '';
            if (!scopeKey)
                continue;
            try {
                const parsed = JSON.parse(String(row.entries_json ?? '[]'));
                if (!Array.isArray(parsed))
                    continue;
                const entries = parsed
                    .map((entry) => sanitizeEntry(entry))
                    .filter((entry) => Boolean(entry));
                windows[scopeKey] = entries;
            }
            catch {
                // Ignore malformed rows; preserve availability.
            }
        }
        return windows;
    }
    async saveWindow(scopeKey, entries) {
        await this.ensureInitialized();
        const adapter = this.getAdapter();
        const normalizedScopeKey = String(scopeKey ?? '').trim();
        if (!normalizedScopeKey)
            return;
        const sanitizedEntries = (Array.isArray(entries) ? entries : [])
            .map((entry) => sanitizeEntry(entry))
            .filter((entry) => Boolean(entry));
        const payload = JSON.stringify(sanitizedEntries);
        const updatedAt = Date.now();
        if (adapter.kind !== 'postgres') {
            await adapter.run(`INSERT OR REPLACE INTO ${this.tableName} (scope_key, entries_json, updated_at) VALUES (?, ?, ?)`, [normalizedScopeKey, payload, updatedAt]);
            return;
        }
        const existing = await adapter.get(`SELECT scope_key FROM ${this.tableName} WHERE scope_key = ?`, [normalizedScopeKey]);
        if (existing) {
            await adapter.run(`UPDATE ${this.tableName} SET entries_json = ?, updated_at = ? WHERE scope_key = ?`, [payload, updatedAt, normalizedScopeKey]);
            return;
        }
        await adapter.run(`INSERT INTO ${this.tableName} (scope_key, entries_json, updated_at) VALUES (?, ?, ?)`, [normalizedScopeKey, payload, updatedAt]);
    }
    async ensureInitialized() {
        if (this.initialized)
            return;
        await this.initialize();
    }
    getAdapter() {
        if (!this.adapter) {
            throw new Error('SqlTaskOutcomeTelemetryStore is not initialized.');
        }
        return this.adapter;
    }
    async ensureSchema() {
        const adapter = this.getAdapter();
        const updatedAtIndex = sanitizeTableName(`${this.tableName}_updated_at_idx`);
        await adapter.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        scope_key TEXT PRIMARY KEY,
        entries_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${updatedAtIndex}
        ON ${this.tableName} (updated_at);
    `);
    }
}
//# sourceMappingURL=SqlTaskOutcomeTelemetryStore.js.map