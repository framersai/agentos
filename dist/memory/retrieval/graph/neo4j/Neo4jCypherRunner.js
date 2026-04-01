/**
 * @fileoverview Thin parameterized Cypher query runner wrapping Neo4jConnectionManager.
 *
 * Handles session lifecycle (create/close in finally), executeRead/executeWrite
 * dispatch, and result record mapping. All Cypher is parameterized — no string
 * interpolation — to prevent injection.
 *
 * @module @framers/agentos/neo4j/Neo4jCypherRunner
 */
/**
 * Helper for running parameterized Cypher queries.
 */
export class Neo4jCypherRunner {
    constructor(connectionManager) {
        this.connectionManager = connectionManager;
    }
    /**
     * Execute a read-only Cypher query with automatic session management.
     * Returns result records mapped to plain objects.
     */
    async read(cypher, params = {}) {
        const session = this.connectionManager.session('READ');
        try {
            const result = await session.executeRead((tx) => tx.run(cypher, params));
            return result.records.map((r) => r.toObject());
        }
        finally {
            await session.close();
        }
    }
    /**
     * Execute a write Cypher query with automatic session management.
     * Returns result records mapped to plain objects.
     */
    async write(cypher, params = {}) {
        const session = this.connectionManager.session('WRITE');
        try {
            const result = await session.executeWrite((tx) => tx.run(cypher, params));
            return result.records.map((r) => r.toObject());
        }
        finally {
            await session.close();
        }
    }
    /**
     * Execute a write Cypher query that returns no results.
     */
    async writeVoid(cypher, params = {}) {
        const session = this.connectionManager.session('WRITE');
        try {
            await session.executeWrite((tx) => tx.run(cypher, params));
        }
        finally {
            await session.close();
        }
    }
    /**
     * Execute multiple write statements in a single transaction.
     */
    async writeTransaction(statements) {
        const session = this.connectionManager.session('WRITE');
        try {
            await session.executeWrite(async (tx) => {
                for (const stmt of statements) {
                    await tx.run(stmt.cypher, stmt.params ?? {});
                }
            });
        }
        finally {
            await session.close();
        }
    }
}
//# sourceMappingURL=Neo4jCypherRunner.js.map