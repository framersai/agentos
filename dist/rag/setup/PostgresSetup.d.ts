/**
 * @fileoverview Postgres + pgvector auto-setup via Docker detection.
 * @module rag/setup/PostgresSetup
 *
 * Detection flow:
 * 1. Check DATABASE_URL / explicit connection string → pg_isready
 * 2. Check Docker → existing container → start if stopped
 * 3. Pull postgres:16 → run new container → install pgvector extension
 */
import type { BackendStatus, SetupConfig } from './types.js';
export declare class PostgresSetup {
    /**
     * Detect and optionally provision a Postgres + pgvector instance.
     *
     * @param config - Optional setup overrides (port, image tag, URL).
     * @returns Backend status with connection string.
     */
    static detect(config?: SetupConfig): Promise<BackendStatus>;
}
//# sourceMappingURL=PostgresSetup.d.ts.map