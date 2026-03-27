/**
 * @fileoverview Postgres + pgvector auto-setup via Docker detection.
 * @module rag/setup/PostgresSetup
 *
 * Detection flow:
 * 1. Check DATABASE_URL / explicit connection string → pg_isready
 * 2. Check Docker → existing container → start if stopped
 * 3. Pull postgres:16 → run new container → install pgvector extension
 */

import { DockerDetector } from './DockerDetector.js';
import type { BackendStatus, SetupConfig } from './types.js';

/** Default container name for Wunderland-managed Postgres. */
const CONTAINER_NAME = 'wunderland-postgres';
/** Default port. */
const DEFAULT_PORT = 5432;
/** Default Docker image. */
const IMAGE = 'postgres';
/** Default password for auto-provisioned instances. */
const DEFAULT_PASSWORD = 'wunderland';
/** Default database name. */
const DEFAULT_DB = 'agent_memory';

export class PostgresSetup {
  /**
   * Detect and optionally provision a Postgres + pgvector instance.
   *
   * @param config - Optional setup overrides (port, image tag, URL).
   * @returns Backend status with connection string.
   */
  static async detect(config?: SetupConfig): Promise<BackendStatus> {
    const port = config?.port ?? DEFAULT_PORT;

    // ── Step 1: Check explicit connection string or env var ──
    const connStr = config?.url ?? process.env.DATABASE_URL;
    if (connStr) {
      try {
        const pg = await import('pg');
        const client = new pg.default.Client({ connectionString: connStr });
        await client.connect();
        // Check if pgvector is installed.
        try {
          await client.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
        } catch {
          // pgvector not installed — try to install it.
          await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        }
        await client.end();

        // Detect cloud providers from connection string.
        const isCloud = /neon|supabase|rds\.amazonaws|aiven/i.test(connStr);
        return { status: 'running', url: connStr, source: isCloud ? 'cloud' : 'manual' };
      } catch (err) {
        return {
          status: 'error',
          url: connStr,
          error: `Cannot connect to Postgres: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ── Step 2: Check Docker availability ──
    if (!DockerDetector.isDockerAvailable()) {
      return {
        status: 'no_docker',
        error: 'Docker not found. Install Docker to auto-provision Postgres: https://docker.com/get-docker',
      };
    }

    // ── Step 3: Check existing container ──
    const localConnStr = `postgresql://postgres:${DEFAULT_PASSWORD}@localhost:${port}/${DEFAULT_DB}`;
    const state = DockerDetector.getContainerState(CONTAINER_NAME);

    if (state === 'running') {
      return {
        status: 'running',
        url: localConnStr,
        containerName: CONTAINER_NAME,
        source: 'docker-local',
      };
    }

    if (state === 'stopped') {
      DockerDetector.startContainer(CONTAINER_NAME);
      // Postgres needs a few seconds to accept connections after start.
      await new Promise(r => setTimeout(r, 3000));
      return {
        status: 'running',
        url: localConnStr,
        containerName: CONTAINER_NAME,
        source: 'docker-local',
      };
    }

    // ── Step 4: Pull and run new container ──
    const tag = config?.imageTag ?? '16';
    try {
      DockerDetector.pullAndRun({
        name: CONTAINER_NAME,
        image: `${IMAGE}:${tag}`,
        ports: [`${port}:5432`],
        volumes: ['wunderland-pg-data:/var/lib/postgresql/data'],
        env: {
          POSTGRES_DB: DEFAULT_DB,
          POSTGRES_PASSWORD: DEFAULT_PASSWORD,
        },
      });
    } catch (err) {
      return {
        status: 'error',
        error: `Failed to start Postgres container: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Wait for Postgres to accept connections.
    await new Promise(r => setTimeout(r, 5000));

    // ── Step 5: Install pgvector extension ──
    try {
      const pg = await import('pg');
      const client = new pg.default.Client({ connectionString: localConnStr });
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.end();
    } catch (err) {
      return {
        status: 'error',
        url: localConnStr,
        containerName: CONTAINER_NAME,
        error: `Postgres running but pgvector install failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      status: 'running',
      url: localConnStr,
      containerName: CONTAINER_NAME,
      source: 'docker-local',
    };
  }
}
