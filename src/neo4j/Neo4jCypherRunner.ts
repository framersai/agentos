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
export class Neo4jCypherRunner {
  constructor(private connectionManager: Neo4jConnectionManager) {}

  /**
   * Execute a read-only Cypher query with automatic session management.
   * Returns result records mapped to plain objects.
   */
  async read<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.connectionManager.session('READ');
    try {
      const result = await session.executeRead((tx: any) => tx.run(cypher, params));
      return result.records.map((r: any) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write Cypher query with automatic session management.
   * Returns result records mapped to plain objects.
   */
  async write<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.connectionManager.session('WRITE');
    try {
      const result = await session.executeWrite((tx: any) => tx.run(cypher, params));
      return result.records.map((r: any) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write Cypher query that returns no results.
   */
  async writeVoid(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const session = this.connectionManager.session('WRITE');
    try {
      await session.executeWrite((tx: any) => tx.run(cypher, params));
    } finally {
      await session.close();
    }
  }

  /**
   * Execute multiple write statements in a single transaction.
   */
  async writeTransaction(
    statements: Array<{ cypher: string; params?: Record<string, unknown> }>,
  ): Promise<void> {
    const session = this.connectionManager.session('WRITE');
    try {
      await session.executeWrite(async (tx: any) => {
        for (const stmt of statements) {
          await tx.run(stmt.cypher, stmt.params ?? {});
        }
      });
    } finally {
      await session.close();
    }
  }
}
