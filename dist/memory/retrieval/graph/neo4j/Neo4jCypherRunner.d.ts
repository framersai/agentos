/**
 * @fileoverview Thin parameterized Cypher query runner wrapping Neo4jConnectionManager.
 *
 * Handles session lifecycle (create/close in finally), executeRead/executeWrite
 * dispatch, and result record mapping. All Cypher is parameterized — no string
 * interpolation — to prevent injection.
 *
 * @module @framers/agentos/neo4j/Neo4jCypherRunner
 */
import type { Neo4jConnectionManager } from './Neo4jConnectionManager.js';
/**
 * Helper for running parameterized Cypher queries.
 */
export declare class Neo4jCypherRunner {
    private connectionManager;
    constructor(connectionManager: Neo4jConnectionManager);
    /**
     * Execute a read-only Cypher query with automatic session management.
     * Returns result records mapped to plain objects.
     */
    read<T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
    /**
     * Execute a write Cypher query with automatic session management.
     * Returns result records mapped to plain objects.
     */
    write<T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
    /**
     * Execute a write Cypher query that returns no results.
     */
    writeVoid(cypher: string, params?: Record<string, unknown>): Promise<void>;
    /**
     * Execute multiple write statements in a single transaction.
     */
    writeTransaction(statements: Array<{
        cypher: string;
        params?: Record<string, unknown>;
    }>): Promise<void>;
}
//# sourceMappingURL=Neo4jCypherRunner.d.ts.map