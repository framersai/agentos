/**
 * @fileoverview Types for backend auto-setup and Docker detection.
 * @module rag/setup/types
 */

/** Status of a backend detection attempt. */
export type SetupStatus = 'running' | 'stopped' | 'not_found' | 'no_docker' | 'error';

/**
 * Result of detecting a backend's availability.
 */
export interface BackendStatus {
  /** Current status of the backend. */
  status: SetupStatus;
  /** URL/connection string if the backend is reachable. */
  url?: string;
  /** Docker container name if running via Docker. */
  containerName?: string;
  /** How the backend was discovered. */
  source?: 'docker-local' | 'env-var' | 'cloud' | 'manual';
  /** Error message if status is 'error' or 'no_docker'. */
  error?: string;
}

/**
 * Configuration for auto-setup operations.
 */
export interface SetupConfig {
  /** Custom port override. */
  port?: number;
  /** Custom Docker image tag (e.g. 'v1.8.0'). */
  imageTag?: string;
  /** Skip Docker and connect to this URL directly. */
  url?: string;
  /** API key for cloud instances. */
  apiKey?: string;
}

/**
 * Persisted vector store configuration at ~/.wunderland/vector-store.json.
 * Written after successful auto-setup, read by all subsequent commands.
 */
export interface VectorStoreConfig {
  /** Backend type. */
  type: 'sqlite' | 'postgres' | 'qdrant';
  /** Connection URL (for Postgres/Qdrant). */
  url?: string;
  /** File path (for SQLite). */
  path?: string;
  /** Postgres connection string. */
  connectionString?: string;
  /** How this config was created. */
  source?: string;
  /** Docker container name if applicable. */
  containerName?: string;
  /** ISO timestamp of when setup was performed. */
  setupAt?: string;
}
