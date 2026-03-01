/**
 * @fileoverview Neo4j-backed Capability Graph implementation.
 *
 * Implements `ICapabilityGraph` using Neo4j for persistent capability
 * relationship storage. Designed for scaling to 1000+ capabilities
 * where in-memory graphology becomes impractical.
 *
 * Also implements the `rerank()` method used by CapabilityDiscoveryEngine
 * for graph-based re-ranking of search results.
 *
 * @module @framers/agentos/discovery/Neo4jCapabilityGraph
 * @see ./types.ts for the ICapabilityGraph interface.
 */

import type {
  ICapabilityGraph,
  CapabilityDescriptor,
  CapabilityEdge,
  CapabilityEdgeType,
  RelatedCapability,
  PresetCoOccurrence,
} from './types.js';
import type { Neo4jConnectionManager } from '../neo4j/Neo4jConnectionManager.js';
import { Neo4jCypherRunner } from '../neo4j/Neo4jCypherRunner.js';

// ============================================================================
// Constants
// ============================================================================

const CAP_LABEL = 'Capability';

// ============================================================================
// Implementation
// ============================================================================

export class Neo4jCapabilityGraph implements ICapabilityGraph {
  private cypher: Neo4jCypherRunner;

  constructor(connectionManager: Neo4jConnectionManager) {
    this.cypher = new Neo4jCypherRunner(connectionManager);
  }

  buildGraph(
    capabilities: CapabilityDescriptor[],
    presetCoOccurrences?: PresetCoOccurrence[],
  ): void {
    // buildGraph is synchronous in the interface but Neo4j is async.
    // We queue the build and it will be awaited by the first query.
    // For compatibility, we use a fire-and-forget pattern with an internal promise.
    this._buildPromise = this._buildGraphAsync(capabilities, presetCoOccurrences);
  }

  private _buildPromise: Promise<void> = Promise.resolve();

  private async _ensureBuilt(): Promise<void> {
    await this._buildPromise;
  }

  private async _buildGraphAsync(
    capabilities: CapabilityDescriptor[],
    presetCoOccurrences?: PresetCoOccurrence[],
  ): Promise<void> {
    // Clear existing graph
    await this.cypher.writeVoid(`MATCH (c:${CAP_LABEL}) DETACH DELETE c`);

    // Create constraint
    await this.cypher.writeVoid(
      `CREATE CONSTRAINT cap_unique IF NOT EXISTS FOR (n:${CAP_LABEL}) REQUIRE n.capId IS UNIQUE`,
    );

    // Insert nodes in batches
    const batchSize = 50;
    for (let i = 0; i < capabilities.length; i += batchSize) {
      const batch = capabilities.slice(i, i + batchSize);
      await this.cypher.writeVoid(
        `UNWIND $caps AS cap
         CREATE (c:${CAP_LABEL} {
           capId: cap.id,
           kind: cap.kind,
           category: cap.category,
           name: cap.name
         })`,
        {
          caps: batch.map((c) => ({
            id: c.id,
            kind: c.kind,
            category: c.category,
            name: c.name,
          })),
        },
      );
    }

    // Build capability lookup
    const capMap = new Map(capabilities.map((c) => [c.id, c]));

    // DEPENDS_ON edges (skill → tool via requiredTools)
    for (const cap of capabilities) {
      if (cap.kind === 'skill' && cap.requiredTools.length > 0) {
        for (const toolName of cap.requiredTools) {
          const toolId = `tool:${toolName}`;
          if (capMap.has(toolId)) {
            await this.addEdge(cap.id, toolId, 'DEPENDS_ON', 1.0);
          }
        }
      }
    }

    // COMPOSED_WITH edges (co-occurrence in presets)
    if (presetCoOccurrences) {
      for (const preset of presetCoOccurrences) {
        const ids = preset.capabilityIds.filter((id) => capMap.has(id));
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            await this.addEdge(ids[i], ids[j], 'COMPOSED_WITH', 0.5);
          }
        }
      }
    }

    // TAGGED_WITH edges (shared tags, ≥2 overlap)
    for (let i = 0; i < capabilities.length; i++) {
      for (let j = i + 1; j < capabilities.length; j++) {
        const a = capabilities[i];
        const b = capabilities[j];
        const overlap = a.tags.filter((t) => b.tags.includes(t)).length;
        if (overlap >= 2) {
          await this.addEdge(a.id, b.id, 'TAGGED_WITH', 0.3 * overlap);
        }
      }
    }

    // SAME_CATEGORY edges (same kind + category, only for small groups 2-8)
    const categoryGroups = new Map<string, string[]>();
    for (const cap of capabilities) {
      const key = `${cap.kind}:${cap.category}`;
      if (!categoryGroups.has(key)) categoryGroups.set(key, []);
      categoryGroups.get(key)!.push(cap.id);
    }
    for (const [, group] of categoryGroups) {
      if (group.length >= 2 && group.length <= 8) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            await this.addEdge(group[i], group[j], 'SAME_CATEGORY', 0.1);
          }
        }
      }
    }
  }

  getRelated(capabilityId: string): RelatedCapability[] {
    // Synchronous interface but Neo4j is async — use cached promise pattern
    // This is a design limitation; callers should use getRelatedAsync when possible.
    // For now, return empty and populate via async path.
    return [];
  }

  /**
   * Async version of getRelated for Neo4j usage.
   */
  async getRelatedAsync(capabilityId: string): Promise<RelatedCapability[]> {
    await this._ensureBuilt();

    const results = await this.cypher.read<{
      neighborId: string;
      weight: number;
      edgeType: string;
    }>(
      `MATCH (c:${CAP_LABEL} { capId: $capId })-[r]-(n:${CAP_LABEL})
       RETURN n.capId AS neighborId, r.weight AS weight, type(r) AS edgeType
       ORDER BY r.weight DESC`,
      { capId: capabilityId },
    );

    return results.map((r) => ({
      id: r.neighborId,
      weight: Number(r.weight),
      relationType: r.edgeType as CapabilityEdgeType,
    }));
  }

  getSubgraph(capabilityIds: string[]): { nodes: string[]; edges: CapabilityEdge[] } {
    // Same synchronous limitation — return empty for sync calls
    return { nodes: [], edges: [] };
  }

  /**
   * Async version of getSubgraph for Neo4j usage.
   */
  async getSubgraphAsync(capabilityIds: string[]): Promise<{
    nodes: string[];
    edges: CapabilityEdge[];
  }> {
    await this._ensureBuilt();

    const results = await this.cypher.read<{
      sourceId: string;
      targetId: string;
      edgeType: string;
      weight: number;
    }>(
      `MATCH (n1:${CAP_LABEL})-[r]-(n2:${CAP_LABEL})
       WHERE n1.capId IN $ids AND n2.capId IN $ids
       AND id(n1) < id(n2)
       RETURN n1.capId AS sourceId, n2.capId AS targetId,
              type(r) AS edgeType, r.weight AS weight`,
      { ids: capabilityIds },
    );

    const nodeSet = new Set<string>();
    const edges: CapabilityEdge[] = [];

    for (const r of results) {
      nodeSet.add(r.sourceId);
      nodeSet.add(r.targetId);
      edges.push({
        sourceId: r.sourceId,
        targetId: r.targetId,
        type: r.edgeType as CapabilityEdgeType,
        weight: Number(r.weight),
      });
    }

    // Also include nodes that may have no edges in the subgraph
    for (const id of capabilityIds) {
      nodeSet.add(id);
    }

    return { nodes: Array.from(nodeSet), edges };
  }

  nodeCount(): number {
    // Synchronous — return 0; use nodeCountAsync for accurate count
    return 0;
  }

  async nodeCountAsync(): Promise<number> {
    await this._ensureBuilt();
    const results = await this.cypher.read<{ count: number }>(
      `MATCH (c:${CAP_LABEL}) RETURN count(c) AS count`,
    );
    return Number(results[0]?.count ?? 0);
  }

  edgeCount(): number {
    return 0;
  }

  async edgeCountAsync(): Promise<number> {
    await this._ensureBuilt();
    const results = await this.cypher.read<{ count: number }>(
      `MATCH (:${CAP_LABEL})-[r]-(:${CAP_LABEL}) RETURN count(r) / 2 AS count`,
    );
    return Number(results[0]?.count ?? 0);
  }

  clear(): void {
    this._buildPromise = this.cypher.writeVoid(`MATCH (c:${CAP_LABEL}) DETACH DELETE c`);
  }

  /**
   * Re-rank search results using graph relationships.
   * Matches the CapabilityGraph.rerank() signature for drop-in replacement.
   */
  async rerank(
    searchResults: Array<{ id: string; score: number }>,
    graphBoostFactor: number,
  ): Promise<Array<{ id: string; score: number; boosted: boolean }>> {
    await this._ensureBuilt();

    const resultMap = new Map<string, { score: number; boosted: boolean }>();

    // Initialize with original scores
    for (const r of searchResults) {
      resultMap.set(r.id, { score: r.score, boosted: false });
    }

    // Apply graph boosts
    for (const r of searchResults) {
      const related = await this.getRelatedAsync(r.id);
      for (const rel of related) {
        if (resultMap.has(rel.id)) {
          const existing = resultMap.get(rel.id)!;
          existing.score += graphBoostFactor * rel.weight;
          existing.boosted = true;
        } else if (rel.relationType === 'DEPENDS_ON' || rel.relationType === 'COMPOSED_WITH') {
          resultMap.set(rel.id, {
            score: r.score * graphBoostFactor * rel.weight,
            boosted: true,
          });
        }
      }
    }

    return Array.from(resultMap.entries())
      .map(([id, { score, boosted }]) => ({ id, score, boosted }))
      .sort((a, b) => b.score - a.score);
  }

  // ============ Private ============

  private async addEdge(
    sourceId: string,
    targetId: string,
    type: CapabilityEdgeType,
    weight: number,
  ): Promise<void> {
    await this.cypher.writeVoid(
      `MATCH (s:${CAP_LABEL} { capId: $sourceId })
       MATCH (t:${CAP_LABEL} { capId: $targetId })
       MERGE (s)-[r:${type}]->(t)
       ON CREATE SET r.weight = $weight
       ON MATCH SET r.weight = CASE WHEN $weight > r.weight THEN $weight ELSE r.weight END`,
      { sourceId, targetId, weight },
    );
  }
}
