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
import { DockerDetector } from './DockerDetector.js';
/** Default container name for Wunderland-managed Qdrant. */
const CONTAINER_NAME = 'wunderland-qdrant';
/** Default Qdrant REST API port. */
const DEFAULT_PORT = 6333;
/** Default Qdrant gRPC port. */
const DEFAULT_GRPC_PORT = 6334;
/** Default Docker image. */
const IMAGE = 'qdrant/qdrant';
export class QdrantSetup {
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
    static async detect(config) {
        const port = config?.port ?? DEFAULT_PORT;
        // ── Step 1: Check explicit URL or env var ──
        const url = config?.url ?? process.env.QDRANT_URL;
        if (url) {
            try {
                const res = await fetch(`${url.replace(/\/+$/, '')}/healthz`);
                if (res.ok) {
                    // Determine if this is a cloud instance based on URL.
                    const isCloud = url.includes('cloud.qdrant.io') || !!config?.apiKey;
                    return { status: 'running', url, source: isCloud ? 'cloud' : 'manual' };
                }
            }
            catch {
                return { status: 'error', url, error: `Cannot reach Qdrant at ${url}` };
            }
        }
        // ── Step 2: Check Docker availability ──
        if (!DockerDetector.isDockerAvailable()) {
            return {
                status: 'no_docker',
                error: 'Docker not found. Install Docker to auto-provision Qdrant: https://docker.com/get-docker',
            };
        }
        // ── Step 3: Check existing container ──
        const state = DockerDetector.getContainerState(CONTAINER_NAME);
        const localUrl = `http://localhost:${port}`;
        if (state === 'running') {
            return {
                status: 'running',
                url: localUrl,
                containerName: CONTAINER_NAME,
                source: 'docker-local',
            };
        }
        if (state === 'stopped') {
            DockerDetector.startContainer(CONTAINER_NAME);
            const healthy = await DockerDetector.waitForHealthy(`${localUrl}/healthz`);
            return healthy
                ? { status: 'running', url: localUrl, containerName: CONTAINER_NAME, source: 'docker-local' }
                : { status: 'error', containerName: CONTAINER_NAME, error: 'Qdrant container started but health check timed out' };
        }
        // ── Step 4: Pull and run new container ──
        const tag = config?.imageTag ?? 'latest';
        try {
            DockerDetector.pullAndRun({
                name: CONTAINER_NAME,
                image: `${IMAGE}:${tag}`,
                ports: [`${port}:${DEFAULT_PORT}`, `${port + 1}:${DEFAULT_GRPC_PORT}`],
                volumes: ['wunderland-qdrant-data:/qdrant/storage'],
            });
        }
        catch (err) {
            return {
                status: 'error',
                error: `Failed to start Qdrant container: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        const healthy = await DockerDetector.waitForHealthy(`${localUrl}/healthz`, 20000);
        return healthy
            ? { status: 'running', url: localUrl, containerName: CONTAINER_NAME, source: 'docker-local' }
            : { status: 'error', containerName: CONTAINER_NAME, error: 'Qdrant container created but health check timed out' };
    }
}
//# sourceMappingURL=QdrantSetup.js.map