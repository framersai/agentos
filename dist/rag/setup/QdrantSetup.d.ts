/**
 * @fileoverview Qdrant auto-setup via Docker detection and provisioning.
 * @module rag/setup/QdrantSetup
 *
 * Detection flow:
 * 1. Check QDRANT_URL / explicit URL → health check
 * 2. Check Docker → existing container → start if stopped
 * 3. Pull qdrant/qdrant image → run new container
 * 4. Poll /healthz until ready
 */
import type { BackendStatus, SetupConfig } from './types.js';
export declare class QdrantSetup {
    /**
     * Detect and optionally provision a Qdrant instance.
     *
     * Priority order:
     * 1. Explicit URL or QDRANT_URL env var → direct health check
     * 2. Docker container named 'wunderland-qdrant' → start if stopped
     * 3. Pull and run a new Docker container
     *
     * @param config - Optional setup overrides (port, image tag, URL, API key).
     * @returns Backend status with URL and connection details.
     */
    static detect(config?: SetupConfig): Promise<BackendStatus>;
}
//# sourceMappingURL=QdrantSetup.d.ts.map