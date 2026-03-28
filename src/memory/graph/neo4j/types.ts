/**
 * @fileoverview Neo4j connection configuration types for AgentOS.
 * @module @framers/agentos/neo4j/types
 */

/**
 * Configuration for connecting to a Neo4j instance.
 * Used by Neo4jConnectionManager and all Neo4j-backed implementations.
 */
export interface Neo4jConnectionConfig {
  /** Connection URI (e.g., 'bolt://localhost:7687', 'neo4j+s://xxx.databases.neo4j.io') */
  uri: string;
  /** Username — 'neo4j' for default installations */
  username: string;
  /** Password */
  password: string;
  /** Database name — defaults to 'neo4j' */
  database?: string;
  /** Max connection pool size — defaults to 50 */
  maxConnectionPoolSize?: number;
  /** Connection acquisition timeout in ms — defaults to 30000 */
  connectionAcquisitionTimeoutMs?: number;
}

/**
 * Record shape returned by Neo4j result mapping.
 */
export type Neo4jRecord = Record<string, unknown>;
