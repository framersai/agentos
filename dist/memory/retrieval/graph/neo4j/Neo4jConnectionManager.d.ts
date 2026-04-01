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
export declare class Neo4jConnectionManager {
    /** neo4j-driver's Driver instance — null until initialize() */
    private driver;
    private neo4jModule;
    private config;
    private database;
    /** Whether initialize() has been called successfully */
    get isInitialized(): boolean;
    /**
     * Initialize the connection manager.
     * Dynamically imports neo4j-driver, creates the driver, and verifies connectivity.
     */
    initialize(config: Neo4jConnectionConfig): Promise<void>;
    /**
     * Create a session. Callers MUST close the session in a finally block.
     *
     * @param mode - 'READ' for read-only transactions, 'WRITE' for write transactions.
     */
    session(mode?: 'READ' | 'WRITE'): any;
    /**
     * Check Neo4j connectivity.
     */
    checkHealth(): Promise<{
        isHealthy: boolean;
        details?: any;
    }>;
    /**
     * Gracefully close the driver and release all connection pool resources.
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=Neo4jConnectionManager.d.ts.map