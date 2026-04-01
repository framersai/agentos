/**
 * @fileoverview Docker environment detection and container management.
 * @module rag/setup/DockerDetector
 *
 * Utility class for detecting whether Docker is available, checking
 * container state, starting/stopping containers, and pulling images.
 * Used by QdrantSetup and PostgresSetup for auto-provisioning.
 */
import { execSync } from 'node:child_process';
export class DockerDetector {
    /**
     * Check if Docker is installed and the daemon is running.
     * Runs `docker info` with a 5-second timeout.
     *
     * @returns True if Docker is available and responsive.
     */
    static isDockerAvailable() {
        try {
            execSync('docker info', { stdio: 'pipe', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check the state of a named Docker container.
     *
     * @param name - Container name to inspect.
     * @returns 'running' if active, 'stopped' if exists but not running,
     *          'not_found' if the container doesn't exist.
     */
    static getContainerState(name) {
        try {
            const output = execSync(`docker inspect --format='{{.State.Running}}' "${name}"`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
            // docker inspect returns 'true' or 'false' for .State.Running
            return output === 'true' ? 'running' : 'stopped';
        }
        catch {
            // Container doesn't exist or docker not available.
            return 'not_found';
        }
    }
    /**
     * Start a stopped container by name.
     *
     * @param name - Container name to start.
     * @throws If the container cannot be started.
     */
    static startContainer(name) {
        execSync(`docker start "${name}"`, { stdio: 'pipe', timeout: 15000 });
    }
    /**
     * Pull a Docker image and run a new container.
     *
     * @param opts.name    - Container name.
     * @param opts.image   - Docker image (e.g. 'qdrant/qdrant:latest').
     * @param opts.ports   - Port mappings (e.g. ['6333:6333', '6334:6334']).
     * @param opts.volumes - Volume mounts (e.g. ['data-vol:/data']).
     * @param opts.env     - Environment variables (e.g. { POSTGRES_PASSWORD: 'pw' }).
     */
    static pullAndRun(opts) {
        // Pull the image first (allows progress output via pipe).
        execSync(`docker pull "${opts.image}"`, { stdio: 'pipe', timeout: 120000 });
        // Build the docker run command.
        const portFlags = opts.ports.map(p => `-p ${p}`).join(' ');
        const volFlags = opts.volumes.map(v => `-v ${v}`).join(' ');
        const envFlags = opts.env
            ? Object.entries(opts.env).map(([k, v]) => `-e "${k}=${v}"`).join(' ')
            : '';
        const cmd = [
            'docker run -d',
            `--name "${opts.name}"`,
            portFlags,
            volFlags,
            envFlags,
            `"${opts.image}"`,
        ].filter(Boolean).join(' ');
        execSync(cmd, { stdio: 'pipe', timeout: 30000 });
    }
    /**
     * Poll a health check URL until it returns 200 or timeout is reached.
     * Checks every 500ms.
     *
     * @param url       - Health check endpoint (e.g. 'http://localhost:6333/healthz').
     * @param timeoutMs - Maximum time to wait in milliseconds. @default 15000
     * @returns True if the endpoint became healthy within the timeout.
     */
    static async waitForHealthy(url, timeoutMs = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const res = await fetch(url);
                if (res.ok)
                    return true;
            }
            catch {
                // Not ready yet — keep polling.
            }
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }
    /**
     * Get the mapped host port for a container's internal port.
     * Useful when the host port was dynamically assigned.
     *
     * @param name         - Container name.
     * @param internalPort - The container-internal port to look up.
     * @returns The host port number, or null if not found.
     */
    static getHostPort(name, internalPort) {
        try {
            const output = execSync(`docker port "${name}" ${internalPort}`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
            // Output format: "0.0.0.0:6333" or ":::6333"
            const parts = output.split(':');
            const port = parseInt(parts[parts.length - 1], 10);
            return isNaN(port) ? null : port;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=DockerDetector.js.map