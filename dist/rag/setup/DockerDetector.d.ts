/**
 * @fileoverview Docker environment detection and container management.
 * @module rag/setup/DockerDetector
 *
 * Utility class for detecting whether Docker is available, checking
 * container state, starting/stopping containers, and pulling images.
 * Used by QdrantSetup and PostgresSetup for auto-provisioning.
 */
export declare class DockerDetector {
    /**
     * Check if Docker is installed and the daemon is running.
     * Runs `docker info` with a 5-second timeout.
     *
     * @returns True if Docker is available and responsive.
     */
    static isDockerAvailable(): boolean;
    /**
     * Check the state of a named Docker container.
     *
     * @param name - Container name to inspect.
     * @returns 'running' if active, 'stopped' if exists but not running,
     *          'not_found' if the container doesn't exist.
     */
    static getContainerState(name: string): 'running' | 'stopped' | 'not_found';
    /**
     * Start a stopped container by name.
     *
     * @param name - Container name to start.
     * @throws If the container cannot be started.
     */
    static startContainer(name: string): void;
    /**
     * Pull a Docker image and run a new container.
     *
     * @param opts.name    - Container name.
     * @param opts.image   - Docker image (e.g. 'qdrant/qdrant:latest').
     * @param opts.ports   - Port mappings (e.g. ['6333:6333', '6334:6334']).
     * @param opts.volumes - Volume mounts (e.g. ['data-vol:/data']).
     * @param opts.env     - Environment variables (e.g. { POSTGRES_PASSWORD: 'pw' }).
     */
    static pullAndRun(opts: {
        name: string;
        image: string;
        ports: string[];
        volumes: string[];
        env?: Record<string, string>;
    }): void;
    /**
     * Poll a health check URL until it returns 200 or timeout is reached.
     * Checks every 500ms.
     *
     * @param url       - Health check endpoint (e.g. 'http://localhost:6333/healthz').
     * @param timeoutMs - Maximum time to wait in milliseconds. @default 15000
     * @returns True if the endpoint became healthy within the timeout.
     */
    static waitForHealthy(url: string, timeoutMs?: number): Promise<boolean>;
    /**
     * Get the mapped host port for a container's internal port.
     * Useful when the host port was dynamically assigned.
     *
     * @param name         - Container name.
     * @param internalPort - The container-internal port to look up.
     * @returns The host port number, or null if not found.
     */
    static getHostPort(name: string, internalPort: number): number | null;
}
//# sourceMappingURL=DockerDetector.d.ts.map