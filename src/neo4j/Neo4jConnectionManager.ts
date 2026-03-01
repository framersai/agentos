/**
 * @fileoverview Shared Neo4j connection manager for AgentOS.
 *
 * Manages a single neo4j-driver Driver instance with connection pooling,
 * session factory, health checks, and graceful shutdown. All Neo4j-backed
 * implementations (VectorStore, KnowledgeGraph, GraphRAG, CapabilityGraph)
 * share one connection manager instance to avoid redundant pools.
 *
 * neo4j-driver is loaded via dynamic import so it is never required
 * unless explicitly configured — matching the hnswlib-node optional pattern.
 *
 * @module @framers/agentos/neo4j/Neo4jConnectionManager
 */

import type { Neo4jConnectionConfig } from './types.js';

/**
 * Shared Neo4j connection manager.
 *
 * Usage:
 * ```typescript
 * const mgr = new Neo4jConnectionManager();
 * await mgr.initialize({ uri: 'bolt://localhost:7687', username: 'neo4j', password: 'pw' });
 *
 * // All backends receive the same manager
 * const vectorStore = new Neo4jVectorStore(mgr);
 * const knowledgeGraph = new Neo4jKnowledgeGraph({ connectionManager: mgr });
 * ```
 */
export class Neo4jConnectionManager {
  /** neo4j-driver's Driver instance — null until initialize() */
  private driver: any | null = null;
  private neo4jModule: any | null = null;
  private config!: Neo4jConnectionConfig;
  private database!: string;

  /** Whether initialize() has been called successfully */
  get isInitialized(): boolean {
    return this.driver !== null;
  }

  /**
   * Initialize the connection manager.
   * Dynamically imports neo4j-driver, creates the driver, and verifies connectivity.
   */
  async initialize(config: Neo4jConnectionConfig): Promise<void> {
    if (this.driver) return; // Already initialized

    try {
      // @ts-expect-error -- neo4j-driver is an optional peer dependency
      this.neo4jModule = await import('neo4j-driver');
    } catch {
      throw new Error(
        'neo4j-driver is not installed. Install it as an optional peer dependency:\n' +
        '  npm install neo4j-driver\n' +
        'Or use a different backend (in_memory, hnswlib, sql, qdrant).',
      );
    }

    this.config = config;
    this.database = config.database ?? 'neo4j';

    const neo4j = this.neo4jModule.default ?? this.neo4jModule;

    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
      {
        maxConnectionPoolSize: config.maxConnectionPoolSize ?? 50,
        connectionAcquisitionTimeout: config.connectionAcquisitionTimeoutMs ?? 30000,
      },
    );

    // Verify connectivity early
    await this.driver.verifyConnectivity();
  }

  /**
   * Create a session. Callers MUST close the session in a finally block.
   *
   * @param mode - 'READ' for read-only transactions, 'WRITE' for write transactions.
   */
  session(mode: 'READ' | 'WRITE' = 'READ'): any {
    if (!this.driver || !this.neo4jModule) {
      throw new Error('Neo4jConnectionManager not initialized. Call initialize() first.');
    }
    const neo4j = this.neo4jModule.default ?? this.neo4jModule;
    return this.driver.session({
      database: this.database,
      defaultAccessMode: mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
    });
  }

  /**
   * Check Neo4j connectivity.
   */
  async checkHealth(): Promise<{ isHealthy: boolean; details?: any }> {
    if (!this.driver) {
      return { isHealthy: false, details: 'Not initialized' };
    }
    const session = this.session('READ');
    try {
      const result = await session.run('RETURN 1 AS ping');
      return {
        isHealthy: true,
        details: {
          ping: result.records[0]?.get('ping'),
          database: this.database,
          uri: this.config.uri,
        },
      };
    } catch (err: any) {
      return { isHealthy: false, details: err?.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Gracefully close the driver and release all connection pool resources.
   */
  async shutdown(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.neo4jModule = null;
    }
  }
}
