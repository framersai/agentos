import { type StorageResolutionOptions } from '@framers/sql-storage-adapter';
import type { ITaskOutcomeTelemetryStore } from '../../api/AgentOSOrchestrator.js';
type TaskOutcomeKpiWindowEntry = Parameters<ITaskOutcomeTelemetryStore['saveWindow']>[1][number];
export interface SqlTaskOutcomeTelemetryStoreConfig extends StorageResolutionOptions {
    /**
     * SQL table used for persisted KPI windows.
     * Default: `agentos_task_outcome_kpi_windows`
     */
    tableName?: string;
}
/**
 * SQL-backed persistence for `AgentOSOrchestrator` task outcome KPI windows.
 * Uses `@framers/sql-storage-adapter` so the same store works across SQLite, Postgres, and WASM adapters.
 */
export declare class SqlTaskOutcomeTelemetryStore implements ITaskOutcomeTelemetryStore {
    private adapter;
    private initialized;
    private readonly tableName;
    private readonly resolutionOptions;
    constructor(config?: SqlTaskOutcomeTelemetryStoreConfig);
    initialize(): Promise<void>;
    close(): Promise<void>;
    loadWindows(): Promise<Record<string, TaskOutcomeKpiWindowEntry[]>>;
    saveWindow(scopeKey: string, entries: TaskOutcomeKpiWindowEntry[]): Promise<void>;
    private ensureInitialized;
    private getAdapter;
    private ensureSchema;
}
export {};
//# sourceMappingURL=SqlTaskOutcomeTelemetryStore.d.ts.map